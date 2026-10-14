// Storage for the MCP server: either a local JSON file (RECALL_LOCAL_FILE, for tests/offline)
// or the private GitHub repo that the PWA syncs with (shared/github.ts).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { emptyVault, normalizeVault, type Vault } from '../../shared/vault.ts';
import { fetchRemoteVault, GitHubError, pushRemoteVault, type GitHubConfig } from '../../shared/github.ts';

/** Thrown when the environment does not describe a usable storage backend. */
export class StorageConfigError extends Error {}

export interface Storage {
  /** Human-readable description of where the vault lives (never includes the token). */
  describe(): string;
  /** Fresh read of the whole vault. */
  read(): Promise<Vault>;
  /**
   * Apply `fn` to the current vault (mutating it in place), then persist.
   * GitHub mode: pushes with the file sha and re-applies `fn` on a fresh copy after a 409 conflict.
   * Nothing is written if `fn` throws or leaves the vault unchanged.
   */
  mutate<T>(fn: (v: Vault) => T, message: string): Promise<T>;
}

type Config = { kind: 'local'; file: string } | { kind: 'github'; cfg: GitHubConfig };

const MAX_ATTEMPTS = 4;

const NOT_CONFIGURED =
  'The Recall vault is not configured. Set RECALL_GITHUB_REPO=owner/repo (the private repo the PWA syncs to) ' +
  'and RECALL_GITHUB_TOKEN (or GITHUB_TOKEN, or log in with `gh auth login`). ' +
  'For a local test file instead, set RECALL_LOCAL_FILE=/path/to/vault.json.';

function loadConfig(env: Record<string, string | undefined>): Config {
  const localFile = env.RECALL_LOCAL_FILE?.trim();
  if (localFile) return { kind: 'local', file: localFile };

  const repo = env.RECALL_GITHUB_REPO?.trim();
  if (!repo) throw new StorageConfigError(NOT_CONFIGURED);
  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length > 0) {
    throw new StorageConfigError(`RECALL_GITHUB_REPO must look like "owner/repo", got "${repo}".`);
  }
  return {
    kind: 'github',
    cfg: {
      owner,
      repo: name,
      branch: env.RECALL_GITHUB_BRANCH?.trim() || undefined,
      path: env.RECALL_VAULT_PATH?.trim() || 'vault.json',
      token: '', // filled in lazily by the storage (see resolveToken)
    },
  };
}

export function createStorage(env: Record<string, string | undefined> = process.env): Storage {
  let token: string | undefined;

  function resolveToken(): string {
    if (token) return token;
    const fromEnv = env.RECALL_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
    if (fromEnv) {
      token = fromEnv;
      return token;
    }
    try {
      const out = execFileSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      });
      const fromGh = out.trim();
      if (fromGh) {
        token = fromGh;
        return token;
      }
    } catch {
      /* gh not installed or not logged in — fall through to the error below */
    }
    throw new StorageConfigError(
      'No GitHub token found. Set RECALL_GITHUB_TOKEN (or GITHUB_TOKEN), or run `gh auth login` so `gh auth token` works.',
    );
  }

  function githubConfig(cfg: GitHubConfig): GitHubConfig {
    return { ...cfg, token: resolveToken() };
  }

  function readLocal(file: string): Vault {
    if (!existsSync(file)) {
      const v = emptyVault();
      writeFileSync(file, JSON.stringify(v, null, 2), 'utf8');
      return v;
    }
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return emptyVault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${file} is not valid JSON.`);
    }
    return normalizeVault(parsed as Partial<Vault>);
  }

  return {
    describe() {
      try {
        const c = loadConfig(env);
        if (c.kind === 'local') return `local file ${c.file}`;
        return `GitHub ${c.cfg.owner}/${c.cfg.repo}:${c.cfg.path}${c.cfg.branch ? `@${c.cfg.branch}` : ''}`;
      } catch (e) {
        return `not configured (${e instanceof Error ? e.message : String(e)})`;
      }
    },

    async read(): Promise<Vault> {
      const c = loadConfig(env);
      if (c.kind === 'local') return readLocal(c.file);
      const remote = await fetchRemoteVault(githubConfig(c.cfg));
      return remote ? remote.vault : emptyVault();
    },

    async mutate<T>(fn: (v: Vault) => T, message: string): Promise<T> {
      const c = loadConfig(env);

      if (c.kind === 'local') {
        const vault = readLocal(c.file);
        const before = JSON.stringify(vault);
        const result = fn(vault);
        if (JSON.stringify(vault) !== before) {
          writeFileSync(c.file, JSON.stringify(vault, null, 2), 'utf8');
        }
        return result;
      }

      const cfg = githubConfig(c.cfg);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const remote = await fetchRemoteVault(cfg);
        const vault = remote ? remote.vault : emptyVault();
        const before = JSON.stringify(vault);
        const result = fn(vault);
        if (JSON.stringify(vault) === before) return result;
        try {
          await pushRemoteVault(cfg, vault, remote?.sha, message);
          return result;
        } catch (e) {
          if (e instanceof GitHubError && e.status === 409 && attempt < MAX_ATTEMPTS) {
            console.error(`[recall-mcp] remote changed during write, retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
            continue;
          }
          throw e;
        }
      }
      throw new Error('Could not save the vault: remote kept changing. Try again.');
    },
  };
}
