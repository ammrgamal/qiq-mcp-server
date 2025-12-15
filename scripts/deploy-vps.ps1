param(
    [string]$Password,
    [string]$VpsHost = "109.199.105.196",
    [string]$User = "root",
    [string]$ServerUrl = "https://mcp.quickitquote.com",
    [string]$RemotePath = "/opt/qiq-mcp-server",
    [string]$Pm2Process = "qiq-mcp-http",
    [string]$SearchPm2Process = "qiq-mcp-search",
    [int]$SearchPort = 3003,
    [string]$TypesenseHost = "b7p0h5alwcoxe6qgp-1.a1.typesense.net",
    [string]$TypesenseProtocol = "https",
    [int]$TypesensePort = 443,
    [string]$TypesenseApiKey = "7e7izXzNPboi42IaKNl63MTWR7ps7ROo",
    [string]$TypesenseCollection = "quickitquote_products",
    [string]$TypesenseQueryBy = "object_id,name,brand,category",
    [string[]]$TestObjectIDs = @("KL4069IA1XXS", "KL4069IA1YRS"),
    [string]$KeyFile = $(Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'keys\qiq-vps')
    , [string]$NewSubdomain = "mcp2.quickitquote.com"
    , [string]$LetsEncryptEmail = "admin@quickitquote.com"
)

Write-Host "\n=== Deploy to VPS: $VpsHost ===" -ForegroundColor Cyan

# Ensure Posh-SSH is available
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Write-Host "Installing Posh-SSH..." -ForegroundColor Yellow
    Install-Module Posh-SSH -Force -Scope CurrentUser | Out-Null
}
Import-Module Posh-SSH

# Create credential (password or empty for key)
if ($Password) { $secPass = ConvertTo-SecureString $Password -AsPlainText -Force } else { $secPass = New-Object System.Security.SecureString }
$cred = [PSCredential]::new($User, $secPass)

# Open SSH session (prefer key if available)
if (Test-Path $KeyFile) {
    Write-Host "Using key file: $KeyFile" -ForegroundColor DarkGray
    $session = New-SSHSession -ComputerName $VpsHost -Credential $cred -KeyFile $KeyFile -AcceptKey
}
else {
    Write-Host "Using password auth" -ForegroundColor DarkGray
    $session = New-SSHSession -ComputerName $VpsHost -Credential $cred -AcceptKey
}
if (-not $session.Connected) { throw "SSH connection failed to $Host" }
Write-Host "SSH connected: $($session.Host)" -ForegroundColor Green

# Backup remote file and upload updated mcp.mjs
$remoteSrc = "$RemotePath/src"
$remoteFile = "$remoteSrc/mcp.mjs"
Invoke-SSHCommand -SessionId $session.SessionId -Command "cp $remoteFile $remoteFile.bak" | Out-Null
Write-Host "Backup created: $remoteFile.bak" -ForegroundColor DarkGray

Write-Host "Uploading mcp.mjs..." -ForegroundColor Yellow
if (Test-Path $KeyFile) {
    Set-SCPItem -ComputerName $VpsHost -Credential $cred -KeyFile $KeyFile -Path "$PSScriptRoot/../src/mcp.mjs" -Destination "$remoteSrc/" -AcceptKey -Force
}
else {
    Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path "$PSScriptRoot/../src/mcp.mjs" -Destination "$remoteSrc/" -AcceptKey -Force
}
Invoke-SSHCommand -SessionId $session.SessionId -Command "wc -c $remoteFile" | Select-Object -ExpandProperty Output | Write-Host

# Restart PM2 process
Write-Host "Restarting PM2 process: $Pm2Process" -ForegroundColor Yellow
Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 restart $Pm2Process && sleep 1" | Out-Null

# Upload and (re)start minimal MCP HTTP Search service
$remoteSearchFile = "$RemotePath/run.search.mjs"
Write-Host "Uploading run.search.mjs (minimal HTTP search service)..." -ForegroundColor Yellow
if (Test-Path $KeyFile) {
    Set-SCPItem -ComputerName $VpsHost -Credential $cred -KeyFile $KeyFile -Path "$PSScriptRoot/../run.search.mjs" -Destination "$RemotePath/" -AcceptKey -Force
}
else {
    Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path "$PSScriptRoot/../run.search.mjs" -Destination "$RemotePath/" -AcceptKey -Force
}
Invoke-SSHCommand -SessionId $session.SessionId -Command "wc -c $remoteSearchFile" | Select-Object -ExpandProperty Output | Write-Host

# Ensure env contains MCP_TOKEN and SEARCH_MCP_PORT
Write-Host "Ensuring .env.server has SEARCH_MCP_PORT and MCP_TOKEN..." -ForegroundColor Yellow
$envServerPre = Invoke-SSHCommand -SessionId $session.SessionId -Command "sed -n '1,220p' $RemotePath/.env.server" | Select-Object -ExpandProperty Output
$hasToken = ($envServerPre | Where-Object { $_ -match '^MCP_TOKEN=' })
$hasPort = ($envServerPre | Where-Object { $_ -match '^SEARCH_MCP_PORT=' })
if ($null -eq $hasPort) {
    Invoke-SSHCommand -SessionId $session.SessionId -Command "echo SEARCH_MCP_PORT=$SearchPort >> $RemotePath/.env.server" | Out-Null
}
if ($null -eq $hasToken) {
    # Generate a simple token if missing
    $genToken = [Guid]::NewGuid().ToString('N')
    Invoke-SSHCommand -SessionId $session.SessionId -Command "echo MCP_TOKEN=$genToken >> $RemotePath/.env.server" | Out-Null
}

# Start or restart PM2 process for search service
Write-Host "Ensuring PM2 process: $SearchPm2Process on port $SearchPort" -ForegroundColor Yellow
$ensureCmd = "bash -lc 'cd $RemotePath && set -a && . ./.env.server && set +a && (pm2 restart $SearchPm2Process || pm2 start run.search.mjs --name $SearchPm2Process) && pm2 save'"
Invoke-SSHCommand -SessionId $session.SessionId -Command $ensureCmd | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "pm2 status $SearchPm2Process" | Select-Object -ExpandProperty Output | Write-Host

# Read MCP token from remote .env.server
$envServer = Invoke-SSHCommand -SessionId $session.SessionId -Command "sed -n '1,220p' $RemotePath/.env.server" | Select-Object -ExpandProperty Output
$tokenLine = ($envServer | Where-Object { $_ -match '^MCP_TOKEN=' })
if ($null -eq $tokenLine) { throw "MCP_TOKEN not found in $RemotePath/.env.server" }
$McpToken = $tokenLine.Split('=')[1]
Write-Host "MCP_TOKEN length: $($McpToken.Length)" -ForegroundColor DarkGray
$headers = @{ Authorization = "Bearer $McpToken" }

# Configure Typesense via MCP admin tool
Write-Host "Applying Typesense runtime config..." -ForegroundColor Yellow
$cfg = @{
    jsonrpc = "2.0"; id = 9001; method = "tools/call";
    params = @{ name = "typesense_config_set"; arguments = @{ host = $TypesenseHost; protocol = $TypesenseProtocol; port = $TypesensePort; apiKey = $TypesenseApiKey; collection = $TypesenseCollection; query_by = $TypesenseQueryBy } }
} | ConvertTo-Json -Depth 6

$respCfg = Invoke-RestMethod -Method Post -Uri "$ServerUrl/mcp/sse" -ContentType "application/json" -Headers $headers -Body $cfg
($respCfg | ConvertTo-Json -Depth 12)

# Health check
Write-Host "Checking Typesense health..." -ForegroundColor Yellow
$bodyHealth = '{
  "jsonrpc": "2.0",
  "id": 9002,
  "method": "tools/call",
  "params": { "name": "typesense_health", "arguments": {} }
}'
$respHealth = Invoke-RestMethod -Method Post -Uri "$ServerUrl/mcp/sse" -ContentType "application/json" -Headers $headers -Body $bodyHealth
($respHealth | ConvertTo-Json -Depth 12)

# Health/info check for minimal HTTP search service
Write-Host "Checking MCP HTTP Search info (direct port)..." -ForegroundColor Yellow
$searchInfoUrl = "http://${VpsHost}:$SearchPort/mcp/info"
$searchInfo = Invoke-RestMethod -Method Get -Uri $searchInfoUrl -Headers $headers -ErrorAction SilentlyContinue
($searchInfo | ConvertTo-Json -Depth 10)

# Run test searches using lowercase objectid
foreach ($oid in $TestObjectIDs) {
    Write-Host "\n--- test search (objectid=$oid) ---" -ForegroundColor Cyan
    $bodySearch = @{
        jsonrpc = "2.0"; id = 9100; method = "tools/call";
        params = @{ name = "typesense_search"; arguments = @{ objectid = $oid } }
    } | ConvertTo-Json -Depth 6
    try {
        $resp = Invoke-RestMethod -Method Post -Uri "$ServerUrl/mcp/sse" -ContentType "application/json" -Headers $headers -Body $bodySearch
        $resp | ConvertTo-Json -Depth 12 | Write-Host
    }
    catch {
        Write-Host "Search error:" $_.Exception.Message -ForegroundColor Red
    }
}

# Run minimal HTTP search tool via JSON-RPC
Write-Host "\n--- qiq_http_search (q=KL4069IA1YRS) ---" -ForegroundColor Cyan
$bodyHttpSearch = @{
    jsonrpc = "2.0"; id = 9200; method = "tools/call";
    params = @{ name = "qiq_http_search"; arguments = @{ q = "KL4069IA1YRS" } }
} | ConvertTo-Json -Depth 6
try {
    $httpSearchUrl = "http://${VpsHost}:$SearchPort/mcp/http"
    $resp2 = Invoke-RestMethod -Method Post -Uri $httpSearchUrl -ContentType "application/json" -Headers $headers -Body $bodyHttpSearch
    $resp2 | ConvertTo-Json -Depth 12 | Write-Host
}
catch {
    Write-Host "HTTP search error:" $_.Exception.Message -ForegroundColor Red
}

Write-Host "\n=== Deploy complete ===" -ForegroundColor Green

# Optional: Nginx mapping for HTTPS domain (reverse proxy to port $SearchPort)
Write-Host "Configuring Nginx mapping for /mcp/http and /mcp/sse under domain (optional step)..." -ForegroundColor Yellow
$remoteNginxConf = "/etc/nginx/sites-available/001-mcp.quickitquote.com"

# Build nginx config using a single-quoted here-string to avoid PowerShell variable expansion
$nginxConfTemplate = @'
server {
    listen 80;
    server_name mcp.quickitquote.com;

    location /mcp/http {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:__PORT__/mcp/http;
    }

    # SSE requires proper headers; pass through as-is
    location /mcp/sse {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_pass http://127.0.0.1:__PORT__/mcp/sse;
    }

    location /mcp/info {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:__PORT__/mcp/info;
    }

    # simple identifier
    location = /whoami {
        proxy_pass http://127.0.0.1:__PORT__/whoami;
    }
}
'@
$nginxConfContent = $nginxConfTemplate -replace '__PORT__', $SearchPort

# Write config on remote
Invoke-SSHCommand -SessionId $session.SessionId -Command "mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled" | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "cat > $remoteNginxConf <<'EOF'
$nginxConfContent
EOF" | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "rm -f /etc/nginx/sites-enabled/mcp.quickitquote.com /etc/nginx/sites-enabled/001-mcp.quickitquote.com" | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "ln -sf $remoteNginxConf /etc/nginx/sites-enabled/001-mcp.quickitquote.com" | Out-Null
# Optionally disable the default site to prevent global HTTP->HTTPS redirects from capturing our host
Invoke-SSHCommand -SessionId $session.SessionId -Command "if [ -e /etc/nginx/sites-enabled/default ]; then mv -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.disabled; fi" | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "nginx -t" | Select-Object -ExpandProperty Output | Write-Host
Invoke-SSHCommand -SessionId $session.SessionId -Command "systemctl reload nginx" | Out-Null
Write-Host "Nginx reloaded. If DNS/TLS are set, https://mcp.quickitquote.com/mcp/http and /mcp/sse proxy to :$SearchPort" -ForegroundColor Green

# Validate origin routing with Host header and inspect headers for possible auth
Write-Host "Validating origin routing via curl..." -ForegroundColor Yellow
$diagScript = @"
#!/usr/bin/env bash
echo '--- /mcp/info (host-mapped) ---'
curl -i -sS -H 'Host: mcp.quickitquote.com' http://127.0.0.1/mcp/info | sed -n '1,25p'
echo
echo '--- POST /mcp/http (host-mapped) ---'
curl -i -sS -H 'Host: mcp.quickitquote.com' -H 'Content-Type: application/json' -X POST http://127.0.0.1/mcp/http --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"qiq_http_search","arguments":{"q":"ping"}}}' | sed -n '1,30p'
echo
echo '--- POST /mcp/sse initialize (host-mapped) ---'
curl -i -sS -H 'Host: mcp.quickitquote.com' -H 'Content-Type: application/json' -X POST http://127.0.0.1/mcp/sse --data '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}' | sed -n '1,25p'
echo
echo '--- whoami direct (3003) ---'
curl -sS http://127.0.0.1:$SearchPort/whoami || true
echo
echo '--- whoami via host map ---'
curl -sS -H 'Host: mcp.quickitquote.com' http://127.0.0.1/whoami || true
echo
echo '--- whoami via host map (headers + location) ---'
curl -i -sS -H 'Host: mcp.quickitquote.com' http://127.0.0.1/whoami -o /dev/null -w 'status=%{http_code} location=%{redirect_url}\n' || true
echo
echo '--- nginx -T head ---'
nginx -T 2>&1 | sed -n '1,200p'
echo
echo '--- nginx: sites-enabled ---'
ls -l /etc/nginx/sites-enabled || true
echo
echo '--- nginx: our vhost file ---'
echo ">>> /etc/nginx/sites-available/001-mcp.quickitquote.com"
sed -n '1,200p' /etc/nginx/sites-available/001-mcp.quickitquote.com || true
echo
echo '--- nginx: search for any server_name mcp.quickitquote.com ---'
grep -RIn "server_name.*mcp.quickitquote.com" /etc/nginx 2>/dev/null || true
echo '--- nginx: any occurrence of mcp.quickitquote.com ---'
grep -RIn "mcp.quickitquote.com" /etc/nginx 2>/dev/null || true
echo
echo '--- nginx: default vhost head ---'
sed -n '1,200p' /etc/nginx/sites-available/default || true
echo
echo '--- nginx: rules with return 301 ---'
grep -RIn "return 301" /etc/nginx 2>/dev/null || true
echo
echo '--- nginx.conf ---'
sed -n '1,220p' /etc/nginx/nginx.conf || true
echo
echo '--- /etc/nginx/conf.d ---'
ls -la /etc/nginx/conf.d || true
for f in /etc/nginx/conf.d/*.conf; do
    echo ">>> $f"; sed -n '1,200p' "$f"; echo; done 2>/dev/null || true
echo
echo '--- nginx: sites-available listing ---'
ls -la /etc/nginx/sites-available || true
echo
echo '>>> default file info'
ls -la /etc/nginx/sites-available/default || true
echo
echo '>>> default file content (raw cat)'
cat /etc/nginx/sites-available/default 2>/dev/null | sed -n '1,200p' || true
echo
echo '>>> existing /etc/nginx/sites-available/mcp.quickitquote.com (if present)'
sed -n '1,240p' /etc/nginx/sites-available/mcp.quickitquote.com 2>/dev/null || true
"@

# Write and run the diagnostic script on the remote host
Invoke-SSHCommand -SessionId $session.SessionId -Command "cat > /tmp/mcp_diag.sh <<'EOSH'
$diagScript
EOSH
chmod +x /tmp/mcp_diag.sh && bash /tmp/mcp_diag.sh" | Select-Object -ExpandProperty Output | Write-Host

# --- Configure new direct HTTPS subdomain (bypass Cloudflare) ---
Write-Host "\nConfiguring origin HTTPS for $NewSubdomain (Let's Encrypt) ..." -ForegroundColor Yellow
$remoteNginxConf2 = "/etc/nginx/sites-available/002-$NewSubdomain"
$nginxConfTemplate2 = @'
server {
    listen 80;
    server_name __HOST__;

    location /mcp/http {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:__PORT__/mcp/http;
    }

    location /mcp/sse {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_pass http://127.0.0.1:__PORT__/mcp/sse;
    }

    location /mcp/info {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:__PORT__/mcp/info;
    }

    location /mcp/tools {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:__PORT__/mcp/tools;
    }

    location = /whoami {
        proxy_pass http://127.0.0.1:__PORT__/whoami;
    }
}
'@
$nginxConfContent2 = ($nginxConfTemplate2 -replace '__PORT__', $SearchPort) -replace '__HOST__', $NewSubdomain

Invoke-SSHCommand -SessionId $session.SessionId -Command "cat > $remoteNginxConf2 <<'EOF'
$nginxConfContent2
EOF" | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "ln -sf $remoteNginxConf2 /etc/nginx/sites-enabled/002-$NewSubdomain" | Out-Null
Invoke-SSHCommand -SessionId $session.SessionId -Command "nginx -t" | Select-Object -ExpandProperty Output | Write-Host
Invoke-SSHCommand -SessionId $session.SessionId -Command "systemctl reload nginx" | Out-Null

# Install certbot if missing and issue certificate
Write-Host "Issuing Let's Encrypt certificate for $NewSubdomain ..." -ForegroundColor Yellow
$leScript = @"
#!/usr/bin/env bash
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y certbot python3-certbot-nginx
fi
certbot --nginx -d $NewSubdomain --non-interactive --agree-tos -m $LetsEncryptEmail --redirect || true
systemctl reload nginx || true
echo DONE
"@
Invoke-SSHCommand -SessionId $session.SessionId -Command "cat > /tmp/issue_cert.sh <<'EOSH'
$leScript
EOSH
chmod +x /tmp/issue_cert.sh && bash /tmp/issue_cert.sh" | Select-Object -ExpandProperty Output | Write-Host

Write-Host "\nOrigin HTTPS configured. Try: https://$NewSubdomain/mcp/info and /mcp/tools" -ForegroundColor Green
