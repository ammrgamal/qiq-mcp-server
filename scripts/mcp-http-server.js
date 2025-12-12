import dotenv from 'dotenv';
import express from 'express';
import { callTool } from '../src/mcp.mjs';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = parseInt(process.env.HTTP_PORT || process.env.PORT || process.env.MCP_PORT || '3001', 10);
const HOST = process.env.MCP_HOST || '0.0.0.0';

function log(...args) {
    console.log('[HTTP]', ...args);
}

function sendJson(res, body, status = 200) {
    res.status(status).set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(body));
}

app.post('/mcp/http', async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = Date.now();

    try {
        const payload = req.body || {};
        const { jsonrpc, method, params } = payload;

        if (jsonrpc !== '2.0') {
            log(requestId, 'Invalid jsonrpc version:', jsonrpc);
        }
        if (method !== 'tools/call') {
            log(requestId, 'Unsupported method:', method);
            return sendJson(res, { error: { code: 'unsupported_method', message: 'Only tools/call is supported on HTTP endpoint' } }, 400);
        }

        const name = params?.name;
        const args = params?.arguments || {};
        if (name !== 'typesense_search') {
            log(requestId, 'Unsupported tool name:', name);
            return sendJson(res, { error: { code: 'unsupported_tool', message: 'Only typesense_search is supported on HTTP endpoint' } }, 400);
        }

        const result = await callTool(name, args);
        if (!result || typeof result !== 'object' || !Array.isArray(result.products)) {
            log(requestId, 'Tool result missing products array');
            return sendJson(res, { products: [] });
        }
        return sendJson(res, result);
    } catch (e) {
        log('error', e?.message || e);
        return sendJson(res, { products: [] });
    } finally {
        const ms = Date.now() - start;
        log('done', requestId, ms + 'ms');
    }
});

// Health
app.get('/', (_req, res) => sendJson(res, { name: 'QIQ_MCP_HTTP', status: 'ok' }));

app.listen(PORT, HOST, () => {
    log(`HTTP server listening on http://${HOST}:${PORT}/mcp/http`);
});
