param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $false)][string]$SshHost = "109.199.105.196",
    [Parameter(Mandatory = $false)][string]$User = "root"
)

# Ensure Posh-SSH
try {
    if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
        Install-Module Posh-SSH -Scope CurrentUser -Force -ErrorAction Stop
    }
    Import-Module Posh-SSH -ErrorAction Stop
}
catch {
    Write-Error "Posh-SSH module error: $($_.Exception.Message)"; exit 1
}

# Ensure session exists and is connected; if not, create it via helper
$needConnect = $true
if ($Global:sshSessionId) {
    try {
        $dummy = Invoke-SSHCommand -SessionId $Global:sshSessionId -Command "echo ok" -ErrorAction Stop
        $needConnect = $false
    }
    catch { $needConnect = $true }
}

if ($needConnect) {
    # Try key-based first (helper script will auto-detect keys and fall back to password prompt)
    $helper = Join-Path $PSScriptRoot "posh-ssh-session.ps1"
    if (-not (Test-Path $helper)) { Write-Error "Missing helper script: posh-ssh-session.ps1"; exit 1 }
    # Ensure session exists and is connected; if not, create it directly here
    $needConnect = $true
    if ($Global:sshSessionId) {
        try {
            $dummy = Invoke-SSHCommand -SessionId $Global:sshSessionId -Command "echo ok" -ErrorAction Stop
            $needConnect = $false
        }
        catch { $needConnect = $true }
    }

    if ($needConnect) {
        # Auto-detect SSH key paths
        $keyEd = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
        $keyRsa = Join-Path $env:USERPROFILE ".ssh\id_rsa"
        $keyToUse = $null
        if (Test-Path $keyEd) { $keyToUse = $keyEd }
        elseif (Test-Path $keyRsa) { $keyToUse = $keyRsa }

        try {
            if ($keyToUse) {
                $session = New-SSHSession -ComputerName $SshHost -UserName $User -KeyFile $keyToUse -AcceptKey -ErrorAction Stop
            }
            else {
                $cred = Get-Credential -UserName $User -Message "Enter password for $User@$SshHost"
                $session = New-SSHSession -ComputerName $SshHost -Credential $cred -AcceptKey -ErrorAction Stop
            }
            $Global:sshSessionId = $session.SessionId
            $needConnect = $false
        }
        catch {
            Write-Error "Failed to establish SSH session: $($_.Exception.Message)"; exit 1
        }
    }
}

# Execute the requested command on the connected session
try {
    $res = Invoke-SSHCommand -SessionId $Global:sshSessionId -Command $Command -ErrorAction Stop
    $res | Format-List | Write-Host
}
catch {
    Write-Error "SSH command failed: $($_.Exception.Message)"; exit 1
}
