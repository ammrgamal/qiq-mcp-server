param(
    [string]$VpsHost = "109.199.105.196",
    [string]$KeyFile = "scripts\\keys\\qiq-vps"
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
    $cmd = "grep -m1 -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' /var/log/cloudflared-3003.log || true"
    $out = Invoke-SSHCommand -SessionId $sess.SessionId -Command $cmd
    $url = ($out.Output | Where-Object { $_ -match 'trycloudflare' } | Select-Object -First 1)
    if (-not $url) {
        # show last lines of the log to help debug
        $tail = Invoke-SSHCommand -SessionId $sess.SessionId -Command "tail -n 80 /var/log/cloudflared-3003.log 2>/dev/null || true"
        Write-Output "[no URL yet]"
        Write-Output $tail.Output
    } else {
        Write-Output $url
    }
}
finally {
    if ($sess) { Remove-SSHSession -SessionId $sess.SessionId | Out-Null }
}
