// In-process test of the remote server: runs the Worker's fetch handler directly in Node, with an
// in-memory KV, the vault in a local JSON file (the stdio server's RECALL_LOCAL_FILE storage) and a
// fake GitHub for sign-in. Run with:  node test/worker.test.ts   (from mcp-remote/)

import { registerHooks } from 'node:module';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage } from '../../mcp/src/storage.ts';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, startFakeGitHub } from './fake-github.ts';
import { check, ORIGIN, runScenario, seedVault, summary } from './scenario.ts';

// The OAuth library imports WorkerEntrypoint from the Workers runtime only for instanceof checks.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { createWorker } = await import('../src/worker.ts');
type Env = import('../src/worker.ts').Env;

/** Just enough of Workers KV for the OAuth provider. */
class MemoryKV {
  private data = new Map<string, { value: string; metadata?: unknown; expires?: number }>();
  private live(key: string) {
    const e = this.data.get(key);
    if (e?.expires && e.expires <= Date.now()) this.data.delete(key);
    return this.data.get(key);
  }
  async get(key: string, opts?: string | { type?: string }) {
    const e = this.live(key);
    if (!e) return null;
    const type = typeof opts === 'string' ? opts : opts?.type;
    return type === 'json' ? JSON.parse(e.value) : e.value;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number; metadata?: unknown }) {
    const expires = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : opts?.expiration ? opts.expiration * 1000 : undefined;
    this.data.set(key, { value, metadata: opts?.metadata, expires });
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const names = [...this.data.keys()].filter((k) => this.live(k) && k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return {
      keys: page.map((name) => ({ name, metadata: this.data.get(name)?.metadata })),
      list_complete: done,
      cursor: done ? undefined : String(start + limit),
    };
  }
}

const vaultFile = join(tmpdir(), `recall-remote-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
seedVault(vaultFile);
const github = await startFakeGitHub(vaultFile);

const worker = createWorker({
  storage: () => createStorage({ RECALL_LOCAL_FILE: vaultFile }),
  github: {
    authorize: `${github.origin}/login/oauth/authorize`,
    token: `${github.origin}/login/oauth/access_token`,
    user: `${github.origin}/user`,
  },
});

function makeEnv(allowed: string): Env {
  return {
    OAUTH_KV: new MemoryKV() as unknown as KVNamespace,
    OAUTH_PROVIDER: undefined as unknown as Env['OAUTH_PROVIDER'],
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    ALLOWED_GITHUB_USER: allowed,
    RECALL_GITHUB_REPO: 'unused/in-this-test',
    RECALL_GITHUB_TOKEN: 'unused',
  };
}
const ctx = () =>
  ({ waitUntil() {}, passThroughOnException() {}, props: {} }) as unknown as ExecutionContext;

try {
  const env = makeEnv('erikng95');
  const dispatch = async (req: Request, e: Env = env): Promise<Response> => worker.fetch!(req as Request<unknown, IncomingRequestCfProperties>, { ...e }, ctx());
  const token = await runScenario((req) => dispatch(req), vaultFile, github);

  // Changing ALLOWED_GITHUB_USER locks out tokens that were already issued.
  const res = await dispatch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
    { ...env, ALLOWED_GITHUB_USER: 'someone-else' },
  );
  check('a valid token is refused once ALLOWED_GITHUB_USER no longer matches', res.status === 403, res.status);
} catch (err) {
  check('in-process scenario ran to completion', false, err instanceof Error ? err.stack : String(err));
} finally {
  await github.close();
  rmSync(vaultFile, { force: true });
}
process.exitCode = summary() ? 1 : 0;
