// The Recall MCP server itself, independent of transport: the stdio entry point (index.ts) and the
// remote HTTP server (http.ts, used by mcp-remote/ on Cloudflare Workers) both build it here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Storage } from './storage-core.ts';
import { registerTools } from './tools.ts';
import { registerPrompts } from './prompts.ts';

export const INSTRUCTIONS = `Recall is the user's personal knowledge vault (notes, topics, flashcards, inbox captured from podcasts and articles).
Start with vault_overview. Notes link to each other with [[Exact Title]] wikilinks; ==text== marks key facts that become flashcards.
Fact-checking means real research with web search and citing real URLs; set_verification records the result.`;

export function createRecallServer(storage: Storage): McpServer {
  const server = new McpServer({ name: 'recall', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, storage);
  registerPrompts(server);
  return server;
}
