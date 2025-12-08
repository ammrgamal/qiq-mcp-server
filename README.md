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

## Cloud Build + Artifact Registry (Quick Setup)

This repo includes a `cloudbuild.yaml` that builds the Docker image and pushes it to Artifact Registry under:

```
${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPOSITORY}/${_IMAGE}:{latest|$COMMIT_SHA}
```

Default substitutions:
- `_REGION`: `europe-west1`
- `_REPOSITORY`: `mcp-server`
- `_IMAGE`: `mcp-server`

The build config now ensures the Artifact Registry repository exists (creates it if missing) before pushing.

### Trigger configuration
- Set your Cloud Build trigger to use the config file: `cloudbuild.yaml`.
- Optionally override substitutions for region/repository/image.

### Manual submit (optional)
```bash
gcloud builds submit --config=cloudbuild.yaml \
	--substitutions=_REGION=europe-west1,_REPOSITORY=mcp-server,_IMAGE=mcp-server
```

### Permissions
- Ensure the Cloud Build service account has `roles/artifactregistry.writer` on your repository (or project) if push access fails.

### Deploy to Cloud Run
```bash
gcloud run deploy mcp-server \
	--image europe-west1-docker.pkg.dev/$PROJECT_ID/mcp-server/mcp-server:latest \
	--region europe-west1 \
	--allow-unauthenticated \
	--port 8080
```

Your MCP URL: `wss://<cloud-run-service-url>/mcp`