import http from 'http';

// Basic in-memory tools
const tools = {
    ping: {
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
        call: async (args = {}) => ({ reply: args.status ? 'pong:' + args.status : 'pong' }),
    },
};

function buildError(id, code, message, data) {
    const err = { code, message };
    if (data !== undefined) err.data = data;
    return { jsonrpc: '2.0', id: id ?? null, error: err };
}

function parseRequest(body) {
    try { return JSON.parse(body); } catch { return buildError(null, -32700, 'Parse error'); }
}

function handleInitialize(id) {
    const result = {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'MCP_HTTP', version: '0.1.0' },
        capabilities: { tools: { listChanged: false } },
    };
    return { jsonrpc: '2.0', id, result };
}

function handleListTools(id) {
    const list = Object.values(tools).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        input_schema: t.inputSchema,
        output_schema: t.outputSchema,
    }));
    return { jsonrpc: '2.0', id, result: { tools: list } };
}

async function handleToolCall(id, params) {
    const name = params?.name;
    const args = params?.arguments;
    const tool = name && tools[name];
    if (!tool) return buildError(id, -32601, `Method not found: tool ${name}`);
    try { const result = await tool.call(args || {}); return { jsonrpc: '2.0', id, result }; }
    catch { return buildError(id, -32000, 'Tool invocation error'); }
}

const PORT = Number(process.env.PORT || 8080);
const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/mcp') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', async () => {
            const msg = parseRequest(body);
            if (msg && msg.error) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(msg)); return; }
            const { id, method, params } = msg;
            let resp;
            if (method === 'initialize') resp = handleInitialize(id);
            else if (method === 'tools/list') resp = handleListTools(id);
            else if (method === 'tools/call') resp = await handleToolCall(id, params);
            else resp = buildError(id, -32601, `Method not found: ${method}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resp));
        });
        return;
    }
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'MCP_HTTP', version: '0.1.0', status: 'ok' }));
        return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, '0.0.0.0');
export default server;
