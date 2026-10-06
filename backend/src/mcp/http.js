const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { registerTools } = require('./tools');

// Stateless Streamable-HTTP MCP endpoint: every request builds a fresh
// server scoped to the caller's API key and tears it down afterwards, so
// there is no session state to leak between keys and nothing to clean up.
async function handleMcp(req, res) {
  const server = new McpServer({ name: 'nodedr-pos', version: '1.2.0' });
  registerTools(server, {
    apiKey: req.apiKey,
    scopes: req.apiScopes,
    baseUrl: process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('mcp request failed', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
}

module.exports = { handleMcp };
