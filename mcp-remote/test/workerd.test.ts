// The same scenario as worker.test.ts, but in workerd (the Cloudflare Workers runtime) via Wrangler's
// test harness: proves the bundle runs on Workers (no Node built-ins, no eval) and that the vault goes
// through the real GitHub storage code, here against a fake GitHub backed by a local vault file.
// Run with:  node test/workerd.test.ts   (from mcp-remote/)

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, startFakeGitHub, VAULT_TOKEN } from './fake-github.ts';
import { check, runScenario, seedVault, summary } from './scenario.ts';

const vaultFile = join(tmpdir(), `recall-workerd-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
seedVault(vaultFile);
const github = await startFakeGitHub(vaultFile);

const harness = createTestHarness({
  root: dirname(fileURLToPath(import.meta.url)),
  workers: [
    {
      configPath: 'wrangler.test.jsonc',
      vars: { FAKE_GITHUB: github.origin },
      secrets: { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, RECALL_GITHUB_TOKEN: VAULT_TOKEN },
    },
  ],
});

try {
  await harness.listen();
  // Miniflare has its own Request class: pass plain parts, and hand back a global Response.
  const dispatch = async (req: Request): Promise<Response> => {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
    const res = await harness.fetch(req.url, { method: req.method, headers: [...req.headers], body, redirect: 'manual' });
    return new Response(res.status === 204 || res.status === 304 ? null : await res.arrayBuffer(), {
      status: res.status,
      headers: [...res.headers],
    });
  };
  await runScenario(dispatch, vaultFile, github);
  check(
    'vault requests from workerd send a User-Agent (GitHub rejects requests without one)',
    github.vaultUserAgents.length > 0 && github.vaultUserAgents.every((ua) => ua === 'recall-mcp-remote'),
    github.vaultUserAgents,
  );
} catch (err) {
  check('workerd scenario ran to completion', false, err instanceof Error ? err.stack : String(err));
} finally {
  await harness.close();
  await github.close();
  rmSync(vaultFile, { force: true });
}
process.exitCode = summary() ? 1 : 0;
