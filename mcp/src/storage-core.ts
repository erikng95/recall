// Runtime-neutral storage pieces shared by the stdio server (storage.ts, Node) and the remote server
// (mcp-remote/, Cloudflare Workers). No Node built-ins here: only fetch and web APIs via shared/github.ts.

import { emptyVault, type Vault } from '../../shared/vault.ts';
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

/** Where the vault lives on GitHub; the token is resolved separately. */
export type GitHubLocation = Omit<GitHubConfig, 'token'>;

const MAX_ATTEMPTS = 4;

/** Read RECALL_GITHUB_REPO (+ optional RECALL_GITHUB_BRANCH, RECALL_VAULT_PATH) from an env object. */
export function githubLocationFromEnv(
  env: { RECALL_GITHUB_REPO?: string; RECALL_GITHUB_BRANCH?: string; RECALL_VAULT_PATH?: string },
  notConfigured: string,
): GitHubLocation {
  const repo = env.RECALL_GITHUB_REPO?.trim();
  if (!repo) throw new StorageConfigError(notConfigured);
  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length > 0) {
    throw new StorageConfigError(`RECALL_GITHUB_REPO must look like "owner/repo", got "${repo}".`);
  }
  return {
    owner,
    repo: name,
    branch: env.RECALL_GITHUB_BRANCH?.trim() || undefined,
    path: env.RECALL_VAULT_PATH?.trim() || 'vault.json',
  };
}

export function describeGitHub(loc: GitHubLocation): string {
  return `GitHub ${loc.owner}/${loc.repo}:${loc.path ?? 'vault.json'}${loc.branch ? `@${loc.branch}` : ''}`;
}

/**
 * A Storage backed by the vault file in a GitHub repo. `config` is called on every operation, so a
 * missing setting surfaces as a tool error (StorageConfigError) instead of crashing the server.
 */
export function createGitHubStorage(config: () => GitHubConfig, describe: () => string): Storage {
  return {
    describe,

    async read(): Promise<Vault> {
      const remote = await fetchRemoteVault(config());
      return remote ? remote.vault : emptyVault();
    },

    async mutate<T>(fn: (v: Vault) => T, message: string): Promise<T> {
      const cfg = config();
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
