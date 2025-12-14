param(
    [Parameter(Mandatory = $true)] [string]$ObjectID,
    [string]$ServerUrl = "https://mcp.quickitquote.com",
    [string]$Token
)

# Build headers if token provided
$headers = @{}
if ($Token -and $Token.Trim().Length -gt 0) {
    $headers["Authorization"] = "Bearer $Token"
}

# Construct JSON-RPC body
$body = @{
    jsonrpc = "2.0"
    id      = 1
    method  = "tools/call"
    params  = @{ name = "typesense_search"; arguments = @{ objectID = $ObjectID } }
} | ConvertTo-Json -Depth 5

$uri = "$ServerUrl/mcp/sse"

Write-Host "\n--- typesense_search ($ObjectID) ---"
try {
    $resp = Invoke-RestMethod -Method Post -Uri $uri -Body $body -ContentType "application/json" -Headers $headers
    $resp | ConvertTo-Json -Depth 12
}
catch {
    Write-Host "typesense_search error:" $_.Exception.Message
    if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
    exit 1
}
