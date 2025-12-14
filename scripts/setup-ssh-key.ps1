param(
    [Parameter(Mandatory = $true)] [string]$Password,
    [string]$VpsHost = "109.199.105.196",
    [string]$User = "root",
    [string]$PublicKeyPath,
    [string]$PrivateKeyPath
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PublicKeyPath) { $PublicKeyPath = Join-Path $scriptDir 'keys\qiq-vps.pub' }
if (-not $PrivateKeyPath) { $PrivateKeyPath = Join-Path $scriptDir 'keys\qiq-vps' }

Write-Host "\n=== Setup SSH key on VPS: $VpsHost ===" -ForegroundColor Cyan

if (-not (Test-Path $PublicKeyPath)) { throw "Public key not found: $PublicKeyPath" }

# Ensure Posh-SSH module
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Install-Module Posh-SSH -Force -Scope CurrentUser | Out-Null
}
Import-Module Posh-SSH

# Create password credential
$secPass = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = [PSCredential]::new($User, $secPass)

# Connect via password to install key
$session = New-SSHSession -ComputerName $VpsHost -Credential $cred -AcceptKey
if (-not $session.Connected) { throw "SSH connection failed to $VpsHost" }
Write-Host "SSH connected (password)" -ForegroundColor Green

# Ensure .ssh exists and secure
Invoke-SSHCommand -SessionId $session.SessionId -Command 'mkdir -p ~/.ssh && chmod 700 ~/.ssh' | Out-Null

# Upload pubkey and append to authorized_keys
Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path $PublicKeyPath -Destination '/root/.ssh/' -AcceptKey -Force
$pubFileName = [System.IO.Path]::GetFileName($PublicKeyPath)
Invoke-SSHCommand -SessionId $session.SessionId -Command "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && cat ~/.ssh/$pubFileName >> ~/.ssh/authorized_keys" | Out-Null

# Verify authorized_keys contains our key
Invoke-SSHCommand -SessionId $session.SessionId -Command "tail -n 1 ~/.ssh/authorized_keys" | Select-Object -ExpandProperty Output | Write-Host

# Test key-based login
$emptySecure = New-Object System.Security.SecureString
$credKey = [PSCredential]::new($User, $emptySecure)
$session2 = New-SSHSession -ComputerName $VpsHost -Credential $credKey -KeyFile $PrivateKeyPath -AcceptKey
Write-Host ("Key login connected: {0}" -f $session2.Connected) -ForegroundColor Green
Invoke-SSHCommand -SessionId $session2.SessionId -Command "hostname; whoami" | Select-Object -ExpandProperty Output | Write-Host

Write-Host "\n=== SSH key setup complete ===" -ForegroundColor Green
