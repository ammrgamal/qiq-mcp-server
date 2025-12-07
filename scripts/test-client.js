import WebSocket from 'ws';

const url = `ws://0.0.0.0:${process.env.MCP_PORT || 3001}/mcp`;
const ws = new WebSocket(url, ['mcp', 'jsonrpc']);

ws.on('open', () => {
    console.log('Client connected');
    // initialize
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    // tools/list
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    // tools/call ping
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: { message: 'hello' } } }));
});

ws.on('message', (data) => {
    console.log('Client recv:', data.toString());
});

ws.on('error', (err) => {
    console.error('Client error:', err);
});

ws.on('close', () => {
    console.log('Client closed');
});