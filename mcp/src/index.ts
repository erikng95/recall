// Recall MCP server entry point (stdio transport).
// stdout is reserved for the MCP protocol: log only with console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStorage } from './storage.ts';
import { registerTools } from './tools.ts';
import { registerPrompts } from './prompts.ts';

const INSTRUCTIONS = `Recall is the user's personal knowledge vault (notes, topics, flashcards, inbox captured from podcasts and articles).
Start with vault_overview. Notes link to each other with [[Exact Title]] wikilinks; ==text== marks key facts that become flashcards.
Fact-checking means real research with web search and citing real URLs; set_verification records the result.`;

async function main(): Promise<void> {
  const storage = createStorage(process.env);
  const server = new McpServer({ name: 'recall', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, storage);
  registerPrompts(server);

  await server.connect(new StdioServerTransport());
  console.error(`[recall-mcp] ready; vault: ${storage.describe()}`);
}

main().catch((err) => {
  console.error('[recall-mcp] fatal:', err);
  process.exit(1);
});
