# QIQ MCP Server

Minimal MCP WebSocket server (JSON-RPC 2.0) for OpenAI Agent Builder, runs locally and on any Node hosting. No Cloudflare required.

## Features
...
## Quick Start
...
## JSON-RPC Methods
...
## Connect from OpenAI Agent (Agent Builder)
Use the MCP tool in Agent Builder and connect to your server:
- URL: `wss://<your-domain-or-tunnel>/mcp`
- Label: QIQ MCP
- Description: QIQ MCP WebSocket
- Authentication: None
- Subprotocol: Client sets `mcp`; server supports `mcp` and `jsonrpc`.

## Local → Public (tunnel)
### ngrok
```
ngrok config add-authtoken <YOUR_TOKEN>
ngrok http 3001
```
MCP URL: `wss://<random>.ngrok-free.dev/mcp`

### localtunnel (no account)
```
npx localtunnel --port 3001 --subdomain qiqlab
```
MCP URL: `wss://qiqlab.loca.lt/mcp`

## Roadmap
## Deploy to Google Cloud Run

Cloud Run expects the container to listen on `$PORT` (default 8080). This repo includes a `Dockerfile` that starts the MCP server and binds to `$PORT` via the `PORT` env.

Steps (high-level):
- Build and push the image to Artifact Registry or GCR.
- Create a Cloud Run service using that image.
- Ensure WebSockets are enabled (HTTP/1.1 is supported by Cloud Run) and map traffic to `/mcp`.

Your Cloud Run MCP URL will be:
`wss://<your-cloud-run-service-url>/mcp`

If Cloud Build complains about missing Dockerfile, ensure the Dockerfile exists at the repo root (it does now). If your trigger expects a different path, update it accordingly.
...
# qiq-mcp-server