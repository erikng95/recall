// Remote Recall MCP server for Cloudflare Workers: the same tools and prompts as the stdio server
// (../mcp/src), served over Streamable HTTP at /mcp and protected with OAuth so claude.ai custom
// connectors (web, desktop, Android) can use it.
//
// Auth: @cloudflare/workers-oauth-provider is the OAuth 2.1 authorization server MCP clients talk to
// (discovery, dynamic client registration, PKCE, tokens). Its /authorize step shows a consent page,
// then signs the user in with GitHub; only ALLOWED_GITHUB_USER gets a token. Requests to /mcp without
// a valid token never reach the MCP server.

import {
  AuthorizationError,
  CimdFetchError,
  OAuthProvider,
  authorizationErrorRedirect,
  type ConsentDescription,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { handleMcpRequest } from '../../mcp/src/http.ts';
import {
  createGitHubStorage,
  describeGitHub,
  githubLocationFromEnv,
  StorageConfigError,
  type Storage,
} from '../../mcp/src/storage-core.ts';

export interface Env {
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider for the default handler. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** GitHub OAuth app used only to sign in (secrets). */
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  /** The only GitHub login allowed to connect (var). */
  ALLOWED_GITHUB_USER: string;
  /** The vault: repo (var) and fine-grained PAT with Contents read/write on it (secret). */
  RECALL_GITHUB_REPO: string;
  RECALL_GITHUB_TOKEN: string;
  RECALL_GITHUB_BRANCH?: string;
  RECALL_VAULT_PATH?: string;
}

/** What a token carries (encrypted at rest by the provider). */
export interface Props extends Record<string, unknown> {
  login: string;
  githubId: number;
}

/** GitHub endpoints, overridable so tests can point them at a fake. */
export interface GitHubEndpoints {
  authorize: string;
  token: string;
  user: string;
}

export const GITHUB: GitHubEndpoints = {
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  user: 'https://api.github.com/user',
};

const USER_AGENT = 'recall-mcp-remote';

const VAULT_NOT_CONFIGURED =
  'The Recall vault is not configured on this Worker. Set the RECALL_GITHUB_REPO var (owner/repo) in wrangler.jsonc ' +
  'and the RECALL_GITHUB_TOKEN secret (`npx wrangler secret put RECALL_GITHUB_TOKEN`), then deploy again.';

/** The vault: vault.json in the private repo RECALL_GITHUB_REPO, via the RECALL_GITHUB_TOKEN secret. */
export function githubVaultStorage(env: Env, apiUrl?: string): Storage {
  const location = () => githubLocationFromEnv(env, VAULT_NOT_CONFIGURED);
  return createGitHubStorage(
    () => {
      const token = env.RECALL_GITHUB_TOKEN?.trim();
      if (!token) throw new StorageConfigError(VAULT_NOT_CONFIGURED);
      return { ...location(), token, userAgent: USER_AGENT, apiUrl };
    },
    () => describeGitHub(location()),
  );
}

const MCP_PATH = '/mcp';
const AUTHORIZE_PATH = '/authorize';
const CALLBACK_PATH = '/callback';

export interface WorkerOptions {
  storage: (env: Env) => Storage;
  github?: GitHubEndpoints;
}

export function createWorker(options: WorkerOptions): ExportedHandler<Env> {
  const github = options.github ?? GITHUB;

  const apiHandler: ExportedHandler<Env> & Pick<Required<ExportedHandler<Env>>, 'fetch'> = {
    async fetch(request, env, ctx) {
      const props = (ctx as ExecutionContext & { props?: Props }).props;
      // Re-checked on every request, so changing ALLOWED_GITHUB_USER also locks out existing tokens.
      if (!props || !isAllowedUser(props.login, env)) {
        return new Response('Forbidden: this token does not belong to the allowed GitHub user.', { status: 403 });
      }
      return handleMcpRequest(request, options.storage(env));
    },
  };

  const defaultHandler: ExportedHandler<Env> = {
    async fetch(request, env) {
      const url = new URL(request.url);
      try {
        if (url.pathname === AUTHORIZE_PATH && request.method === 'GET') return await showConsent(request, env);
        if (url.pathname === AUTHORIZE_PATH && request.method === 'POST') return await answerConsent(request, env, github);
        if (url.pathname === CALLBACK_PATH && request.method === 'GET') return await finishSignIn(request, env, github);
        if (url.pathname === '/' && request.method === 'GET') {
          return text(`Recall MCP server. Add ${url.origin}${MCP_PATH} as a custom connector in claude.ai.`);
        }
        return text('Not found', 404);
      } catch (error) {
        if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
        if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
          const message = error instanceof AuthorizationError ? error.description : 'This app could not be verified.';
          return page('Cannot connect', `<p>${escapeHtml(message ?? 'Invalid request.')}</p><p>Start connecting again from Claude.</p>`, 400);
        }
        throw error;
      }
    },
  };

  // The canonical resource (token audience) must be fixed per provider, and the Worker's URL is only
  // known at request time (workers.dev subdomain or a custom domain), so build one provider per origin.
  const providers = new Map<string, OAuthProvider<Env>>();
  function providerFor(origin: string): OAuthProvider<Env> {
    let provider = providers.get(origin);
    if (!provider) {
      provider = new OAuthProvider<Env>({
        apiRoute: MCP_PATH,
        apiHandler,
        defaultHandler,
        authorizeEndpoint: AUTHORIZE_PATH,
        tokenEndpoint: '/token',
        clientRegistrationEndpoint: '/register',
        clientIdMetadataDocumentEnabled: true,
        resourceMetadata: {
          resource: `${origin}${MCP_PATH}`,
          authorization_servers: [origin],
          resource_name: 'Recall',
        },
        // Stay connected while in use: each refresh extends the grant; it lapses after 90 idle days.
        refreshTokenIdleTTL: 90 * 24 * 3600,
      });
      providers.set(origin, provider);
    }
    return provider;
  }

  return {
    fetch(request, env, ctx) {
      return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
    },
  };
}

function isAllowedUser(login: string | undefined, env: Env): boolean {
  const allowed = env.ALLOWED_GITHUB_USER?.trim().toLowerCase();
  return Boolean(allowed && login && login.toLowerCase() === allowed);
}

// ---------- /authorize: consent page ----------

async function showConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest); // before beginConsent: a failed lookup leaves nothing in KV
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(consentPage(details, consent.handle), { headers: consent.headers });
}

async function answerConsent(request: Request, env: Env, github: GitHubEndpoints): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get('handle') ?? '');
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return page('Not configured', '<p>GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set on the Worker.</p>', 500);
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  const target = new URL(github.authorize);
  target.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  target.searchParams.set('redirect_uri', new URL(CALLBACK_PATH, request.url).href);
  target.searchParams.set('state', state);
  target.searchParams.set('allow_signup', 'false');
  target.searchParams.set('code_challenge', await s256(verifier));
  target.searchParams.set('code_challenge_method', 'S256');
  headers.set('Location', target.href);
  return new Response(null, { status: 302, headers });
}

// ---------- /callback: back from GitHub ----------

async function finishSignIn(request: Request, env: Env, github: GitHubEndpoints): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const url = new URL(request.url);
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    headers.set('Location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }

  const tokenRes = await fetch(github.token, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL(CALLBACK_PATH, request.url).href,
      code_verifier: data.verifier,
    }),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!tokenRes.ok || !token.access_token) {
    return page('GitHub sign-in failed', `<p>${escapeHtml(token.error_description ?? `GitHub answered ${tokenRes.status}.`)}</p>`, 502);
  }

  const userRes = await fetch(github.user, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!userRes.ok) return page('GitHub sign-in failed', `<p>Could not read your GitHub profile (${userRes.status}).</p>`, 502);
  const user = (await userRes.json()) as { login?: string; id?: number };

  if (!isAllowedUser(user.login, env)) {
    return page(
      'Access denied',
      `<p>You signed in to GitHub as <strong>${escapeHtml(user.login ?? 'unknown')}</strong>. This Recall server only accepts its owner.</p>`,
      403,
    );
  }

  const props: Props = { login: user.login!, githubId: user.id ?? 0 };
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: user.login!.toLowerCase(),
    metadata: { login: user.login },
    scope: original.scope,
    props,
  });
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

// ---------- HTML ----------

function consentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'This app registered itself; its name is not verified.';
  const loopback = details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>'
    : '';
  return html(
    `Connect ${name} to Recall`,
    `<h1>Allow ${name} to read and edit your Recall vault?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopback}
<p>Next you sign in with GitHub; only the vault owner is accepted.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <button name="decision" value="approve">Allow</button>
  <button name="decision" value="deny" class="secondary">Deny</button>
</form>`,
  );
}

function page(title: string, body: string, status = 200): Response {
  return new Response(html(title, `<h1>${escapeHtml(title)}</h1>${body}`), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    },
  });
}

function html(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
  h1 { font-size: 1.3rem; }
  button { font: inherit; padding: .6rem 1.2rem; border-radius: .5rem; border: 0; background: #4f46e5; color: #fff; margin-right: .5rem; cursor: pointer; }
  button.secondary { background: #e5e7eb; color: #1f2328; }
  .warn { background: #fff7ed; padding: .6rem .8rem; border-radius: .5rem; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } button.secondary { background: #30363d; color: #e6edf3; } .warn { background: #3b2300; } }
</style></head><body>${body}</body></html>`;
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- PKCE for the GitHub leg ----------

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
