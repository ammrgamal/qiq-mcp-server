# Generic MCP WebSocket Server (Node.js)

Fully dynamic, framework-free MCP server over WebSocket (JSON-RPC 2.0). No fixed filenames or layouts are required — the module exports a clean API and a tiny runner for convenience.

## Features
- MCP handshake via `initialize`
- Dynamic tools list via `tools/list`
- Tool invocation via `tools/call`
- Example tool: `ping` returns `{ status: "ok" }`
- Supports multiple WebSocket clients
- Clean module export: `createMcpServer(options)`

## Local → Public (tunnel)
## Usage

### Module API
```js
import { createMcpServer } from './src/mcp.mjs';

const server = createMcpServer({
	name: 'MY_MCP',
	version: '1.0.0',
	// port is taken from process.env.PORT with fallback to 8080
});

// Add a dynamic tool at runtime
server.registerTool('echo', {
	description: 'Echo text back',
	inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
	outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
	call: async ({ text }) => ({ text }),
});

await server.start();
```

### Local run
```bash
npm install
npm run start
```

Server listens on `ws://0.0.0.0:<PORT>/mcp` using `PORT` env or falls back to 8080.

### Test via MCP CLI
```bash
npx @modelcontextprotocol/cli dev --url ws://localhost:8080/mcp --label "Generic MCP" --subprotocol mcp
```
You should see `initialize` succeed and `tools/list` include `ping`.

## Roadmap
## Dockerfile (Cloud Run)

This repository includes a generic Dockerfile that:
- Installs production dependencies
- Starts the runner `run.mjs`
- Uses `PORT` from environment (Cloud Run sets it automatically; fallback 8080)

### Build locally
```bash
docker build -t generic-mcp:latest .
docker run -e PORT=8080 -p 8080:8080 generic-mcp:latest
```

### Deploy to Cloud Run
```bash
gcloud run deploy generic-mcp \
	--image <REGION>-docker.pkg.dev/<PROJECT>/<REPO>/<IMAGE>:latest \
	--region <REGION> \
	--allow-unauthenticated \
	--port 8080
```

Notes:
- Cloud Run supports WebSockets over HTTP/1.1. Use `wss://<service-url>/mcp` in clients.
- Subprotocol negotiation: client should request `mcp`; server supports `mcp` and `jsonrpc`.

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