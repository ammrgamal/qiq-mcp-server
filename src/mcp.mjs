// Minimal MCP tool core usable from HTTP or WS handlers

// In-memory tool registry
const tools = new Map();

export function getTools() {
    return Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object' },
        outputSchema: t.outputSchema || { type: 'object' },
    }));
}

export function registerTool(name, def) {
    if (!name || typeof name !== 'string') throw new Error('Tool name must be a string');
    if (!def || typeof def.call !== 'function') throw new Error('Tool def must include call()');
    tools.set(name, { name, ...def });
}

export function getTool(name) {
    return tools.get(name);
}

export async function callTool(name, args = {}) {
    const tool = getTool(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool.call(args);
}

export function handleJsonRpc(input) {
    try {
        const { id, method, params } = input || {};
        const ok = (result) => ({ jsonrpc: '2.0', id, result });
        const err = (code, message, data) => {
            const e = { code, message }; if (data !== undefined) e.data = data;
            return { jsonrpc: '2.0', id: id ?? null, error: e };
        };

        if (!method || typeof method !== 'string') return err(-32600, 'Invalid Request: method missing');

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
                const tool = name && getTool(name);
                if (!tool) return err(-32601, `Method not found: tool ${name}`);
                return Promise.resolve(tool.call(args || {}))
                    .then((result) => ok(result))
                    .catch((e) => err(-32000, 'Tool invocation error', String(e?.message || e)));
            }
            default:
                return err(-32601, `Method not found: ${method}`);
        }
    } catch (e) {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
}

// Built-in tools
registerTool('ping', {
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

// Required tool: typesense_search (HTTP returns must be { products: [...] } with no wrappers)
import dotenv from 'dotenv';
import Typesense from 'typesense';

dotenv.config();

let typesenseClient = null;
let typesenseConfig = {
    host: process.env.TYPESENSE_HOST,
    protocol: process.env.TYPESENSE_PROTOCOL || 'https',
    port: parseInt(process.env.TYPESENSE_PORT || (process.env.TYPESENSE_PROTOCOL === 'http' ? '80' : '443'), 10),
    apiKey: process.env.TYPESENSE_SEARCH_ONLY_KEY || process.env.TYPESENSE_API_KEY || process.env.TYPESENSE_ADMIN_API_KEY,
    collection: process.env.TYPESENSE_COLLECTION || 'quickitquote_products',
    query_by: process.env.TYPESENSE_QUERY_BY || 'name,description,brand,category',
};

function buildTypesenseClient() {
    const { host, protocol, port, apiKey } = typesenseConfig;
    if (!host || !apiKey) {
        typesenseClient = null;
        return null;
    }
    typesenseClient = new Typesense.Client({
        nodes: [{ host, port, protocol }],
        apiKey,
        connectionTimeoutSeconds: 5,
    });
    return typesenseClient;
}

buildTypesenseClient();

function normalizeAvailability(n) {
    const v = Number(n) || 0;
    return v; // Keep number as required; downstream maps to semantics
}

function mapProduct(doc) {
    const oid = String(doc.objectID || doc.object_id || doc.mpn_normalized || doc.vendor_mpn || doc.sku || '');
    const name = String(doc.display_name || doc.name || oid);
    const brandRaw = String(doc.brand || doc.vendor || '').trim();
    const brand = brandRaw.replace(/\s+Lab$/i, '').trim() || brandRaw;
    const item_type = String(doc.item_type || doc.type || '').toLowerCase();
    const category = String(doc.category || doc.subcategory || '').toLowerCase();
    const price = Number(doc.price || doc.unit_price || 0);
    const list_price = doc.list_price != null ? Number(doc.list_price) : 0;
    const availability = normalizeAvailability(doc.availability);
    const image = String(doc.image || doc.image_url || `https://cdn.quickitquote.com/catalog/${encodeURIComponent(oid)}.jpg`);
    const spec_sheet = String(doc.spec_sheet || doc.spec || `https://cdn.quickitquote.com/specs/${encodeURIComponent(oid)}.pdf`);
    const url = `https://quickitquote.com/catalog/${encodeURIComponent(oid)}`;
    return { objectID: oid, name, brand, item_type, category, price, list_price, availability, image, spec_sheet, url };
}

registerTool('typesense_search', {
    description: 'Return products by objectIDs or keywords. If objectIDs are provided, returns those products in canonical QIQ shape.',
    inputSchema: {
        type: 'object',
        properties: {
            objectID: { type: 'string' },
            objectIDs: { type: 'array', items: { type: 'string' } },
            keywords: { type: 'string' },
            category: { type: 'string' },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: 'object',
        properties: {
            products: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        objectID: { type: 'string' },
                        name: { type: 'string' },
                        brand: { type: 'string' },
                        item_type: { type: 'string' },
                        category: { type: 'string' },
                        price: { type: 'number' },
                        list_price: { type: 'number' },
                        availability: { type: 'number' },
                        image: { type: 'string' },
                        spec_sheet: { type: 'string' },
                        url: { type: 'string' },
                    },
                    required: ['objectID', 'name', 'brand', 'item_type', 'category', 'price', 'list_price', 'availability', 'image', 'spec_sheet', 'url'],
                    additionalProperties: false,
                },
            },
        },
        required: ['products'],
        additionalProperties: false,
    },
    call: async ({ objectID, objectIDs, keywords, category } = {}) => {
        try {
            const collectIds = [];
            if (Array.isArray(objectIDs)) collectIds.push(...objectIDs);
            if (objectID) collectIds.push(objectID);
            const ids = Array.from(new Set(collectIds.filter(Boolean).map((v) => String(v))));

            if (ids.length > 0) {
                // Prefer direct document retrieve per objectID
                const client = typesenseClient || buildTypesenseClient();
                const products = [];
                if (client && typesenseConfig.collection) {
                    const coll = client.collections(typesenseConfig.collection).documents();
                    for (const oid of ids) {
                        try {
                            const doc = await coll.retrieve(oid);
                            products.push(mapProduct(doc || { objectID: oid }));
                        } catch (e) {
                            // Not found—emit minimal placeholder
                            products.push(mapProduct({ objectID: oid, name: oid }));
                        }
                    }
                    return { products };
                } else {
                    // No Typesense config—fallback placeholders
                    const fallback = ids.map((oid) => mapProduct({ objectID: oid, name: oid, category }));
                    return { products: fallback };
                }
            }

            // Simple keywords fallback returns empty set for now
            if (typeof keywords === 'string' && keywords.trim().length > 0) {
                const client = typesenseClient || buildTypesenseClient();
                if (client && typesenseConfig.collection) {
                    try {
                        const searchParams = {
                            q: keywords.trim(),
                            query_by: typesenseConfig.query_by,
                            per_page: 10,
                        };
                        const resp = await client.collections(typesenseConfig.collection).documents().search(searchParams);
                        const hits = Array.isArray(resp.hits) ? resp.hits : [];
                        const products = hits.map((h) => mapProduct(h.document || {}));
                        return { products };
                    } catch (e) {
                        console.error('[typesense_search] search error:', e?.message || e);
                        return { products: [] };
                    }
                }
                return { products: [] };
            }

            return { products: [] };
        } catch (e) {
            console.error('[typesense_search] error:', e);
            return { products: [] };
        }
    },
});


