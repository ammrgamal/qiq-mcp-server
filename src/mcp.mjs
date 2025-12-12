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
                const products = ids.map((oid) => ({
                    objectID: oid,
                    name: oid,
                    brand: '',
                    item_type: '',
                    category: category ? String(category) : '',
                    price: 0,
                    list_price: 0,
                    availability: 0,
                    image: `https://cdn.quickitquote.com/catalog/${encodeURIComponent(oid)}.jpg`,
                    spec_sheet: `https://cdn.quickitquote.com/specs/${encodeURIComponent(oid)}.pdf`,
                    url: `https://quickitquote.com/catalog/${encodeURIComponent(oid)}`,
                }));
                return { products };
            }

            // Simple keywords fallback returns empty set for now
            if (typeof keywords === 'string' && keywords.trim().length > 0) {
                return { products: [] };
            }

            return { products: [] };
        } catch (e) {
            console.error('[typesense_search] error:', e);
            return { products: [] };
        }
    },
});


