// GitHub-backed storage for the vault: a single JSON file in a (private) repo.
// Works in browsers and Node 18+ (uses global fetch, atob/btoa, TextEncoder/TextDecoder).

import { mergeVaults, normalizeVault, vaultDiffers, type Vault } from './vault.ts';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch?: string; // default: repo default branch
  path?: string; // default: vault.json
  userAgent?: string; // sent as User-Agent; needed where fetch adds none (Cloudflare Workers), unset in browsers
  apiUrl?: string; // default: https://api.github.com (tests point this at a fake)
}

export interface RemoteVault {
  vault: Vault;
  sha: string;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const API = 'https://api.github.com';

function filePath(cfg: GitHubConfig) {
  return (cfg.path || 'vault.json').replace(/^\/+/, '');
}

function repoUrl(cfg: GitHubConfig) {
  return `${cfg.apiUrl ?? API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

function contentsUrl(cfg: GitHubConfig) {
  const p = filePath(cfg).split('/').map(encodeURIComponent).join('/');
  return `${repoUrl(cfg)}/contents/${p}`;
}

function headers(cfg: GitHubConfig, accept = 'application/vnd.github+json'): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  if (cfg.userAgent) h['User-Agent'] = cfg.userAgent;
  return h;
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function explain(res: Response): Promise<GitHubError> {
  let msg = res.statusText;
  try {
    const j = (await res.json()) as { message?: string };
    if (j.message) msg = j.message;
  } catch {
    /* ignore */
  }
  if (res.status === 401) msg = 'GitHub token is invalid or expired';
  if (res.status === 404) msg = `Not found: ${msg} (check owner/repo and that the token can access it)`;
  return new GitHubError(res.status, msg);
}

/** Fetch the vault file. Returns null if the file does not exist yet. */
export async function fetchRemoteVault(cfg: GitHubConfig): Promise<RemoteVault | null> {
  const ref = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '';
  const res = await fetch(contentsUrl(cfg) + ref, { headers: headers(cfg), cache: 'no-store' });
  if (res.status === 404) {
    // Distinguish "file missing" from "repo missing / no access".
    const repoRes = await fetch(repoUrl(cfg), {
      headers: headers(cfg),
      cache: 'no-store',
    });
    if (!repoRes.ok) throw await explain(repoRes);
    return null;
  }
  if (!res.ok) throw await explain(res);
  const meta = (await res.json()) as { sha: string; content?: string; encoding?: string };
  let text: string;
  if (meta.encoding === 'base64' && meta.content) {
    text = base64ToUtf8(meta.content);
  } else {
    // Files > 1 MB: content is omitted; fetch raw.
    const raw = await fetch(contentsUrl(cfg) + ref, {
      headers: headers(cfg, 'application/vnd.github.raw'),
      cache: 'no-store',
    });
    if (!raw.ok) throw await explain(raw);
    text = await raw.text();
  }
  let parsed: Partial<Vault>;
  try {
    parsed = text.trim() ? (JSON.parse(text) as Partial<Vault>) : {};
  } catch {
    throw new GitHubError(422, `${filePath(cfg)} in the repo is not valid JSON`);
  }
  return { vault: normalizeVault(parsed), sha: meta.sha };
}

/** Write the vault file. Throws GitHubError(409) when `sha` is stale. */
export async function pushRemoteVault(
  cfg: GitHubConfig,
  vault: Vault,
  sha: string | undefined,
  message = 'Update vault',
): Promise<string> {
  const body: Record<string, string> = {
    message,
    content: utf8ToBase64(JSON.stringify(vault)),
  };
  if (sha) body.sha = sha;
  if (cfg.branch) body.branch = cfg.branch;
  const res = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) {
    const err = await explain(res);
    // 409, or 422 "sha wasn't supplied" / "does not match" → stale sha, caller should refetch & retry
    if (res.status === 409 || /sha/i.test(err.message)) throw new GitHubError(409, err.message);
    throw err;
  }
  if (!res.ok) throw await explain(res);
  const j = (await res.json()) as { content: { sha: string } };
  return j.content.sha;
}

export interface SyncResult {
  vault: Vault; // merged vault — adopt this locally
  sha: string;
  pulled: boolean; // remote had changes we didn't have
  pushed: boolean; // we wrote to remote
}

/**
 * Two-way sync: pull, merge (record-level last-writer-wins), push if remote is behind.
 * Retries on concurrent-write conflicts.
 */
export async function syncVault(cfg: GitHubConfig, local: Vault, message?: string): Promise<SyncResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await fetchRemoteVault(cfg);
    const merged = remote ? mergeVaults(local, remote.vault) : local;
    const pulled = remote ? vaultDiffers(local, remote.vault) : false;
    const needPush = !remote || vaultDiffers(remote.vault, merged);
    if (!needPush) return { vault: merged, sha: remote!.sha, pulled, pushed: false };
    try {
      const sha = await pushRemoteVault(cfg, merged, remote?.sha, message);
      return { vault: merged, sha, pulled, pushed: true };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 409 && attempt < 3) {
        local = merged;
        continue;
      }
      throw e;
    }
  }
  throw new GitHubError(409, 'Sync conflict persisted after retries');
}
