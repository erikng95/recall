// Streamable HTTP transport for the Recall MCP server, using only web-standard Request/Response so it
// runs on Cloudflare Workers (mcp-remote/) as well as Node. Stateless: every POST gets a fresh server
// and transport, so nothing has to survive between requests (Workers isolates come and go).
// Authentication is NOT done here: the caller must only pass requests it has already authorized.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Storage } from './storage-core.ts';
import { createRecallServer } from './server.ts';

export async function handleMcpRequest(request: Request, storage: Storage): Promise<Response> {
  if (request.method !== 'POST') {
    // No sessions and no server-initiated stream: GET (SSE) and DELETE (end session) are not offered.
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }), {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json' },
    });
  }
  const server = createRecallServer(storage);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    // With JSON responses the reply is complete once handleRequest resolves.
    await server.close();
  }
}
