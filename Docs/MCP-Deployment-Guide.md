# QIQ MCP Server – Deployment & Operations Guide (Live Values)

This document captures the current, working configuration for the QIQ MCP Server, including HTTP/SSE endpoints, authentication, Cloudflare Tunnel, and Typesense integration. It is intended for developers and Copilot agents to use as the single source of truth when operating or modifying the system.

Do not use placeholder values—everything here reflects the real configuration from the project’s environment files and current VPS.

---

## Overview

- MCP transport: HTTP + SSE
- Auth: Bearer token or query param (?token=)
- Cloudflare Named Tunnel: qiq-mcp → mcp.quickitquote.com
- Node runtime: v18.19.1 (PM2 managed)
- Repo path on VPS: /opt/qiq-mcp-server (PM2 app qiq-mcp-http)

---

## Endpoints

- SSE stream (GET; returns JSON-RPC initialize as SSE messages):
  - https://mcp.quickitquote.com/mcp/sse?token=0a4779a0-aab7-469f-84fd-bc3c8390d435
  - Alternative alias for SSE GET (same stream):
    - https://mcp.quickitquote.com/mcp/http?token=0a4779a0-aab7-469f-84fd-bc3c8390d435

- JSON-RPC over HTTP (POST):
  - https://mcp.quickitquote.com/mcp/sse  (Content-Type: application/json)
  - Authorization: Bearer 0a4779a0-aab7-469f-84fd-bc3c8390d435
  - Methods: initialize, tools/list, tools/call

- Health/info:
  - GET https://mcp.quickitquote.com/mcp/info (requires token)
  - GET https://mcp.quickitquote.com/ (no auth, returns ok + tools)

---

## Authentication

Server accepts any one of:
- Authorization: Bearer 0a4779a0-aab7-469f-84fd-bc3c8390d435
- X-Access-Token: 0a4779a0-aab7-469f-84fd-bc3c8390d435
- ?token=0a4779a0-aab7-469f-84fd-bc3c8390d435 in the URL

Note: Agent Builder often fails to attach Authorization on the initial SSE GET—use the ?token= query param for the SSE connect step.

---

## Environment – Local (.env)

From `./.env`:

```
MCP_HOST=0.0.0.0
PORT=8080
MCP_PORT=3001
HTTP_PORT=3002
MCP_TOKEN=0a4779a0-aab7-469f-84fd-bc3c8390d435

TYPESENSE_PROTOCOL=https
TYPESENSE_HOST=b7p0h5alwcoxe6qgp-1.a1.typesense.net
TYPESENSE_PORT=443
TYPESENSE_COLLECTION=quickitquote_products
TYPESENSE_SEARCH_ONLY_KEY=7e7izXzNPboi42IaKNl63MTWR7ps7ROo
```

## Environment – Server (.env.server)

From `/opt/qiq-mcp-server/.env.server`:

```
MCP_HOST=0.0.0.0
MCP_PORT=3001
HTTP_PORT=3002
MCP_TOKEN=0a4779a0-aab7-469f-84fd-bc3c8390d435

TYPESENSE_HOST=b7p0h5alwcoxe6qgp-1.a1.typesense.net
TYPESENSE_PROTOCOL=https
TYPESENSE_PORT=443
TYPESENSE_SEARCH_ONLY_KEY=7e7izXzNPboi42IaKNl63MTWR7ps7ROo
TYPESENSE_COLLECTION=quickitquote_products
TYPESENSE_QUERY_BY=name,brand,category
```

## Environment – Vercel (.env.vercel)

This environment contains numerous variables for web app integrations. Key values relevant to MCP/ops are listed here for completeness (do not change from MCP server):

```
BASE_URL="https://quickitquote.com"
VERCEL_URL="https://v0-quickitquote.vercel.app"
CLOUDFLARE_ACCOUNT_ID="4359ffcd028da1b7719335e68e32cdb9"
TYPESENSE_HOST="b7p0h5alwcoxe6qgp-1.a1.typesense.net"
TYPESENSE_PROTOCOL="https"
TYPESENSE_PORT="443"
TYPESENSE_COLLECTION="quickitquote_products"
TYPESENSE_SEARCH_ONLY_KEY="7e7izXzNPboi42IaKNl63MTWR7ps7ROo"
```

Note: `.env.vercel` includes many other service keys—leave them scoped to Vercel app usage and do not copy into server runtime.

---

## Cloudflare Tunnel

- Named Tunnel: qiq-mcp
- UUID: 9f9f5df4-a7a7-4845-b04f-cd2547a8db7d
- Systemd service: cloudflared.service (Active)
- Config: `/etc/cloudflared/config.yml`

```
tunnel: 9f9f5df4-a7a7-4845-b04f-cd2547a8db7d
credentials-file: /root/.cloudflared/9f9f5df4-a7a7-4845-b04f-cd2547a8db7d.json
ingress:
  - hostname: mcp.quickitquote.com
    service: http://localhost:3002
  - service: http_status:404
```

- DNS (Cloudflare):
  - CNAME mcp.quickitquote.com → 9f9f5df4-a7a7-4845-b04f-cd2547a8db7d.cfargotunnel.com (Proxied)

---

## Runtime & Process Manager

- Node: v18.19.1
- PM2 app: qiq-mcp-http
- PM2 script: `run.mjs` (Express HTTP/SSE server)
- Exec CWD: /opt/qiq-mcp-server
- Listening: 0.0.0.0:3002

Common operations:

```bash
# SSH into VPS
ssh root@109.199.105.196

# Update code & restart
cd /opt/qiq-mcp-server
git fetch --all ; git pull --rebase
npm install --omit=dev --no-audit --no-fund
pm2 restart qiq-mcp-http --update-env

# Inspect logs
tail -n 200 /root/.pm2/logs/qiq-mcp-http-out.log
```

---

## MCP Tools

Currently registered tools:
- ping
- typesense_search

typesense_search
- Input schema (any of):
  - objectID: string
  - objectIDs: string[]
  - keywords: string (optional)
  - category: string (optional)
- Output schema:
  - { products: [ { objectID, name, brand, item_type, category, price, list_price, availability, image, spec_sheet, url } ] }
- Behavior:
  - Identifiers normalized to lowercase server-side (objectID/objectIDs)
  - Matches against Typesense fields: objectID, object_id, id, mpn, manufacturer_part_number, vendor_mpn, sku
  - Keywords fallback uses query_by from env (`name,brand,category`)

Example JSON-RPC calls:

Tools list:
```
POST https://mcp.quickitquote.com/mcp/sse
Authorization: Bearer 0a4779a0-aab7-469f-84fd-bc3c8390d435
Body: { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
```

Call with objectIDs:
```
POST https://mcp.quickitquote.com/mcp/sse
Authorization: Bearer 0a4779a0-aab7-469f-84fd-bc3c8390d435
Body: {
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": { "name": "typesense_search", "arguments": { "objectIDs": ["S4H77A","R8Z34A"] } }
}
```

---

## Typesense Data Reference

From `vw_TypesenseProducts.csv` (selected rows):

- Identity & Pricing:
  - objectID (text) → exact manufacturer part number
  - mpn_normalized (text) → lowercase normalized variant for match/search
  - vendor_mpn (text)
  - sku (text)
  - name (text)
  - brand (text)
  - item_type (text)
  - category (text)
  - price (number)
  - list_price (number)
  - availability (number)

- Media & Documents:
  - image (url) → https://cdn.quickitquote.com/... 
  - spec_sheet (url) → https://cdn.quickitquote.com/specs/...

- Additional descriptive fields exist (short_description, specs_table, etc.) but are not required by the MCP output schema.

---

## Agent Builder Guidance

- Always connect using the SSE GET with ?token, because some browsers/flows do not attach Authorization to GET:
  - https://mcp.quickitquote.com/mcp/sse?token=0a4779a0-aab7-469f-84fd-bc3c8390d435
- For POST JSON-RPC, attach Authorization: Bearer token.
- When passing identifiers, it’s safe to send in any case; the server normalizes to lowercase.
- Avoid changing tunnel config to point to port 8080—the Express server is bound to 3002 and cloudflared ingress is set accordingly.

---

## Things to Avoid

- Do not overwrite `.env.server` on the VPS without preserving MCP_TOKEN and Typesense keys.
- Do not switch the cloudflared ingress back to localhost:8080; keep it at localhost:3002.
- Do not change tool output schema; UI nodes rely on the exact product shape.
- Do not expose `.env.vercel` secrets to the server runtime; keep them in Vercel only.

---

## Location of this guide

- Saved at: `Docs/MCP-Deployment-Guide.md`

Keep this file up-to-date after any config changes.
