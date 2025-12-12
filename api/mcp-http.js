export const config = { runtime: 'edge' };

import { callTool } from '../src/mcp.mjs';

function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        status: init.status ?? 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            ...(init.headers || {}),
        },
    });
}

function badRequest(message, code = 'bad_request', status = 400, extra = {}) {
    return json({ error: { code, message, ...extra } }, { status });
}

export default async function handler(req) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = Date.now();

    if (req.method !== 'POST') {
        return badRequest('Only POST is allowed', 'method_not_allowed', 405, { allow: 'POST' });
    }

    let payload;
    try {
        payload = await req.json();
    } catch (e) {
        console.error('[mcp/http]', requestId, 'JSON parse error:', e?.message || e);
        return badRequest('Invalid JSON body', 'invalid_json');
    }

    // Minimal JSON-RPC parsing
    const { jsonrpc, id, method, params } = payload || {};
    if (jsonrpc !== '2.0') {
        console.warn('[mcp/http]', requestId, 'Invalid jsonrpc version:', jsonrpc);
    }

    if (method !== 'tools/call') {
        console.error('[mcp/http]', requestId, 'Unsupported method:', method);
        return badRequest('Only tools/call is supported on HTTP endpoint', 'unsupported_method');
    }

    const name = params?.name;
    const args = params?.arguments || {};
    if (name !== 'typesense_search') {
        console.error('[mcp/http]', requestId, 'Unsupported tool name:', name);
        return badRequest('Only typesense_search is supported on HTTP endpoint', 'unsupported_tool');
    }

    try {
        const result = await callTool(name, args);
        // Enforce exact output shape with no wrapper
        if (!result || typeof result !== 'object' || !Array.isArray(result.products)) {
            console.error('[mcp/http]', requestId, 'Tool result missing products array');
            return json({ products: [] });
        }
        return json(result);
    } catch (e) {
        console.error('[mcp/http]', requestId, 'Tool error:', e?.message || e);
        return json({ products: [] });
    } finally {
        const ms = Date.now() - start;
        console.log('[mcp/http]', requestId, 'done in', ms + 'ms');
    }
}
