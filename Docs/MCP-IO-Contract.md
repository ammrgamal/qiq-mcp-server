# MCP I/O contract and Agent Builder wiring

This server exposes MCP tools over HTTP/SSE. The primary tools used by the QIQ workflow are:
- typesense_search
- qiq_scoring
- typesense_health
- typesense_check_permissions (new)
- typesense_config_set (admin)

## Inputs the MCP needs (before calling)
Provide these in your workflow prior to the MCP node:
- category: string (can be empty if you want broader matches)
- keywords: string (the full query text; identifiers like `KL4066IAVFS` are detected automatically)
- quantity: number|null (optional; defaults to 1)
- duration_years: number|null (optional; currently unused by the tool; reserved for future scoring/filters)

## Output from MCP (after calling)
`typesense_search` returns:
```
{
  products: Array<{
    sku: string
    name: string
    brand: string
    price: number
    quantity: number
    score?: number
  }>
}
```

`qiq_scoring` accepts `{ products, context? }` and returns `{ products }` with a `score` appended and sorted highest-first.

`typesense_check_permissions` returns a cheap capability probe:
```
{
  canSearch: boolean,
  status: 'ok:hits=N' | 'unauthorized' | 'forbidden' | 'collection-not-found' | 'not-initialized' | 'no-collection' | 'http-XXX' | 'error',
  host: string,
  protocol: string,
  port: number,
  collection: string,
  keyLength: number,
  error?: string
}
```

## Agent Builder wiring (nodes around MCP)

Before MCP: a Transform/Agent node that ensures a strict JSON shape for MCP input, for example:
```
{
  "category": $state.category ?? "",
  "keywords": $state.query_text, // Final combined query string
  "quantity": $state.quantity ?? 1,
  "duration_years": $state.term_years ?? 1
}
```
Return this JSON string (not natural language). The MCP node will pass it directly as `arguments` to `typesense_search`.

MCP node configuration:
- Tool: typesense_search
- Authentication: Access token / API key (Bearer token for the MCP server)
- API Key: <your MCP token>

After MCP: an Agent/Transform node to aggregate and format a human response. Read from `node.MCP.result.products` and optionally call `qiq_scoring` to sort by price inverse:
```
const products = $input.products;
return {
  top: products.slice(0, 5),
  summary: `${products.length} candidates found. Showing top ${Math.min(5, products.length)}.`
};
```

## Minimal evaluation path
1) Build `execute_search` node to output the JSON shown above.
2) MCP node calls `typesense_search`.
3) Optional: call MCP again for `qiq_scoring` with the returned products as input.
4) `final_response` node crafts the user-facing answer.

## Notes
- If you set `category`, it is applied as an exact filter: `category:=<value>`; consider leaving it empty for broader recall.
- For runtime config changes (e.g., swapping to a search-only key), call `typesense_config_set` with `{ host, protocol, port, collection, apiKey }` and then run `typesense_check_permissions` or `typesense_health`.
