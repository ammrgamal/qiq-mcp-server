param(
    [Parameter(Mandatory = $true)][string]$SshHost,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $false)][string]$Password,
    [Parameter(Mandatory = $false)][string]$KeyFile,
    [Parameter(Mandatory = $false)][string]$KeyPass,
    [Parameter(Mandatory = $false)][switch]$AcceptKey,
    [Parameter(Mandatory = $false)][string]$Command,
    [Parameter(Mandatory = $false)][switch]$PersistGlobal
)

# Ensure Posh-SSH is available and imported
try {
    if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
        Install-Module Posh-SSH -Scope CurrentUser -Force -ErrorAction Stop
    }
    Import-Module Posh-SSH -ErrorAction Stop
}
catch {
    Write-Error "Failed to install/import Posh-SSH: $($_.Exception.Message)"
    exit 1
}

# Build credential or key parameters
$session = $null
$accept = $false
if ($AcceptKey) { $accept = $true }

try {
    # Auto-detect default key if none provided
    if (-not $KeyFile -or [string]::IsNullOrWhiteSpace($KeyFile)) {
        $defaultKeyEd = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
        $defaultKeyRsa = Join-Path $env:USERPROFILE ".ssh\id_rsa"
        if (Test-Path $defaultKeyEd) { $KeyFile = $defaultKeyEd }
        elseif (Test-Path $defaultKeyRsa) { $KeyFile = $defaultKeyRsa }
    }

    if ($KeyFile) {
        # Key-based authentication (recommended)
        if ($KeyPass) {
            $secKeyPass = ConvertTo-SecureString $KeyPass -AsPlainText -Force
            $session = New-SSHSession -ComputerName $SshHost -UserName $User -KeyFile $KeyFile -KeyPass $secKeyPass -AcceptKey:$accept -ErrorAction Stop
        }
        else {
            $session = New-SSHSession -ComputerName $SshHost -UserName $User -KeyFile $KeyFile -AcceptKey:$accept -ErrorAction Stop
        }
    }
    else {
        # Password-based authentication
        $cred = $null
        if ($Password) {
            $secPass = ConvertTo-SecureString $Password -AsPlainText -Force
            $cred = New-Object System.Management.Automation.PSCredential ($User, $secPass)
        }
        else {
            $cred = Get-Credential -UserName $User -Message "Enter password for $User@$SshHost"
        }
        $session = New-SSHSession -ComputerName $SshHost -Credential $cred -AcceptKey:$accept -ErrorAction Stop
    }
}
catch {
    Write-Error "Failed to establish SSH session: $($_.Exception.Message)"
    exit 1
}

# Persist for reuse in current terminal
if ($PersistGlobal -or $true) {
    $Global:sshSessionId = $session.SessionId
}

# Print session summary
$session | Format-Table SessionId, Host, Connected | Out-String | Write-Host

# Run optional command
if ($Command) {
    try {
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $Command -ErrorAction Stop
        $result | Format-List | Write-Host
    }
    catch {
        Write-Warning "Command execution failed: $($_.Exception.Message)"
    }
}
