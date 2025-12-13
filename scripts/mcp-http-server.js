import dotenv from 'dotenv';
import express from 'express';
import { handleJsonRpc } from '../src/mcp.mjs';

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
        const { jsonrpc, method } = payload;
        if (jsonrpc !== '2.0') {
            log(requestId, 'Invalid jsonrpc version:', jsonrpc);
        }

        // Delegate to MCP JSON-RPC handler for initialize, tools/list, tools/call
        const rpcResponse = await Promise.resolve(handleJsonRpc(payload));

        // For tools/call with typesense_search, return strict { products: [] } body
        if (rpcResponse && rpcResponse.result && rpcResponse.result.products) {
            return sendJson(res, rpcResponse.result);
        }
        // Otherwise return the JSON-RPC envelope
        return sendJson(res, rpcResponse);
    } catch (e) {
        log('error', e?.message || e);
        return sendJson(res, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Server error' } });
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
