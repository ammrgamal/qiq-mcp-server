param(
    [string]$Password,
    [string]$VpsHost = "109.199.105.196",
    [string]$User = "root",
    [string]$ServerUrl = "https://mcp.quickitquote.com",
    [string]$RemotePath = "/opt/qiq-mcp-server",
    [string]$Pm2Process = "qiq-mcp-http",
    [string]$TypesenseHost = "b7p0h5alwcoxe6qgp-1.a1.typesense.net",
    [string]$TypesenseProtocol = "https",
    [int]$TypesensePort = 443,
    [string]$TypesenseApiKey = "7e7izXzNPboi42IaKNl63MTWR7ps7ROo",
    [string]$TypesenseCollection = "quickitquote_products",
    [string]$TypesenseQueryBy = "object_id,name,brand,category",
    [string[]]$TestObjectIDs = @("KL4069IA1XXS", "KL4069IA1YRS"),
    [string]$KeyFile = $(Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'keys\qiq-vps')
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

Write-Host "\n=== Deploy complete ===" -ForegroundColor Green
