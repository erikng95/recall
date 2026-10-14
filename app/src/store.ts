import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  clozeCardId,
  emptyVault,
  extractClozes,
  live,
  mergeVaults,
  newId,
  normalizeTitle,
  normalizeVault,
  renameLinksInBody,
  type Card,
  type ClaudeTask,
  type ID,
  type InboxItem,
  type Note,
  type ReviewLog,
  type SrsState,
  type Topic,
  type Vault,
} from '@shared/vault.ts';
import { syncVault, type GitHubConfig } from '@shared/github.ts';

// ---------- Settings (device-local, not synced) ----------

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  github?: GitHubConfig;
  autoSync: boolean;
  newCardsPerDay: number;
}

const SETTINGS_KEY = 'recall.settings';

function loadSettings(): Settings {
  const defaults: Settings = { theme: 'auto', autoSync: true, newCardsPerDay: 20 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return defaults;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ---------- Store ----------

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error' | 'offline';

interface SyncState {
  status: SyncStatus;
  lastSync?: number;
  error?: string;
  dirty: boolean; // local changes not yet pushed
}

interface State {
  vault: Vault;
  loaded: boolean;
  settings: Settings;
  sync: SyncState;

  init(): Promise<void>;
  setSettings(patch: Partial<Settings>): void;
  replaceVault(v: Vault): void;
  importVault(v: Vault): void;

  // notes
  createNote(input: Partial<Omit<Note, 'id' | 'createdAt' | 'updatedAt'>> & { title?: string }): Note;
  updateNote(id: ID, patch: Partial<Omit<Note, 'id' | 'createdAt'>>): void;
  renameNote(id: ID, oldTitle: string, newTitle: string): void;
  deleteNote(id: ID): void;
  toggleTask(id: ID, task: ClaudeTask): void;

  // topics
  createTopic(name: string, parentId?: ID, emoji?: string): Topic;
  updateTopic(id: ID, patch: Partial<Omit<Topic, 'id' | 'createdAt'>>): void;
  deleteTopic(id: ID): void;

  // cards
  addCard(noteId: ID, front: string, back: string): Card;
  updateCard(id: ID, patch: Partial<Omit<Card, 'id' | 'createdAt'>>): void;
  deleteCard(id: ID): void;
  recordReview(cardId: ID, rating: ReviewLog['rating'], srs: SrsState): void;

  // inbox
  addInbox(item: Pick<InboxItem, 'text'> & Partial<InboxItem>): InboxItem;
  updateInbox(id: ID, patch: Partial<InboxItem>): void;
  deleteInbox(id: ID): void;

  syncNow(): Promise<void>;
}

type Mutator = (v: Vault) => void;

/** Shallow copy-on-write clone so React selectors see new references. */
function cloneVault(v: Vault): Vault {
  return {
    schema: 1,
    notes: { ...v.notes },
    topics: { ...v.topics },
    cards: { ...v.cards },
    inbox: { ...v.inbox },
    reviews: { ...v.reviews },
  };
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

/** Keep auto-generated cloze cards in sync with ==highlights== in the note body. */
function syncAutoCards(v: Vault, note: Note, now: number): boolean {
  let changed = false;
  const specs = note.deleted ? [] : extractClozes(note);
  const wanted = new Set<ID>();
  for (const s of specs) {
    const id = clozeCardId(note.id, s.key);
    wanted.add(id);
    const existing = v.cards[id];
    if (!existing) {
      v.cards[id] = {
        id,
        noteId: note.id,
        kind: 'cloze',
        front: s.front,
        back: s.back,
        auto: true,
        createdBy: 'auto',
        createdAt: now,
        updatedAt: now,
      };
      changed = true;
    } else if (existing.deleted || existing.front !== s.front || existing.back !== s.back) {
      v.cards[id] = { ...existing, front: s.front, back: s.back, deleted: false, updatedAt: now };
      changed = true;
    }
  }
  for (const c of Object.values(v.cards)) {
    if (c.noteId === note.id && c.auto && !c.deleted && !wanted.has(c.id)) {
      v.cards[c.id] = { ...c, deleted: true, updatedAt: now };
      changed = true;
    }
  }
  return changed;
}

/**
 * Make sure every note's ==highlights== have cloze cards — notes created or edited
 * elsewhere (by Claude via the MCP server, or another device) only carry the text.
 * Returns a new vault if anything changed, else undefined.
 */
function reconcileAutoCards(v: Vault): Vault | undefined {
  const next = cloneVault(v);
  const now = Date.now();
  let changed = false;
  const byNote = new Map<ID, Card[]>();
  for (const c of Object.values(next.cards)) {
    if (c.auto && !c.deleted) {
      if (!byNote.has(c.noteId)) byNote.set(c.noteId, []);
      byNote.get(c.noteId)!.push(c);
    }
  }
  for (const n of Object.values(next.notes)) {
    if (n.deleted && !byNote.has(n.id)) continue;
    if (!n.deleted && !n.body.includes('==') && !byNote.has(n.id)) continue;
    if (syncAutoCards(next, n, now)) changed = true;
  }
  return changed ? next : undefined;
}

export const useStore = create<State>((set, get) => {
  function mutate(fn: Mutator) {
    const v = cloneVault(get().vault);
    fn(v);
    set({ vault: v, sync: { ...get().sync, dirty: true } });
    schedulePersist();
    scheduleSync();
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void idbSet('vault', get().vault);
    }, 250);
  }

  function scheduleSync(delay = 4000) {
    const { settings } = get();
    if (!settings.github || !settings.autoSync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void get().syncNow(), delay);
  }

  return {
    vault: emptyVault(),
    loaded: false,
    settings: loadSettings(),
    sync: { status: 'disabled', dirty: false },

    async init() {
      // Ask the browser not to evict our data under storage pressure (important on Android).
      void navigator.storage?.persist?.().catch(() => undefined);
      let stored: Vault | undefined;
      try {
        stored = await idbGet<Vault>('vault');
      } catch {
        /* IndexedDB unavailable */
      }
      const settings = get().settings;
      set({
        vault: normalizeVault(stored),
        loaded: true,
        sync: { status: settings.github ? 'idle' : 'disabled', dirty: !!idbDirtyFlag() },
      });
      const fixed = reconcileAutoCards(get().vault);
      if (fixed) {
        set({ vault: fixed, sync: { ...get().sync, dirty: true } });
        schedulePersist();
      }
      if (settings.github && settings.autoSync) void get().syncNow();
    },

    setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      saveSettings(settings);
      set({ settings, sync: { ...get().sync, status: settings.github ? get().sync.status === 'disabled' ? 'idle' : get().sync.status : 'disabled' } });
    },

    replaceVault(v) {
      set({ vault: normalizeVault(v) });
      schedulePersist();
    },

    importVault(v) {
      const merged = mergeVaults(get().vault, normalizeVault(v));
      set({ vault: reconcileAutoCards(merged) ?? merged, sync: { ...get().sync, dirty: true } });
      schedulePersist();
      scheduleSync(500);
    },

    // ----- notes -----
    createNote(input) {
      const now = Date.now();
      const note: Note = {
        id: newId(),
        title: input.title?.trim() || 'Untitled',
        body: input.body ?? '',
        topicIds: input.topicIds ?? [],
        tags: input.tags ?? [],
        source: input.source,
        verification: input.verification,
        tasks: input.tasks,
        taskNote: input.taskNote,
        pinned: input.pinned,
        createdAt: now,
        updatedAt: now,
      };
      // ensure unique title
      const titles = new Set(live(get().vault.notes).map((n) => normalizeTitle(n.title)));
      if (titles.has(normalizeTitle(note.title))) {
        let i = 2;
        while (titles.has(normalizeTitle(`${note.title} ${i}`))) i++;
        note.title = `${note.title} ${i}`;
      }
      mutate((v) => {
        v.notes[note.id] = note;
        syncAutoCards(v, note, now);
      });
      return note;
    },

    updateNote(id, patch) {
      mutate((v) => {
        const cur = v.notes[id];
        if (!cur) return;
        const now = Date.now();
        const next = { ...cur, ...patch, updatedAt: now };
        v.notes[id] = next;
        if (patch.body !== undefined || patch.deleted !== undefined) syncAutoCards(v, next, now);
      });
    },

    renameNote(id, oldTitle, newTitle) {
      if (normalizeTitle(oldTitle) === normalizeTitle(newTitle) || !newTitle.trim()) return;
      mutate((v) => {
        const now = Date.now();
        for (const n of live(v.notes)) {
          if (n.id === id) continue;
          const body = renameLinksInBody(n.body, oldTitle, newTitle);
          if (body !== n.body) v.notes[n.id] = { ...n, body, updatedAt: now };
        }
      });
    },

    deleteNote(id) {
      mutate((v) => {
        const cur = v.notes[id];
        if (!cur) return;
        const now = Date.now();
        v.notes[id] = { ...cur, deleted: true, updatedAt: now };
        for (const c of Object.values(v.cards)) {
          if (c.noteId === id && !c.deleted) v.cards[c.id] = { ...c, deleted: true, updatedAt: now };
        }
      });
    },

    toggleTask(id, task) {
      const cur = get().vault.notes[id];
      if (!cur) return;
      const tasks = new Set(cur.tasks ?? []);
      if (tasks.has(task)) tasks.delete(task);
      else tasks.add(task);
      get().updateNote(id, { tasks: [...tasks] });
    },

    // ----- topics -----
    createTopic(name, parentId, emoji) {
      const now = Date.now();
      const existing = live(get().vault.topics).find(
        (t) => normalizeTitle(t.name) === normalizeTitle(name) && (t.parentId ?? '') === (parentId ?? ''),
      );
      if (existing) return existing;
      const topic: Topic = { id: newId(), name: name.trim(), parentId, emoji, createdAt: now, updatedAt: now };
      mutate((v) => {
        v.topics[topic.id] = topic;
      });
      return topic;
    },

    updateTopic(id, patch) {
      mutate((v) => {
        const cur = v.topics[id];
        if (cur) v.topics[id] = { ...cur, ...patch, updatedAt: Date.now() };
      });
    },

    deleteTopic(id) {
      mutate((v) => {
        const cur = v.topics[id];
        if (!cur) return;
        const now = Date.now();
        v.topics[id] = { ...cur, deleted: true, updatedAt: now };
        // re-parent children, untag notes
        for (const t of live(v.topics)) {
          if (t.parentId === id) v.topics[t.id] = { ...t, parentId: cur.parentId, updatedAt: now };
        }
        for (const n of live(v.notes)) {
          if (n.topicIds.includes(id)) {
            v.notes[n.id] = { ...n, topicIds: n.topicIds.filter((x) => x !== id), updatedAt: now };
          }
        }
      });
    },

    // ----- cards -----
    addCard(noteId, front, back) {
      const now = Date.now();
      const card: Card = { id: newId(), noteId, kind: 'basic', front, back, createdBy: 'me', createdAt: now, updatedAt: now };
      mutate((v) => {
        v.cards[card.id] = card;
      });
      return card;
    },

    updateCard(id, patch) {
      mutate((v) => {
        const cur = v.cards[id];
        if (cur) v.cards[id] = { ...cur, ...patch, updatedAt: Date.now() };
      });
    },

    deleteCard(id) {
      mutate((v) => {
        const cur = v.cards[id];
        if (cur) v.cards[id] = { ...cur, deleted: true, updatedAt: Date.now() };
      });
    },

    recordReview(cardId, rating, srs) {
      mutate((v) => {
        const cur = v.cards[cardId];
        if (!cur) return;
        const now = Date.now();
        v.cards[cardId] = { ...cur, srs, updatedAt: now };
        const log: ReviewLog = { id: newId(), cardId, rating, createdAt: now, updatedAt: now };
        v.reviews[log.id] = log;
      });
    },

    // ----- inbox -----
    addInbox(item) {
      const now = Date.now();
      const rec: InboxItem = { status: 'new', ...item, id: newId(), createdAt: now, updatedAt: now };
      mutate((v) => {
        v.inbox[rec.id] = rec;
      });
      return rec;
    },

    updateInbox(id, patch) {
      mutate((v) => {
        const cur = v.inbox[id];
        if (cur) v.inbox[id] = { ...cur, ...patch, updatedAt: Date.now() };
      });
    },

    deleteInbox(id) {
      mutate((v) => {
        const cur = v.inbox[id];
        if (cur) v.inbox[id] = { ...cur, deleted: true, updatedAt: Date.now() };
      });
    },

    // ----- sync -----
    async syncNow() {
      const { settings, sync } = get();
      if (!settings.github) return;
      if (sync.status === 'syncing') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        set({ sync: { ...sync, status: 'offline' } });
        return;
      }
      set({ sync: { ...sync, status: 'syncing', error: undefined } });
      const snapshot = get().vault;
      try {
        const res = await syncVault(settings.github, snapshot, `Sync from ${deviceLabel()}`);
        // Merge result with anything edited while we were syncing.
        const current = get().vault;
        const changedMeanwhile = current !== snapshot;
        const merged = changedMeanwhile ? mergeVaults(current, res.vault) : res.vault;
        // Pulled notes (e.g. written by Claude) may have highlights without cards yet.
        const fixed = res.pulled ? reconcileAutoCards(merged) : undefined;
        const dirty = changedMeanwhile || !!fixed;
        set({
          vault: fixed ?? merged,
          sync: { status: 'idle', lastSync: Date.now(), dirty },
        });
        schedulePersist();
        markClean(!dirty);
        if (dirty) scheduleSync(1500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const offline = /Failed to fetch|NetworkError|network/i.test(msg);
        set({ sync: { ...get().sync, status: offline ? 'offline' : 'error', error: msg } });
      }
    },
  };
});

function deviceLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'device';
}

// Persist a "dirty" marker so un-synced edits survive restarts.
function idbDirtyFlag(): boolean {
  try {
    return localStorage.getItem('recall.dirty') === '1';
  } catch {
    return false;
  }
}
function markClean(clean: boolean) {
  try {
    localStorage.setItem('recall.dirty', clean ? '0' : '1');
  } catch {
    /* ignore */
  }
}
useStore.subscribe((s, prev) => {
  if (s.sync.dirty && !prev.sync.dirty) markClean(false);
});

// Flush pending writes when the app is backgrounded (important on mobile).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const st = useStore.getState();
    if (document.visibilityState === 'hidden') {
      clearTimeout(persistTimer);
      void idbSet('vault', st.vault);
      if (st.sync.dirty && st.settings.github && st.settings.autoSync) void st.syncNow();
    } else if (st.settings.github && st.settings.autoSync) {
      void st.syncNow();
    }
  });
  window.addEventListener('online', () => {
    const st = useStore.getState();
    if (st.settings.github && st.settings.autoSync) void st.syncNow();
  });
}

if (import.meta.env.DEV) (window as unknown as { __recall: typeof useStore }).__recall = useStore;

// ---------- Selectors / derived helpers ----------

export function topicPath(v: Vault, id: ID): string {
  const parts: string[] = [];
  let cur: Topic | undefined = v.topics[id];
  let guard = 0;
  while (cur && !cur.deleted && guard++ < 20) {
    parts.unshift(cur.name);
    cur = cur.parentId ? v.topics[cur.parentId] : undefined;
  }
  return parts.join(' / ');
}

/** id plus all descendant topic ids. */
export function topicWithDescendants(v: Vault, id: ID): Set<ID> {
  const out = new Set<ID>([id]);
  let grew = true;
  const topics = live(v.topics);
  while (grew) {
    grew = false;
    for (const t of topics) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

export function isDue(c: Card, now = Date.now()): boolean {
  return !c.deleted && !c.suspended && (!c.srs || c.srs.due <= now);
}
