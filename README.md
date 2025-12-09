# QuickItQuote MCP HTTP/SSE Server

Minimal MCP server over HTTP + Server‑Sent Events (SSE) with token auth and CORS for OpenAI Agent Builder. Includes built‑in tools for Typesense search and QIQ scoring.

## Features
- HTTP JSON‑RPC at `POST /mcp/sse` and SSE stream at `GET /mcp/sse`
- Handshake via `initialize`
- `tools/list` and `tools/call` supported
- Built‑in tools:
	- `ping` – sanity check
	- `typesense_search` – search Typesense and normalize product results
	- `qiq_scoring` – simple, transparent ranking (price‑based baseline)
- Token auth via `Authorization: Bearer <MCP_TOKEN>`

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

Server listens on `http://0.0.0.0:<PORT>` (default 8080).

Endpoints:
- `GET /mcp/sse` → SSE stream (sends `initialize` and keep‑alive pings)
- `POST /mcp/sse` → JSON‑RPC requests (e.g., `tools/list`, `tools/call`)
- `GET /mcp/info` → health/tools (requires token if configured)

Auth: set `MCP_TOKEN` then pass it via `Authorization: Bearer <token>`.

Environment variables: see `.env.example`.

### Test endpoints
- List tools
	- `POST /mcp/sse` with body `{ "jsonrpc":"2.0","id":1,"method":"tools/list","params":{} }`
- Call Typesense search
	- `POST /mcp/sse` with body
		`{ "jsonrpc":"2.0","id":2,"method":"tools/call","params":{ "name":"typesense_search", "arguments": { "category":"edr","keywords":"license", "quantity":100 } } }`
- Score results
	- `POST /mcp/sse` with body
		`{ "jsonrpc":"2.0","id":3,"method":"tools/call","params":{ "name":"qiq_scoring", "arguments": { "products":[...], "context":{ "solutionType":"EDR","seats":100,"termYears":1 } } } }`

## Deployment

This repository includes a Dockerfile that:
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

For a permanent HTTPS domain, you can front the service with Cloudflare Tunnel and use the `https://<domain>/mcp/sse` URL in OpenAI Agent Builder.