import { useRef, useState } from 'react';
import { CheckCircle2, Cloud, Download, ExternalLink, Moon, Sparkles, Sun, SunMoon, Upload, XCircle } from 'lucide-react';
import { live, normalizeVault, type Vault } from '@shared/vault.ts';
import { fetchRemoteVault } from '@shared/github.ts';
import { useStore, type Settings as SettingsT } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import { applyTheme } from '../lib/theme.ts';
import { toast } from '../lib/toast.ts';
import { loadSampleData } from '../lib/sample.ts';
import { exportMarkdownZip } from '../lib/exportMarkdown.ts';

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const vault = useStore((s) => s.vault);

  const setTheme = (theme: SettingsT['theme']) => {
    setSettings({ theme });
    applyTheme(theme);
  };

  return (
    <div className="page">
      <Topbar title="Settings" back="/" />

      <div className="section">
        <div className="section-title">Appearance</div>
        <div className="row">
          {(
            [
              ['auto', <SunMoon key="a" size={16} />, 'Auto'],
              ['light', <Sun key="l" size={16} />, 'Light'],
              ['dark', <Moon key="d" size={16} />, 'Dark'],
            ] as const
          ).map(([id, icon, label]) => (
            <button key={id} className={`chip ${settings.theme === id ? 'on' : ''}`} onClick={() => setTheme(id)}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <SyncSettings />

      <div className="section">
        <div className="section-title">
          <Sparkles size={14} /> Claude connector
        </div>
        <div className="card muted" style={{ fontSize: 'var(--step--1)' }}>
          In Claude Code on your computer, run <code>/recall</code> to process your inbox, fact-check, build starter packs and make cards. Try <code>/mcp__recall__quiz_me</code> to be quizzed on weak spots.
        </div>
      </div>

      <div className="section">
        <div className="section-title">Review</div>
        <div className="list">
          <label className="listitem">
            <span className="grow">Daily goal</span>
            <input className="input num" type="number" min={1} max={500} value={settings.dailyGoal} onChange={(e) => setSettings({ dailyGoal: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 84, minHeight: 38 }} />
          </label>
          <label className="listitem">
            <span className="grow">New cards per day</span>
            <input className="input num" type="number" min={0} max={500} value={settings.newCardsPerDay} onChange={(e) => setSettings({ newCardsPerDay: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 84, minHeight: 38 }} />
          </label>
          <label className="listitem">
            <span className="grow">
              Type answers before revealing
              <div className="faint">Stronger recall practice</div>
            </span>
            <input type="checkbox" className="switch" checked={settings.typeAnswers} onChange={(e) => setSettings({ typeAnswers: e.target.checked })} />
          </label>
        </div>
      </div>

      <DataSettings vault={vault} />

      <p className="faint" style={{ textAlign: 'center', margin: '24px 0' }}>
        Recall · {live(vault.notes).length} notes · {live(vault.cards).length} cards · {live(vault.topics).length} topics
      </p>
    </div>
  );
}

function SyncSettings() {
  const settings = useStore((s) => s.settings);
  const sync = useStore((s) => s.sync);
  const { setSettings, syncNow } = useStore.getState();
  const gh = settings.github;
  const [repo, setRepo] = useState(gh ? `${gh.owner}/${gh.repo}` : '');
  const [token, setToken] = useState(gh?.token ?? '');
  const [path, setPath] = useState(gh?.path ?? 'vault.json');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function connect() {
    const m = /^\s*(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/.exec(repo);
    if (!m) {
      setErr('Repository should look like  your-name/recall-vault');
      return;
    }
    const cfg = { owner: m[1], repo: m[2], token: token.trim(), path: path.trim() || 'vault.json' };
    setBusy(true);
    setErr(undefined);
    try {
      await fetchRemoteVault(cfg); // validates token + repo access
      setSettings({ github: cfg, autoSync: true });
      await syncNow();
      const st = useStore.getState().sync;
      if (st.status === 'error') setErr(st.error);
      else toast('Sync connected ✓');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        <Cloud size={14} /> Sync (phone ⇄ computer ⇄ Claude)
      </div>
      <div className="card stack">
        {gh ? (
          <>
            <div className="row">
              {sync.status === 'error' ? <XCircle size={20} color="var(--bad)" /> : <CheckCircle2 size={20} color="var(--good)" />}
              <div className="grow">
                <b>
                  {gh.owner}/{gh.repo}
                </b>
                <div className="faint">
                  {sync.status === 'syncing'
                    ? 'Syncing…'
                    : sync.status === 'error'
                      ? `Error: ${sync.error}`
                      : sync.status === 'offline'
                        ? 'Offline — will sync when back online'
                        : sync.lastSync
                          ? `Last synced ${new Date(sync.lastSync).toLocaleString()}`
                          : 'Not synced yet'}
                  {sync.dirty && sync.status !== 'syncing' ? ' · local changes pending' : ''}
                </div>
              </div>
            </div>
            <div className="row">
              <button className="btn primary sm" disabled={sync.status === 'syncing'} onClick={() => void syncNow()}>
                Sync now
              </button>
              <label className="row faint" style={{ gap: 6 }}>
                <input type="checkbox" checked={settings.autoSync} onChange={(e) => setSettings({ autoSync: e.target.checked })} /> Auto-sync
              </label>
              <span className="grow" />
              <button
                className="btn ghost sm danger"
                onClick={() => {
                  if (confirm('Disconnect sync on this device? Your notes stay on this device and in GitHub.')) setSettings({ github: undefined });
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>
              Your notes live on this device. To sync between phone and computer — and let Claude help — connect a <b>private</b> GitHub repository.
            </p>
            <details>
              <summary className="faint" style={{ cursor: 'pointer' }}>
                How to set it up (2 minutes)
              </summary>
              <ol className="muted" style={{ fontSize: '0.9rem', paddingLeft: 20 }}>
                <li>
                  Create a private repo, e.g. <code>recall-vault</code> —{' '}
                  <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">
                    github.com/new <ExternalLink size={11} />
                  </a>
                </li>
                <li>
                  Create a fine-grained token —{' '}
                  <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                    new token <ExternalLink size={11} />
                  </a>
                  : "Only select repositories" → your vault repo; Permissions → <b>Contents: Read and write</b>.
                </li>
                <li>Paste the repo name and token below. The token is stored only on this device.</li>
              </ol>
            </details>
            <div>
              <label className="label">Repository</label>
              <input className="input" placeholder="your-name/recall-vault" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </div>
            <div>
              <label className="label">Access token</label>
              <input className="input" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </div>
            <details>
              <summary className="faint" style={{ cursor: 'pointer' }}>
                Advanced
              </summary>
              <label className="label" style={{ marginTop: 8 }}>
                File path in repo
              </label>
              <input className="input" value={path} onChange={(e) => setPath(e.target.value)} />
            </details>
            {err && <div style={{ color: 'var(--bad)', fontSize: '0.9rem' }}>{err}</div>}
            <button className="btn primary" disabled={busy || !repo.trim() || !token.trim()} onClick={() => void connect()}>
              {busy ? 'Connecting…' : 'Connect & sync'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function download(name: string, data: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function DataSettings({ vault }: { vault: Vault }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importVault = useStore((s) => s.importVault);
  const date = new Date().toISOString().slice(0, 10);
  return (
    <div className="section">
      <div className="section-title">Your data</div>
      <div className="list">
        <button className="listitem" onClick={() => download(`recall-backup-${date}.json`, new Blob([JSON.stringify(vault)], { type: 'application/json' }))}>
          <Download size={18} /> <span className="grow">Back up (JSON)</span>
        </button>
        <button className="listitem" onClick={() => download(`recall-markdown-${date}.zip`, exportMarkdownZip(vault))}>
          <Download size={18} /> <span className="grow">Export as Markdown (Obsidian-compatible .zip)</span>
        </button>
        <button className="listitem" onClick={() => fileRef.current?.click()}>
          <Upload size={18} /> <span className="grow">Import / merge a backup</span>
        </button>
        {live(vault.notes).length === 0 && (
          <button
            className="listitem"
            onClick={() => {
              loadSampleData();
              toast('Sample notes added');
            }}
          >
            <Sparkles size={18} /> <span className="grow">Load example notes</span>
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const v = normalizeVault(JSON.parse(await f.text()) as Partial<Vault>);
            importVault(v);
            toast(`Imported ${live(v.notes).length} notes`);
          } catch {
            toast('That file is not a Recall backup');
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
