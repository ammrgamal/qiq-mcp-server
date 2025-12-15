import 'dotenv/config';
import express from 'express';

// Minimal MCP core for HTTP/SSE transports (standalone)
const tools = new Map();

function getTools() {
    return Array.from(tools.values()).map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object' },
        outputSchema: t.outputSchema || { type: 'object' },
    }));
}

function registerTool(name, def) {
    if (!name || typeof name !== 'string') throw new Error('Tool name must be a string');
    if (!def || typeof def.call !== 'function') throw new Error('Tool def must have call()');
    tools.set(name, { name, ...def });
    return getTools();
}

function handleJsonRpc(input) {
    try {
        const { id, method, params } = input || {};
        const ok = (result) => ({ jsonrpc: '2.0', id, result });
        const err = (code, message, data) => {
            const e = { code, message }; if (data !== undefined) e.data = data;
            return { jsonrpc: '2.0', id: id ?? null, error: e };
        };

        switch (method) {
            case 'initialize':
                return ok({ protocolVersion: '2024-11-05', serverInfo: { name: 'MCP_HTTP_SEARCH', version: '1.0.0' }, capabilities: { tools: { listChanged: true } } });
            case 'tools/list':
                return ok({ tools: getTools() });
            case 'tools/call': {
                const name = params?.name; const args = params?.arguments;
                const tool = name && tools.get(name);
                if (!tool) return err(-32601, `Method not found: tool ${name}`);
                return Promise.resolve(tool.call(args || {}))
                    .then((result) => ok(result))
                    .catch((e) => err(-32000, e?.message || 'Tool invocation error'));
            }
            default:
                return err(-32601, `Method not found: ${method}`);
        }
    } catch {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
}

// Auth
const PORT = Number(process.env.SEARCH_MCP_PORT || process.env.PORT || 3003);
// For fastest testing, disable auth (public) by default.
// To re-enable, replace this with a token check like in run.mjs.
function authGuard(_req, _res, next) { return next(); }

// Register minimal HTTP search tool
registerTool('qiq_http_search', {
    description: 'Search products via QIQ HTTP endpoint using q as query and return MCP-friendly JSON.',
    inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
        additionalProperties: false,
    },
    // Return MCP CallToolResult
    outputSchema: {
        type: 'object',
        properties: {
            content: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: { type: 'string' },
                        json: { type: 'object' },
                    },
                    required: ['type', 'json'],
                    additionalProperties: false,
                },
            },
        },
        required: ['content'],
        additionalProperties: false,
    },
    call: async ({ q } = {}) => {
        try {
            const url = new URL('https://quickitquote.com/api/search');
            url.searchParams.set('q', String(q || '').trim());
            const resp = await fetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            // Wrap raw JSON under content/json/products when possible, else return raw
            const products = Array.isArray(data?.products) ? data.products : (Array.isArray(data) ? data : []);
            const payload = products.length ? { products } : (data || {});
            return { content: [{ type: 'json', json: payload }] };
        } catch (e) {
            return { content: [{ type: 'json', json: { error: String(e?.message || e) } }] };
        }
    },
});

// Express HTTP/SSE transport
const app = express();
app.use(express.json({ type: 'application/json' }));
app.use((req, _res, next) => { console.log(`[REQ] ${req.method} ${req.path}`); next(); });

app.get('/mcp', authGuard, (_req, res) => res.status(426).json({ error: 'Upgrade Required' }));
// Simple discovery endpoints for clients that use REST probing
app.get('/mcp/tools', authGuard, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ tools: getTools() });
});
app.options('/mcp/tools', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Token');
    res.status(204).end();
});
app.head('/mcp/tools', authGuard, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).end();
});

async function streamSse(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    const init = await handleJsonRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    res.write('event: message\n');
    res.write(`data: ${JSON.stringify(init)}\n\n`);
    // Proactively send tools/list to help clients that don't request it automatically
    const list = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    res.write('event: message\n');
    res.write(`data: ${JSON.stringify(list)}\n\n`);
    const interval = setInterval(() => { res.write('event: ping\n'); res.write('data: "keep-alive"\n\n'); }, 25000);
    req.on('close', () => clearInterval(interval));
}

app.get('/mcp/sse', authGuard, streamSse);
// Alias without /mcp prefix for clients expecting base paths
app.get('/sse', authGuard, streamSse);
app.options('/mcp/sse', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Token');
    res.status(204).end();
});
app.post('/mcp/sse', authGuard, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try { const out = await handleJsonRpc(req.body); res.status(200).json(out); }
    catch { res.status(200).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
});
app.post('/sse', authGuard, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try { const out = await handleJsonRpc(req.body); res.status(200).json(out); }
    catch { res.status(200).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
});

app.options('/mcp/http', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Token');
    res.status(204).end();
});
app.get('/mcp/http', authGuard, streamSse);
app.get('/http', authGuard, streamSse);
app.post('/mcp/http', authGuard, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try { const out = await handleJsonRpc(req.body); res.status(200).json(out); }
    catch { res.status(200).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
});
app.post('/http', authGuard, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try { const out = await handleJsonRpc(req.body); res.status(200).json(out); }
    catch { res.status(200).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
});

app.get('/', (_req, res) => res.json({ ok: true, tools: getTools() }));
app.get('/mcp/info', authGuard, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        ok: true,
        initialize: {
            jsonrpc: '2.0',
            result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'MCP_HTTP_SEARCH', version: '1.0.0' },
                capabilities: { tools: { listChanged: true } },
            },
            id: 0,
        },
        toolsList: { jsonrpc: '2.0', result: { tools: getTools() }, id: 1 },
        tools: getTools(),
    });
});
app.get('/info', authGuard, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        ok: true,
        initialize: {
            jsonrpc: '2.0',
            result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'MCP_HTTP_SEARCH', version: '1.0.0' },
                capabilities: { tools: { listChanged: true } },
            },
            id: 0,
        },
        toolsList: { jsonrpc: '2.0', result: { tools: getTools() }, id: 1 },
        tools: getTools(),
    });
});
// Debug route
app.get('/whoami', (_req, res) => res.send('search-3003'));
app.get('/mcp/tools', authGuard, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ tools: getTools() });
});
app.get('/tools', authGuard, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ tools: getTools() });
});

// Well-known discovery (helps clients figure out exact endpoints)
app.get('/.well-known/mcp.json', authGuard, (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host = String(req.headers['host'] || 'localhost');
    const base = `${proto}://${host}`;
    res.json({
        ok: true,
        name: 'MCP_HTTP_SEARCH',
        version: '1.0.0',
        transports: {
            sse: {
                streamUrl: `${base}/sse`,
                postUrl: `${base}/sse`,
                method: 'GET+POST',
            },
            http: {
                streamUrl: `${base}/http`,
                postUrl: `${base}/http`,
                method: 'GET+POST',
            },
        },
        initialize: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } } },
        tools: getTools(),
    });
});

app.listen(PORT, '0.0.0.0', () => console.log(`MCP HTTP Search running on PORT ${PORT}`));
