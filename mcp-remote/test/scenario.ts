// The end-to-end scenario both test runners drive: auth rejection, OAuth discovery and registration,
// consent + GitHub sign-in (owner allowed, anyone else refused), token exchange and refresh, then real
// MCP calls with the SDK client against a seeded local vault.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { emptyVault, type Vault } from '../../shared/vault.ts';
import { GITHUB_CLIENT_ID, type FakeGitHub } from './fake-github.ts';

export const ORIGIN = 'http://localhost:8787';
const MCP_URL = `${ORIGIN}/mcp`;
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

export type Dispatch = (request: Request) => Promise<Response>;

let passed = 0;
let failed = 0;

export function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
}

export function summary(): number {
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

/** Seed the vault file the Worker will read (directly, or through the fake GitHub). */
export function seedVault(file: string): void {
  const v = emptyVault();
  const t = Date.now() - 60_000;
  v.notes['seed-1'] = { id: 'seed-1', title: 'Octopuses have three hearts', body: 'Two pump blood to the gills.', topicIds: [], tags: [], createdAt: t, updatedAt: t };
  writeFileSync(file, JSON.stringify(v, null, 2), 'utf8');
}

class CookieJar {
  private cookies = new Map<string, string>();
  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Returns a working access token so runners can probe further. */
export async function runScenario(dispatch: Dispatch, vaultFile: string, github: FakeGitHub): Promise<string> {
  const send = (path: string, init?: RequestInit) => dispatch(new Request(new URL(path, ORIGIN), { redirect: 'manual', ...init }));
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
  });
  const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

  // ---- unauthenticated requests are rejected ----
  let res = await send('/mcp', { method: 'POST', headers: mcpHeaders, body: initialize });
  const challenge = res.headers.get('WWW-Authenticate') ?? '';
  check('POST /mcp without a token is 401', res.status === 401, res.status);
  check(
    '401 challenge points at the protected resource metadata',
    challenge.includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`),
    challenge,
  );
  check('401 response does not leak vault data', !(await res.text()).includes('Octopuses'));

  res = await send('/mcp', { method: 'POST', headers: { ...mcpHeaders, Authorization: 'Bearer not-a-real-token' }, body: initialize });
  check('POST /mcp with a bogus token is 401', res.status === 401, res.status);

  res = await send('/mcp', { method: 'GET' });
  check('GET /mcp without a token is 401', res.status === 401, res.status);

  // ---- discovery ----
  res = await send('/.well-known/oauth-protected-resource/mcp');
  const prm = (await res.json()) as { resource: string; authorization_servers: string[] };
  check('protected resource metadata names /mcp and this server', prm.resource === MCP_URL && prm.authorization_servers[0] === ORIGIN, prm);

  res = await send('/.well-known/oauth-authorization-server');
  const asm = (await res.json()) as Record<string, unknown>;
  check(
    'authorization server metadata advertises authorize, token and registration endpoints',
    asm.authorization_endpoint === `${ORIGIN}/authorize` && asm.token_endpoint === `${ORIGIN}/token` && asm.registration_endpoint === `${ORIGIN}/register`,
    asm,
  );

  // ---- dynamic client registration (what claude.ai does) ----
  res = await send('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const client = (await res.json()) as { client_id: string };
  check('client registration succeeds', res.status === 201 && typeof client.client_id === 'string', client);

  // ---- authorization: consent page, then GitHub sign-in ----
  async function authorize(githubCode: string) {
    const jar = new CookieJar();
    const verifier = b64url(randomBytes(32));
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      state: 'client-state-123',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      resource: MCP_URL,
    });
    const consent = await send(`/authorize?${q}`);
    jar.take(consent);
    const html = await consent.text();
    const handle = html.match(/name="handle" value="([^"]+)"/)?.[1] ?? '';

    const approve = await send('/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
      body: new URLSearchParams({ handle, decision: 'approve' }),
    });
    jar.take(approve);
    const toGitHub = new URL(approve.headers.get('Location') ?? 'about:blank');

    const callback = await send(`/callback?code=${githubCode}&state=${encodeURIComponent(toGitHub.searchParams.get('state') ?? '')}`, {
      headers: { Cookie: jar.header() },
    });
    return { consent, html, handle, approve, toGitHub, callback, verifier };
  }

  // A consent form posted from another site carries the handle but not the browser-bound cookie.
  {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      code_challenge: b64url(createHash('sha256').update('x').digest()),
      code_challenge_method: 'S256',
    });
    const html = await (await send(`/authorize?${q}`)).text();
    const handle = html.match(/name="handle" value="([^"]+)"/)?.[1] ?? '';
    const forged = await send('/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle, decision: 'approve' }),
    });
    check('consent POST without the browser cookie is refused', forged.status === 400 && !forged.headers.get('Location'), forged.status);
  }

  const intruder = await authorize('intruder-code');
  const intruderBody = await intruder.callback.text();
  check(
    'a GitHub user other than ALLOWED_GITHUB_USER is refused (403, no code issued)',
    intruder.callback.status === 403 && !intruder.callback.headers.get('Location') && intruderBody.includes('mallory'),
    `${intruder.callback.status} ${intruder.callback.headers.get('Location')}`,
  );

  const owner = await authorize('owner-code');
  check('consent page renders with a handle', owner.consent.status === 200 && owner.handle.length > 0, owner.consent.status);
  check('consent page shows where access goes', owner.html.includes('claude.ai'));
  check('consent page cannot be framed', owner.consent.headers.get('X-Frame-Options') === 'DENY');
  check(
    'approving redirects to GitHub sign-in with PKCE',
    owner.approve.status === 302 &&
      owner.toGitHub.origin + owner.toGitHub.pathname === `${github.origin}/login/oauth/authorize` &&
      owner.toGitHub.searchParams.get('client_id') === GITHUB_CLIENT_ID &&
      owner.toGitHub.searchParams.get('code_challenge_method') === 'S256' &&
      owner.toGitHub.searchParams.get('redirect_uri') === `${ORIGIN}/callback`,
    owner.toGitHub.href,
  );
  const back = new URL(owner.callback.headers.get('Location') ?? 'about:blank');
  check(
    'the owner (case-insensitive login) is sent back to Claude with a code',
    owner.callback.status === 302 &&
      back.origin + back.pathname === REDIRECT_URI &&
      !!back.searchParams.get('code') &&
      back.searchParams.get('state') === 'client-state-123',
    `${owner.callback.status} ${back.href}`,
  );
  const ghExchange = github.tokenRequests.at(-1);
  check('the GitHub code exchange sends the PKCE verifier', !!ghExchange?.get('code_verifier'));

  // The GitHub state is single use.
  const replay = await send(`/callback?code=owner-code&state=${encodeURIComponent(owner.toGitHub.searchParams.get('state') ?? '')}`);
  check('replaying the GitHub callback is refused', replay.status === 400 && !replay.headers.get('Location'), replay.status);

  // ---- token exchange ----
  res = await send('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') ?? '',
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: owner.verifier,
      resource: MCP_URL,
    }),
  });
  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string };
  check('authorization code is exchanged for tokens', res.status === 200 && !!tokens.access_token && !!tokens.refresh_token, tokens);

  // ---- MCP over Streamable HTTP with the SDK client ----
  async function connect(accessToken: string): Promise<Client> {
    const mcp = new Client({ name: 'recall-remote-test', version: '0.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
        fetch: (input, init) => dispatch(new Request(input, init)),
      }),
    );
    return mcp;
  }
  const textOf = (content: unknown) =>
    Array.isArray(content) ? content.map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : '')).join('\n') : '';

  const mcp = await connect(tokens.access_token ?? '');
  try {
    const tools = await mcp.listTools();
    check('tools/list exposes the same 14 tools as the stdio server', tools.tools.length === 14, tools.tools.map((t) => t.name));
    const prompts = await mcp.listPrompts();
    check('prompts/list exposes the 4 prompts', prompts.prompts.length === 4, prompts.prompts.map((p) => p.name));

    let r = await mcp.callTool({ name: 'vault_overview', arguments: {} });
    check('vault_overview reads the seeded vault', !r.isError && textOf(r.content).includes('Notes: 1'), textOf(r.content));

    r = await mcp.callTool({
      name: 'create_note',
      arguments: { title: 'Written from the phone', body: 'Via the remote connector. See [[Octopuses have three hearts]].', topics: ['Remote'] },
    });
    check('create_note succeeds', !r.isError, textOf(r.content));
    const saved = JSON.parse(readFileSync(vaultFile, 'utf8')) as Vault;
    const note = Object.values(saved.notes).find((n) => n.title === 'Written from the phone');
    check('create_note is persisted to the vault file', !!note && note.body.includes('[[Octopuses have three hearts]]'));

    r = await mcp.callTool({ name: 'get_note', arguments: { title: 'Octopuses have three hearts' } });
    check('get_note shows the new backlink', !r.isError && textOf(r.content).includes('Written from the phone'), textOf(r.content));

    r = await mcp.callTool({ name: 'search_notes', arguments: { topic: 'Nope' } });
    check('tool errors come back as MCP tool errors', r.isError === true, textOf(r.content));
  } finally {
    await mcp.close();
  }

  res = await send('/mcp', { method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'text/event-stream' } });
  check('GET /mcp with a token is 405 (stateless, no SSE stream)', res.status === 405, res.status);

  // ---- refresh keeps the connector working ----
  res = await send('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token ?? '', client_id: client.client_id }),
  });
  const refreshed = (await res.json()) as { access_token?: string };
  check('refresh token yields a new access token', res.status === 200 && !!refreshed.access_token && refreshed.access_token !== tokens.access_token, refreshed);
  const again = await connect(refreshed.access_token ?? '');
  try {
    const r = await again.callTool({ name: 'vault_overview', arguments: {} });
    check('the refreshed token works', !r.isError && textOf(r.content).includes('Notes: 2'), textOf(r.content));
  } finally {
    await again.close();
  }
  return refreshed.access_token ?? '';
}
