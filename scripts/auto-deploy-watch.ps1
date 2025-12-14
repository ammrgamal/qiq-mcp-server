$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$stateFile = Join-Path $workspace ".deploy_last.sha"

Write-Host "=== Auto Deploy Watch started ===" -ForegroundColor Cyan
Write-Host "Workspace: $workspace" -ForegroundColor DarkGray

function Get-HeadHash() {
    try {
        $hash = git -C $workspace rev-parse HEAD
        return $hash.Trim()
    }
    catch {
        return $null
    }
}

while ($true) {
    try {
        $current = Get-HeadHash
        if (-not $current) { Write-Host "Not a git repo or git unavailable" -ForegroundColor Yellow; Start-Sleep -Seconds 60; continue }
        $previous = if (Test-Path $stateFile) { Get-Content $stateFile -TotalCount 1 } else { "" }
        if ($current -ne $previous) {
            Write-Host "New commit detected: $current (prev=$previous) → deploying..." -ForegroundColor Green
            powershell -File (Join-Path $scriptDir "deploy-vps.ps1") | Write-Host
            Set-Content -Path $stateFile -Value $current -Encoding ASCII
            Write-Host "Deploy done. State updated." -ForegroundColor Green
        }
        else {
            Write-Host "No changes (HEAD=$current)." -ForegroundColor DarkGray
        }
    }
    catch {
        Write-Host "Auto deploy error:" $_.Exception.Message -ForegroundColor Red
    }
    Start-Sleep -Seconds 60
}
