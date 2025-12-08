import { createMcpServer } from './src/mcp.mjs';

const server = createMcpServer({
    name: 'QIQ_MCP_GENERIC',
    version: '1.0.0',
    // PORT is taken from process.env.PORT with fallback to 8080 internally
});

server.start();
