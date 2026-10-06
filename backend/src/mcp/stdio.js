#!/usr/bin/env node
// Local MCP server over stdio, for desktop AI clients (Claude Desktop etc.)
// running on the same machine as the POS database:
//   NODEDR_API_KEY=nk_live_... node src/mcp/stdio.js
// Reads the database directly — no HTTP hop. stdout is the protocol
// stream, so all logging goes to stderr.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const prisma = require('../lib/prisma');
const { hashApiKey, parseScopes } = require('../lib/apiKey');
const { registerTools } = require('./tools');

async function main() {
  const key = process.env.NODEDR_API_KEY;
  if (!key) {
    console.error('NODEDR_API_KEY is not set. Create a key in Settings > Integrations.');
    process.exit(1);
  }
  const record = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!record || record.revoked) {
    console.error('NODEDR_API_KEY is invalid or revoked.');
    process.exit(1);
  }
  const server = new McpServer({ name: 'nodedr-pos', version: '1.2.0' });
  registerTools(server, { apiKey: record, scopes: parseScopes(record.scopes), baseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:1994' });
  await server.connect(new StdioServerTransport());
  console.error(`nodedr-pos MCP ready (key "${record.name}")`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
