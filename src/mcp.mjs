// Minimal MCP core for HTTP/SSE transports (no WebSocket)
import Typesense from 'typesense';

// In-memory tool registry
const tools = new Map();

// Default ping tool
tools.set('ping', {
    name: 'ping',
    description: 'Returns pong',
    inputSchema: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: false,
    },
    outputSchema: {
        type: 'object',
        properties: { reply: { type: 'string' } },
        required: ['reply'],
        additionalProperties: false,
    },
    call: async (args = {}) => ({ reply: args.status ? `pong:${args.status}` : 'pong' }),
});

export function getTools() {
    return Array.from(tools.values()).map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object' },
        outputSchema: t.outputSchema || { type: 'object' },
    }));
}

export function registerTool(name, def) {
    if (!name || typeof name !== 'string') throw new Error('Tool name must be a string');
    if (!def || typeof def.call !== 'function') throw new Error('Tool def must have call()');
    tools.set(name, { name, ...def });
    return getTools();
}

export function handleJsonRpc(input) {
    try {
        const { id, method, params } = input || {};
        const ok = (result) => ({ jsonrpc: '2.0', id, result });
        const err = (code, message, data) => {
            const e = { code, message }; if (data !== undefined) e.data = data;
            return { jsonrpc: '2.0', id: id ?? null, error: e };
        };

        switch (method) {
            case 'initialize':
                return ok({
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'MCP_HTTP', version: '1.0.0' },
                    capabilities: { tools: { listChanged: false } },
                });
            case 'tools/list':
                return ok({ tools: getTools() });
            case 'tools/call': {
                const name = params?.name; const args = params?.arguments;
                const tool = name && tools.get(name);
                if (!tool) return err(-32601, `Method not found: tool ${name}`);
                return Promise.resolve(tool.call(args || {}))
                    .then((result) => ok(result))
                    .catch(() => err(-32000, 'Tool invocation error'));
            }
            default:
                return err(-32601, `Method not found: ${method}`);
        }
    } catch {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
}
// End of minimal MCP core

// --- Built-in tools: Typesense search and QIQ scoring ---
// Environment-driven configuration so the server can run without hardcoding
const sanitize = (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    // Remove wrapping single or double quotes, if present
    const unq = s.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    return unq.trim();
};

let TS_HOST = sanitize(process.env.TYPESENSE_HOST);
let TS_PROTOCOL = sanitize(process.env.TYPESENSE_PROTOCOL); // http|https
let TS_PORT = (() => {
    const raw = sanitize(process.env.TYPESENSE_PORT);
    if (raw && raw !== '') {
        const n = Number(raw);
        if (!Number.isNaN(n)) return n;
    }
    if (TS_PROTOCOL === 'https') return 443;
    if (TS_PROTOCOL === 'http') return 80;
    return undefined;
})();
// Prefer search-only key, then general API key, then admin key; pick the first non-empty trimmed value
let TS_API_KEY = [process.env.TYPESENSE_SEARCH_ONLY_KEY, process.env.TYPESENSE_API_KEY, process.env.TYPESENSE_ADMIN_API_KEY]
    .find((v) => typeof v === 'string' && sanitize(v)?.length > 0);
let TS_API_KEY_TRIMMED = sanitize(TS_API_KEY);
let TS_COLLECTION = sanitize(process.env.TYPESENSE_COLLECTION);

let tsClient = null;
function rebuildTypesenseClient() {
    // Always null the old client first to force a fresh instance
    tsClient = null;
    try {
        if (TS_HOST && TS_PROTOCOL && TS_API_KEY_TRIMMED && typeof TS_PORT === 'number' && !Number.isNaN(TS_PORT)) {
            console.log('[TS] Building client:', { host: TS_HOST, protocol: TS_PROTOCOL, port: TS_PORT, collection: TS_COLLECTION, keyLength: TS_API_KEY_TRIMMED?.length });
            tsClient = new Typesense.Client({
                nodes: [{ host: TS_HOST, port: TS_PORT, protocol: TS_PROTOCOL }],
                apiKey: TS_API_KEY_TRIMMED,
                connectionTimeoutSeconds: 5,
            });
            console.log('[TS] Client rebuilt successfully');
        } else {
            console.log('[TS] Client not initialized:', { host: TS_HOST, protocol: TS_PROTOCOL, port: TS_PORT, keyLength: TS_API_KEY_TRIMMED?.length, collection: TS_COLLECTION });
            tsClient = null;
        }
    } catch (err) {
        console.error('[TS] Build error:', err);
        tsClient = null;
    }
}
rebuildTypesenseClient();

const productSchema = {
    type: 'object',
    properties: {
        sku: { type: 'string' },
        name: { type: 'string' },
        brand: { type: 'string' },
        price: { type: 'number' },
        quantity: { type: 'number' },
        score: { type: 'number' }
    },
    required: ['sku', 'name', 'brand', 'price', 'quantity'],
    additionalProperties: true,
};

let cachedQueryBy = null;

registerTool('typesense_search', {
    description: 'Search products from Typesense and return normalized product list.',
    inputSchema: {
        type: 'object',
        properties: {
            category: { type: 'string' },
            keywords: { type: 'string' },
            quantity: { type: ['number', 'null'] },
            duration_years: { type: ['number', 'null'] },
        },
        required: ['category', 'keywords'],
        additionalProperties: false,
    },
    // Return a CallToolResult per OpenAI MCP: { content: [ { type: 'json', json: { products: [...] } } ] }
    outputSchema: {
        type: 'object',
        properties: {
            content: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: { type: 'string' },
                        json: {
                            type: 'object',
                            properties: {
                                products: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            sku: { type: 'string' },
                                            name: { type: 'string' },
                                            brand: { type: 'string' },
                                            price: { type: 'number' },
                                            quantity: { type: 'number' },
                                            score: { type: 'number' }
                                        },
                                        required: ['sku', 'name', 'brand', 'price'],
                                        additionalProperties: false,
                                    }
                                }
                            },
                            required: ['products'],
                            additionalProperties: false,
                        },
                    },
                    required: ['type', 'json'],
                    additionalProperties: false,
                },
            },
        },
        required: ['content'],
        additionalProperties: false,
    },
    call: async ({ category, keywords, quantity = null }) => {
        // If Typesense is not configured, return deterministic mock data
        const qty = typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
        console.log('[TS_SEARCH] tsClient?', !!tsClient, 'TS_COLLECTION?', TS_COLLECTION, 'TS_API_KEY_TRIMMED length?', TS_API_KEY_TRIMMED?.length);
        if (!tsClient || !TS_COLLECTION) {
            console.log('[TS_SEARCH] Client or collection missing, returning empty products');
            return { content: [{ type: 'json', json: { products: [] } }] };
        }

        try {
            // Determine query_by fields once
            if (!cachedQueryBy) {
                const envQueryBy = sanitize(process.env.TYPESENSE_QUERY_BY);
                if (envQueryBy) {
                    // Honor explicit override and skip schema discovery
                    cachedQueryBy = envQueryBy;
                } else {
                    // Try to discover string fields from schema, then fallback to sensible defaults
                    try {
                        const schema = await tsClient.collections(TS_COLLECTION).retrieve();
                        const strFields = (schema?.fields || [])
                            .filter((f) => typeof f?.name === 'string' && String(f.type || '').startsWith('string'))
                            .map((f) => f.name);
                        cachedQueryBy = (strFields.length ? strFields : ['name', 'description', 'brand', 'category']).join(',');
                    } catch {
                        cachedQueryBy = ['name', 'description', 'brand', 'category'].join(',');
                    }
                }
            }

            let result;
            const qString = Array.isArray(keywords) ? keywords.join(' ') : (keywords && String(keywords).trim() ? String(keywords) : '*');
            const baseParams = {
                q: qString,
                per_page: 25,
            };

            // Attempt search with discovered query_by, then progressively degrade
            const attempt = async (queryBy) => {
                const params = { ...baseParams, query_by: queryBy };
                const weights = sanitize(process.env.TYPESENSE_QUERY_BY_WEIGHTS);
                if (weights && weights.split(',').filter(Boolean).length === queryBy.split(',').filter(Boolean).length) {
                    params.query_by_weights = weights;
                }
                if (category) params.filter_by = `category:=${JSON.stringify(category)}`;
                return tsClient.collections(TS_COLLECTION).documents().search(params);
            };

            // If qString looks like an exact identifier (e.g., KL4066IAVFS), prioritize identifier fields
            const looksLikeId = /[A-Za-z]{2,}\d{2,}|\d{3,}[A-Za-z]{2,}/.test(qString);
            const idFirst = 'mpn_normalized,object_id,name,sku,brand,category';

            try {
                result = await attempt(looksLikeId ? idFirst : cachedQueryBy);
            } catch (err1) {
                console.log('[TS_SEARCH] Primary attempt failed:', err1?.message);
                // Fallbacks: try a common single field, then a conservative default set
                try {
                    result = await attempt('name');
                } catch (err2) {
                    console.log('[TS_SEARCH] Fallback name failed:', err2?.message);
                    result = await attempt('mpn_normalized,object_id,name,sku,brand,category');
                }
            }

            const products = (result.hits || []).map((hit, idx) => {
                const doc = hit?.document || {};
                const sku = (doc.sku ?? doc.mpn_normalized ?? doc.object_id ?? doc.id ?? `TS-${idx + 1}`);
                const nameVal = (doc.name ?? doc.title);
                const brandVal = (doc.brand ?? doc.vendor);
                const priceRaw = (typeof doc.price === 'number') ? doc.price : Number(doc.price);
                const price = Number.isFinite(priceRaw) ? priceRaw : NaN;
                // Skip if required fields missing
                if (!sku || !nameVal || !brandVal || !Number.isFinite(price)) return null;
                const normalized = { sku: String(sku), name: String(nameVal), brand: String(brandVal), price };
                if (typeof qty === 'number') normalized.quantity = qty;
                // Optional score from text_match (Typesense returns bigint-like number)
                const tm = hit?.text_match;
                if (typeof tm === 'number') normalized.score = tm;
                return normalized;
            }).filter(Boolean);
            console.log('[TS_SEARCH] Success:', products.length, 'products');
            return { content: [{ type: 'json', json: { products } }] };
        } catch (outerErr) {
            // Fall back to mock data on failure
            console.log('[TS_SEARCH] Outer catch (fallback):', outerErr?.message);
            return { content: [{ type: 'json', json: { products: [] } }] };
        }
    },
});

registerTool('qiq_scoring', {
    description: 'Score and rank products for QIQ procurement logic.',
    inputSchema: {
        type: 'object',
        properties: {
            products: { type: 'array', items: productSchema },
            context: {
                type: 'object',
                properties: {
                    solutionType: { type: 'string' },
                    seats: { type: 'number' },
                    termYears: { type: 'number' },
                },
                additionalProperties: true,
            },
        },
        required: ['products'],
        additionalProperties: false,
    },
    outputSchema: {
        type: 'object',
        properties: { products: { type: 'array', items: productSchema } },
        required: ['products'],
        additionalProperties: false,
    },
    call: async ({ products = [], context = {} } = {}) => {
        const scored = (Array.isArray(products) ? products : []).map((p) => {
            const price = typeof p.price === 'number' ? p.price : Number(p.price) || 0;
            // Simple, transparent baseline: lower price → higher score
            const score = price > 0 ? 1 / price : 0;
            return { ...p, price, score };
        });
        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return { products: scored };
    },
});

// Administrative tool to set Typesense config at runtime (no service restart required)
registerTool('typesense_config_set', {
    description: 'Set Typesense connection and query configuration at runtime.',
    inputSchema: {
        type: 'object',
        properties: {
            host: { type: 'string' },
            protocol: { type: 'string' },
            port: { type: 'number' },
            apiKey: { type: 'string' },
            collection: { type: 'string' },
            query_by: { type: 'string' },
            query_by_weights: { type: 'string' },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: 'object',
        properties: {
            applied: { type: 'boolean' },
            host: { type: 'string' },
            protocol: { type: 'string' },
            port: { type: 'number' },
            collection: { type: 'string' },
            query_by: { type: 'string' },
            query_by_weights: { type: 'string' },
            apiKeyLength: { type: 'number' },
        },
        required: ['applied'],
        additionalProperties: false,
    },
    call: async (args = {}) => {
        try {
            const { host, protocol, port, apiKey, collection, query_by, query_by_weights } = args;
            console.log('[TS_CONFIG_SET] Received:', { host, protocol, port, apiKeyLength: apiKey?.length, collection, query_by, query_by_weights });
            if (host) TS_HOST = sanitize(host);
            if (protocol) TS_PROTOCOL = sanitize(protocol);
            if (typeof port === 'number' && Number.isFinite(port)) TS_PORT = port;
            if (apiKey) {
                const sanitized = sanitize(apiKey);
                TS_API_KEY_TRIMMED = sanitized;
                console.log('[TS_CONFIG_SET] API key sanitized from', apiKey.length, 'to', sanitized?.length, 'chars');
            }
            if (collection) TS_COLLECTION = sanitize(collection);
            // Reset cached query_by if override provided
            if (query_by) cachedQueryBy = sanitize(query_by);
            if (query_by_weights) process.env.TYPESENSE_QUERY_BY_WEIGHTS = sanitize(query_by_weights);
            console.log('[TS_CONFIG_SET] About to rebuild client...');
            rebuildTypesenseClient();
            console.log('[TS_CONFIG_SET] Rebuild complete. tsClient?', !!tsClient);
            return {
                applied: true,
                host: TS_HOST || '',
                protocol: TS_PROTOCOL || '',
                port: typeof TS_PORT === 'number' ? TS_PORT : 0,
                collection: TS_COLLECTION || '',
                query_by: cachedQueryBy || sanitize(process.env.TYPESENSE_QUERY_BY) || '',
                query_by_weights: sanitize(process.env.TYPESENSE_QUERY_BY_WEIGHTS) || '',
                apiKeyLength: TS_API_KEY_TRIMMED?.length || 0,
            };
        } catch (e) {
            console.error('[TS_CONFIG_SET] Error:', e);
            return { applied: false };
        }
    },
});

// Health/diagnostics tool for Typesense connectivity
registerTool('typesense_health', {
    description: 'Report Typesense connectivity and collection schema fields.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
        type: 'object',
        properties: {
            connected: { type: 'boolean' },
            host: { type: 'string' },
            protocol: { type: 'string' },
            port: { type: 'number' },
            collection: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' }
        },
        required: ['connected', 'host', 'protocol', 'port', 'collection'],
        additionalProperties: false,
    },
    call: async () => {
        const base = {
            connected: false,
            host: TS_HOST || '',
            protocol: TS_PROTOCOL || '',
            port: typeof TS_PORT === 'number' ? TS_PORT : 0,
            collection: TS_COLLECTION || '',
            fields: [],
        };
        try {
            if (!tsClient) return { ...base, error: 'Client not initialized' };

            // Attempt a lightweight search which should succeed with search-only key
            let connected = false;
            let fields = [];
            try {
                const qb = cachedQueryBy || sanitize(process.env.TYPESENSE_QUERY_BY) || 'name';
                console.log('[TS_HEALTH] Attempting search with query_by:', qb);
                const result = await tsClient.collections(TS_COLLECTION).documents().search({ q: '*', query_by: qb, per_page: 1 });
                console.log('[TS_HEALTH] Search OK, hits:', result?.hits?.length || 0);
                connected = true;
                // If we don't have schema access, at least report the query_by we used
                fields = qb.split(',').map(s => s.trim()).filter(Boolean);
            } catch (searchErr) {
                console.log('[TS_HEALTH] Search failed:', searchErr?.message || searchErr);
                // Try health and schema (may require non-search-only keys)
                try {
                    await tsClient.health.retrieve();
                    const schema = await tsClient.collections(TS_COLLECTION).retrieve();
                    fields = (schema?.fields || []).map((f) => f?.name).filter(Boolean);
                    connected = true;
                } catch (schemaErr) {
                    console.log('[TS_HEALTH] Health/schema also failed:', schemaErr?.message || schemaErr);
                    const msg = (searchErr && searchErr.message) ? searchErr.message : (schemaErr && schemaErr.message) ? schemaErr.message : undefined;
                    return { ...base, connected, fields, error: msg };
                }
            }
            return { ...base, connected, fields };
        } catch (e) {
            console.log('[TS_HEALTH] Outer catch:', e?.message || e);
            return { ...base, error: (e && e.message) ? e.message : 'Unknown error' };
        }
    },
});

// Cheap capability probe: does the configured key have documents:search on the target collection?
registerTool('typesense_check_permissions', {
    description: 'Verify that the configured Typesense key can perform documents:search against the configured collection.',
    inputSchema: {
        type: 'object',
        properties: {
            collection: { type: 'string' },
            query_by: { type: 'string' },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: 'object',
        properties: {
            canSearch: { type: 'boolean' },
            status: { type: 'string' },
            host: { type: 'string' },
            protocol: { type: 'string' },
            port: { type: 'number' },
            collection: { type: 'string' },
            keyLength: { type: 'number' },
            error: { type: 'string' },
        },
        required: ['canSearch', 'status', 'host', 'protocol', 'port', 'collection'],
        additionalProperties: false,
    },
    call: async ({ collection, query_by } = {}) => {
        const meta = {
            host: TS_HOST || '',
            protocol: TS_PROTOCOL || '',
            port: typeof TS_PORT === 'number' ? TS_PORT : 0,
            collection: sanitize(collection) || TS_COLLECTION || '',
            keyLength: TS_API_KEY_TRIMMED?.length || 0,
        };

        if (!tsClient) return { ...meta, canSearch: false, status: 'not-initialized', error: 'Client not initialized' };
        if (!meta.collection) return { ...meta, canSearch: false, status: 'no-collection', error: 'No collection configured' };

        const qb = sanitize(query_by) || cachedQueryBy || sanitize(process.env.TYPESENSE_QUERY_BY) || 'name';
        try {
            const res = await tsClient
                .collections(meta.collection)
                .documents()
                .search({ q: '*', query_by: qb, per_page: 1 });
            const hits = Array.isArray(res?.hits) ? res.hits.length : 0;
            return { ...meta, canSearch: true, status: `ok:hits=${hits}`, error: '' };
        } catch (e) {
            const msg = e?.message || String(e);
            // Typesense Node errors often include httpStatus
            const httpStatus = e?.httpStatus || e?.status || undefined;
            let status = 'error';
            if (httpStatus === 401) status = 'unauthorized';
            else if (httpStatus === 403) status = 'forbidden';
            else if (httpStatus === 404) status = 'collection-not-found';
            else if (httpStatus) status = `http-${httpStatus}`;
            return { ...meta, canSearch: false, status, error: msg };
        }
    },
});

