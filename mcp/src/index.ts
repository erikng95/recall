// Recall MCP server entry point (stdio transport).
// stdout is reserved for the MCP protocol: log only with console.error.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStorage } from './storage.ts';
import { createRecallServer } from './server.ts';

async function main(): Promise<void> {
  const storage = createStorage(process.env);
  const server = createRecallServer(storage);
  await server.connect(new StdioServerTransport());
  console.error(`[recall-mcp] ready; vault: ${storage.describe()}`);
}

main().catch((err) => {
  console.error('[recall-mcp] fatal:', err);
  process.exit(1);
});
