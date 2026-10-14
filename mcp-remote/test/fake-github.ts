// A tiny stand-in for GitHub on 127.0.0.1: the OAuth sign-in endpoints, GET /user, and the contents API
// for the vault, backed by a local vault.json file.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export const GITHUB_CLIENT_ID = 'test-client-id';
export const GITHUB_CLIENT_SECRET = 'test-client-secret';
export const VAULT_TOKEN = 'test-vault-token';
export const VAULT_REPO = 'owner/vault';

/** GitHub OAuth codes the fake accepts, and who signs in with each. */
export const USERS: Record<string, { login: string; id: number }> = {
  'owner-code': { login: 'ErikNG95', id: 1 }, // different case than ALLOWED_GITHUB_USER on purpose
  'intruder-code': { login: 'mallory', id: 2 },
};

export interface FakeGitHub {
  origin: string;
  /** User-Agent of every vault (contents API) request seen. */
  vaultUserAgents: string[];
  /** Body of every token exchange seen. */
  tokenRequests: URLSearchParams[];
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeGitHub(vaultFile: string): Promise<FakeGitHub> {
  const vaultUserAgents: string[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const sha = (text: string) => createHash('sha1').update(text).digest('hex');
  const [owner, repo] = VAULT_REPO.split('/');
  const repoPath = `/repos/${owner}/${repo}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (req.method === 'POST' && url.pathname === '/login/oauth/access_token') {
      const form = new URLSearchParams(await body(req));
      tokenRequests.push(form);
      const code = form.get('code') ?? '';
      if (form.get('client_id') !== GITHUB_CLIENT_ID || form.get('client_secret') !== GITHUB_CLIENT_SECRET) {
        return json(200, { error: 'incorrect_client_credentials', error_description: 'bad client' });
      }
      if (!USERS[code] || !form.get('code_verifier')) return json(200, { error: 'bad_verification_code', error_description: 'bad code' });
      return json(200, { access_token: `gho_${code}`, token_type: 'bearer', scope: '' });
    }

    if (req.method === 'GET' && url.pathname === '/user') {
      const code = (req.headers.authorization ?? '').replace(/^Bearer gho_/, '');
      return USERS[code] ? json(200, USERS[code]) : json(401, { message: 'Bad credentials' });
    }

    if (url.pathname === repoPath || url.pathname === `${repoPath}/contents/vault.json`) {
      vaultUserAgents.push(String(req.headers['user-agent'] ?? ''));
      if (req.headers.authorization !== `Bearer ${VAULT_TOKEN}`) return json(401, { message: 'Bad credentials' });
      if (url.pathname === repoPath) return json(200, { full_name: VAULT_REPO });
      const current = existsSync(vaultFile) ? readFileSync(vaultFile, 'utf8') : null;
      if (req.method === 'GET') {
        if (current === null) return json(404, { message: 'Not Found' });
        return json(200, { sha: sha(current), encoding: 'base64', content: Buffer.from(current).toString('base64') });
      }
      if (req.method === 'PUT') {
        const put = JSON.parse(await body(req)) as { content: string; sha?: string };
        if (current !== null && put.sha !== sha(current)) return json(409, { message: 'sha does not match' });
        const next = Buffer.from(put.content, 'base64').toString('utf8');
        writeFileSync(vaultFile, next, 'utf8');
        return json(current === null ? 201 : 200, { content: { sha: sha(next) } });
      }
    }

    json(404, { message: 'Not Found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    vaultUserAgents,
    tokenRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
