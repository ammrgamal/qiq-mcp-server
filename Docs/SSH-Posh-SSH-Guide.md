# SSH on VPS via Posh-SSH (Standard Method)

Use this method for all SSH operations from PowerShell/VS Code. It avoids common credential pitfalls and persists the session id for reuse.

## Quick Start

- Script: `scripts/posh-ssh-session.ps1`
- Recommended: key-based auth; fallback: password with SecureString
- Persisted SessionId variable: `$Global:sshSessionId`

### Connect (password prompt)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\posh-ssh-session.ps1 -SshHost 109.199.105.196 -User root -AcceptKey -PersistGlobal
```

### Connect (explicit password)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\posh-ssh-session.ps1 -SshHost 109.199.105.196 -User root -Password "<YOUR_PASSWORD>" -AcceptKey -PersistGlobal
```

### Connect (SSH key)
```powershell
# Auto-detects id_ed25519 or id_rsa if present under %USERPROFILE%\.ssh
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\posh-ssh-session.ps1 -SshHost 109.199.105.196 -User root -AcceptKey -PersistGlobal
```

### Run a command on connect
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\posh-ssh-session.ps1 -SshHost 109.199.105.196 -User root -AcceptKey -PersistGlobal -Command "uname -a; whoami; ls -la /opt/qiq-mcp-server"
```

### Execute commands on existing session
```powershell
Invoke-SSHCommand -SessionId $Global:sshSessionId -Command "journalctl -u cloudflared -n 100 --no-pager" | Format-List
```

### Disconnect
```powershell
Disconnect-SSHSession -SessionId $Global:sshSessionId
Remove-SSHSession -SessionId $Global:sshSessionId
```

## Notes
- The script auto-installs and imports `Posh-SSH` if missing.
- Avoid embedding cleartext passwords in committed files. Prefer prompting or secrets managers.
- `-AcceptKey` will trust the host key on first connect; verify fingerprints if this is a new server.
- For CI or automation, prefer key-based auth with passphrase.
