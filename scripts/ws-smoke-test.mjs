import { WebSocket } from 'ws';

const url = process.env.MCP_URL || 'ws://127.0.0.1:3001/mcp';
const proto = 'mcp';

const ws = new WebSocket(url, proto);

let initialized = false;

ws.on('open', () => {
    console.log('OPEN');
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
});

ws.on('message', (data) => {
    const s = data.toString();
    console.log('MSG', s);
    try {
        const msg = JSON.parse(s);
        if (msg.result && msg.result.protocolVersion && !initialized) {
            initialized = true;
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
        } else if (msg.result && msg.result.tools) {
            console.log('TOOLS_OK', msg.result.tools.map(t => t.name).join(','));
            ws.close();
        }
    } catch (e) {
        console.error('PARSE_ERR', e);
        ws.close();
        process.exit(2);
    }
});

ws.on('error', (e) => {
    console.error('ERR', e);
    process.exit(1);
});

ws.on('close', () => {
    console.log('CLOSED');
    process.exit(0);
});
