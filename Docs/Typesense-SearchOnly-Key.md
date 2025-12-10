# Create a scoped "search-only" Typesense API key

Use an Admin API Key once to mint a least-privilege key that allows only `documents:search` on your products collection. Prefer setting a short TTL and (optionally) IP restrictions.

Never embed the Admin key in apps or MCP. Only the search-only key should be used at runtime.

## What you need
- Admin API key (temporary use to create the child key)
- Cluster endpoint (protocol, host, port)
- Collection name (e.g., `quickitquote_products`)

## curl
```bash
# Admin call to create a new key
curl -sS -X POST "https://<HOST>:<PORT>/keys" \
  -H "X-TYPESENSE-API-KEY: <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "QIQ MCP search-only",
    "actions": ["documents:search"],
    "collections": ["quickitquote_products"],
    "expires_at": <UNIX_EPOCH_SECONDS_OR_NULL>,
    "value": null,
    "indexes": null,
    "referrers": [],
    "limit_searches_to": null,
    "max_qps": null
  }'
```
- Replace `<HOST>`, `<PORT>`, `<ADMIN_KEY>`.
- Set `expires_at` to a future Unix timestamp for automatic expiry (or omit for no expiry).

Response contains the new key string in `value`. Store it securely and set it as `TYPESENSE_SEARCH_ONLY_KEY` in your environment.

## Node.js (admin action)
```js
import Typesense from 'typesense';

const client = new Typesense.Client({
  nodes: [{ host: process.env.TYPESENSE_HOST, port: Number(process.env.TYPESENSE_PORT||443), protocol: process.env.TYPESENSE_PROTOCOL||'https' }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY,
});

const body = {
  description: 'QIQ MCP search-only',
  actions: ['documents:search'],
  collections: ['quickitquote_products'],
  expires_at: null, // or Math.floor(Date.now()/1000) + 60*60*24*30 // 30 days
};

const key = await client.keys().create(body);
console.log('Search-only key:', key.value);
```

## Recommended environment variables
- TYPESENSE_PROTOCOL=https
- TYPESENSE_HOST=<cluster-host>
- TYPESENSE_PORT=443
- TYPESENSE_COLLECTION=quickitquote_products
- TYPESENSE_SEARCH_ONLY_KEY=<the-new-key>

MCP will read these automatically on boot, or you can apply them live using the `typesense_config_set` MCP tool.
