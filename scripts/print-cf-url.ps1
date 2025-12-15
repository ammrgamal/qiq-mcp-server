param(
    [string]$VpsHost = "109.199.105.196",
    [string]$KeyFile = "keys\\qiq-vps",
    [switch]$Start
)

# Ensure Posh-SSH is available
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Install-Module Posh-SSH -Force -Scope CurrentUser | Out-Null
}
Import-Module Posh-SSH

$secPass = New-Object System.Security.SecureString
$cred = New-Object System.Management.Automation.PSCredential ('root', $secPass)
$keyPath = if ([System.IO.Path]::IsPathRooted($KeyFile)) { $KeyFile } else { Join-Path $PSScriptRoot $KeyFile }
$sess = New-SSHSession -ComputerName $VpsHost -Credential $cred -KeyFile $keyPath -AcceptKey

try {
    if ($Start) {
        Write-Output "[starting ephemeral tunnel on port 3003]"
        $startCmd = @'
    cmd=/usr/local/bin/cloudflared; if ! command -v "$cmd" >/dev/null 2>&1; then cmd=cloudflared; fi
    pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3003" 2>/dev/null || true
    nohup $cmd tunnel --no-autoupdate --url http://127.0.0.1:3003 > /var/log/cloudflared-3003.log 2>&1 &
    sleep 2
    ps aux | grep -i "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3003" | grep -v grep || true
    ls -l /var/log/cloudflared-3003.log 2>/dev/null || true
'@
        Invoke-SSHCommand -SessionId $sess.SessionId -Command $startCmd | Out-Null
    }

    $cmd = "grep -m1 -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' /var/log/cloudflared-3003.log || true"
    $out = Invoke-SSHCommand -SessionId $sess.SessionId -Command $cmd
    $url = ($out.Output | Where-Object { $_ -match 'trycloudflare' } | Select-Object -First 1)
    if (-not $url) {
        # show diagnostics to help debug
        $ls = Invoke-SSHCommand -SessionId $sess.SessionId -Command "ls -l /var/log | grep cloudflared || true"
        $ps = Invoke-SSHCommand -SessionId $sess.SessionId -Command "ps aux | grep -i cloudflared | grep -v grep || true"
        $tail = Invoke-SSHCommand -SessionId $sess.SessionId -Command "tail -n 120 /var/log/cloudflared-3003.log 2>/dev/null || true"
        Write-Output "[no URL yet]"
        Write-Output "--- /var/log entries (cloudflared*) ---"
        Write-Output $ls.Output
        Write-Output "--- running processes (cloudflared) ---"
        Write-Output $ps.Output
        Write-Output "--- log tail ---"
        Write-Output $tail.Output
    }
    else {
        Write-Output $url
    }
}
finally {
    if ($sess) { Remove-SSHSession -SessionId $sess.SessionId | Out-Null }
}
