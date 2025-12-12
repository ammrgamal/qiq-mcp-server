import express from 'express';
import dotenv from 'dotenv';
import { handleJsonRpc, getTools } from './src/mcp.mjs';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || process.env.MCP_PORT || '8080', 10);
const HOST = process.env.MCP_HOST || '0.0.0.0';
const TOKEN = (process.env.MCP_TOKEN || '').trim();

app.use(express.json({ limit: '1mb' }));

// Simple bearer auth middleware
function requireAuth(req, res, next) {
	const auth = req.headers['authorization'] || '';
	const m = auth.match(/^Bearer\s+(.*)$/i);
	const incoming = m?.[1]?.trim() || '';
	if (!TOKEN) return res.status(500).json({ error: 'Server not configured: MCP_TOKEN missing' });
	if (!incoming || incoming !== TOKEN) return res.status(401).json({ error: 'Unauthorized' });
	next();
}

// Info endpoint: list tools
app.get('/mcp/info', requireAuth, (req, res) => {
	res.json({ ok: true, tools: getTools() });
});

// JSON-RPC over HTTP
app.post('/mcp/http', requireAuth, async (req, res) => {
	try {
		const input = req.body;
		const result = await handleJsonRpc(input);
		res.json(result);
	} catch (e) {
		res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
	}
});

// Basic root health
app.get('/', (req, res) => {
	res.json({ name: 'QIQ_MCP_HTTP', version: '1.0.0', status: 'ok' });
});

app.listen(PORT, HOST, () => {
	console.log(`[INFO ] HTTP MCP listening on http://${HOST}:${PORT}`);
});

