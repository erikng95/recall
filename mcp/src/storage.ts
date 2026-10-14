// Storage for the stdio MCP server (Node): either a local JSON file (RECALL_LOCAL_FILE, for tests/offline)
// or the private GitHub repo that the PWA syncs with (storage-core.ts → shared/github.ts).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { emptyVault, normalizeVault, type Vault } from '../../shared/vault.ts';
import {
  createGitHubStorage,
  describeGitHub,
  githubLocationFromEnv,
  StorageConfigError,
  type Storage,
} from './storage-core.ts';

export { StorageConfigError, type Storage } from './storage-core.ts';

const NOT_CONFIGURED =
  'The Recall vault is not configured. Set RECALL_GITHUB_REPO=owner/repo (the private repo the PWA syncs to) ' +
  'and RECALL_GITHUB_TOKEN (or GITHUB_TOKEN, or log in with `gh auth login`). ' +
  'For a local test file instead, set RECALL_LOCAL_FILE=/path/to/vault.json.';

export function createStorage(env: Record<string, string | undefined> = process.env): Storage {
  const localFile = () => env.RECALL_LOCAL_FILE?.trim() || undefined;
  const location = () => githubLocationFromEnv(env, NOT_CONFIGURED);
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

  const github = createGitHubStorage(
    () => ({ ...location(), token: resolveToken() }),
    () => describeGitHub(location()),
  );

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
      const file = localFile();
      if (file) return `local file ${file}`;
      try {
        return github.describe();
      } catch (e) {
        return `not configured (${e instanceof Error ? e.message : String(e)})`;
      }
    },

    async read(): Promise<Vault> {
      const file = localFile();
      return file ? readLocal(file) : github.read();
    },

    async mutate<T>(fn: (v: Vault) => T, message: string): Promise<T> {
      const file = localFile();
      if (!file) return github.mutate(fn, message);
      const vault = readLocal(file);
      const before = JSON.stringify(vault);
      const result = fn(vault);
      if (JSON.stringify(vault) !== before) {
        writeFileSync(file, JSON.stringify(vault, null, 2), 'utf8');
      }
      return result;
    },
  };
}
