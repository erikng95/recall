// Shared data model for the Recall knowledge vault.
// Used by both the PWA (app/) and the Claude MCP server (mcp/).
// Pure TypeScript, no dependencies, erasable syntax only (runs under Node type-stripping).

export type ID = string;

export interface BaseRecord {
  id: ID;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms — last-writer-wins merge key
  deleted?: boolean; // soft delete (tombstone) so deletions sync
}

export type SourceKind =
  | 'podcast'
  | 'article'
  | 'video'
  | 'book'
  | 'paper'
  | 'conversation'
  | 'social'
  | 'other';

export interface SourceRef {
  kind: SourceKind;
  title?: string;
  url?: string;
  author?: string;
  locator?: string; // timestamp ("12:30"), page, chapter…
}

export type Verdict =
  | 'unchecked'
  | 'supported'
  | 'mostly-supported'
  | 'mixed'
  | 'misleading'
  | 'false'
  | 'unverifiable';

export type Stance = 'supports' | 'contradicts' | 'context';

export interface Evidence {
  title: string;
  url?: string;
  stance: Stance;
  note?: string;
  quality?: 'high' | 'medium' | 'low';
}

export interface Verification {
  verdict: Verdict;
  confidence?: number; // 0..1
  summary?: string; // short explanation of the verdict
  evidence?: Evidence[];
  checkedAt?: number;
  checkedBy?: string; // "claude", "me"…
}

/** Things the user asked Claude to do with a note. Claude clears them when done. */
export type ClaudeTask = 'verify' | 'cards' | 'organize' | 'explain';

export interface Note extends BaseRecord {
  title: string;
  body: string; // markdown with [[wikilinks]] and ==highlights== (highlights become cloze cards)
  topicIds: ID[];
  tags: string[];
  source?: SourceRef;
  verification?: Verification;
  tasks?: ClaudeTask[];
  taskNote?: string; // optional instructions for Claude
  pinned?: boolean;
}

/** Things the user asked Claude to do with a whole topic. */
export type TopicTask = 'explore';
export type Level = 'beginner' | 'intermediate' | 'advanced';

export interface Topic extends BaseRecord {
  name: string;
  parentId?: ID;
  emoji?: string;
  color?: string;
  description?: string;
  /** 'explore' = write a starter pack of notes (or go deeper if notes exist). Claude clears it. */
  tasks?: TopicTask[];
  level?: Level;
  taskNote?: string;
}

/** FSRS scheduling state, serialized (dates as epoch ms). Absent = new card. */
export interface SrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review?: number;
}

export type CardKind = 'basic' | 'cloze';

export interface Card extends BaseRecord {
  noteId: ID;
  kind: CardKind;
  front: string; // markdown; for cloze, contains the blank "[…]"
  back: string; // markdown
  auto?: boolean; // generated from ==highlights== in the note body
  srs?: SrsState;
  suspended?: boolean;
  createdBy?: string; // "me", "claude", "auto"
}

export interface InboxItem extends BaseRecord {
  text: string;
  title?: string;
  url?: string;
  source?: SourceRef;
  status: 'new' | 'done';
  noteIds?: ID[]; // notes created from this item
}

export interface ReviewLog extends BaseRecord {
  cardId: ID;
  rating: 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
}

export interface Vault {
  schema: 1;
  notes: Record<ID, Note>;
  topics: Record<ID, Topic>;
  cards: Record<ID, Card>;
  inbox: Record<ID, InboxItem>;
  reviews: Record<ID, ReviewLog>;
}

export const COLLECTIONS = ['notes', 'topics', 'cards', 'inbox', 'reviews'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export function emptyVault(): Vault {
  return { schema: 1, notes: {}, topics: {}, cards: {}, inbox: {}, reviews: {} };
}

/** Fill in missing collections (older / hand-edited files). */
export function normalizeVault(v: Partial<Vault> | null | undefined): Vault {
  const out = emptyVault();
  if (!v) return out;
  for (const c of COLLECTIONS) {
    const src = (v as Record<string, unknown>)[c];
    if (src && typeof src === 'object') (out as unknown as Record<string, unknown>)[c] = { ...(src as object) };
  }
  return out;
}

// ---------- IDs ----------

export function newId(): ID {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* insecure context — fall through */
    }
  }
  const rnd = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}-${rnd()}`;
}

/** Small deterministic string hash (FNV-1a, hex) for stable derived IDs. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------- Merge (sync) ----------

function pickNewer<T extends BaseRecord>(a: T | undefined, b: T | undefined): T {
  if (!a) return b as T;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b; // deletion wins ties
  // deterministic tie-break
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/** Record-level last-writer-wins merge of two vaults. Pure; returns a new vault. */
export function mergeVaults(a: Vault, b: Vault): Vault {
  const out = emptyVault();
  for (const c of COLLECTIONS) {
    const ca = a[c] as Record<ID, BaseRecord>;
    const cb = b[c] as Record<ID, BaseRecord>;
    const merged: Record<ID, BaseRecord> = {};
    for (const id of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      merged[id] = pickNewer(ca[id], cb[id]);
    }
    (out as unknown as Record<string, unknown>)[c] = merged;
  }
  return out;
}

/** True if merging `incoming` into `base` would change anything. */
export function vaultDiffers(base: Vault, incoming: Vault): boolean {
  for (const c of COLLECTIONS) {
    const ca = base[c] as Record<ID, BaseRecord>;
    const cb = incoming[c] as Record<ID, BaseRecord>;
    for (const id of Object.keys(cb)) {
      const x = ca[id];
      const y = cb[id];
      if (!x || x.updatedAt !== y.updatedAt || !!x.deleted !== !!y.deleted) return true;
    }
  }
  return false;
}

// ---------- Live views ----------

export function live<T extends BaseRecord>(coll: Record<ID, T>): T[] {
  return Object.values(coll).filter((r) => !r.deleted);
}

// ---------- Wikilinks ----------

export interface WikiLink {
  target: string; // note title as written
  alias?: string;
}

const WIKILINK_RE = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]+))?\]\]/g;

export function parseWikilinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of body.matchAll(WIKILINK_RE)) {
    out.push({ target: m[1].trim(), alias: m[3]?.trim() });
  }
  return out;
}

export function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map normalized title -> note (live notes only). */
export function titleIndex(v: Vault): Map<string, Note> {
  const m = new Map<string, Note>();
  for (const n of live(v.notes)) m.set(normalizeTitle(n.title), n);
  return m;
}

/** Outgoing links of a note, resolved where possible. */
export function outgoingLinks(v: Vault, note: Note, idx = titleIndex(v)) {
  const seen = new Set<string>();
  const res: { title: string; note?: Note }[] = [];
  for (const l of parseWikilinks(note.body)) {
    const key = normalizeTitle(l.target);
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({ title: l.target, note: idx.get(key) });
  }
  return res;
}

/** Notes that link to `note`. */
export function backlinks(v: Vault, note: Note): Note[] {
  const key = normalizeTitle(note.title);
  return live(v.notes).filter(
    (n) => n.id !== note.id && parseWikilinks(n.body).some((l) => normalizeTitle(l.target) === key),
  );
}

/** Replace [[Old]] / [[Old|alias]] references with the new title. */
export function renameLinksInBody(body: string, oldTitle: string, newTitle: string): string {
  const key = normalizeTitle(oldTitle);
  return body.replace(WIKILINK_RE, (full, target: string, heading?: string, alias?: string) => {
    if (normalizeTitle(target) !== key) return full;
    return `[[${newTitle}${heading ?? ''}${alias ? `|${alias}` : ''}]]`;
  });
}

/** Graph edges between live notes (undirected, deduped). */
export function graphEdges(v: Vault): { source: ID; target: ID }[] {
  const idx = titleIndex(v);
  const edges = new Map<string, { source: ID; target: ID }>();
  for (const n of live(v.notes)) {
    for (const l of parseWikilinks(n.body)) {
      const t = idx.get(normalizeTitle(l.target));
      if (!t || t.id === n.id) continue;
      const key = n.id < t.id ? `${n.id}|${t.id}` : `${t.id}|${n.id}`;
      if (!edges.has(key)) edges.set(key, { source: n.id, target: t.id });
    }
  }
  return [...edges.values()];
}

// ---------- Highlights → cloze cards ----------

const HIGHLIGHT_RE = /==([^=\n]+)==/g;

/** Strip markdown-ish noise for card text. */
function cleanForCard(s: string): string {
  return s
    .replace(/^#+\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .trim();
}

export interface ClozeSpec {
  key: string; // stable per (note, highlighted text)
  front: string;
  back: string;
}

/**
 * Every ==highlight== in a note becomes a cloze card: the line containing it,
 * with that highlight blanked out (other highlights shown plainly).
 */
export function extractClozes(note: Pick<Note, 'id' | 'title' | 'body'>): ClozeSpec[] {
  const out: ClozeSpec[] = [];
  const seen = new Set<string>();
  const lines = note.body.split('\n');
  for (const line of lines) {
    const matches = [...line.matchAll(HIGHLIGHT_RE)];
    for (const m of matches) {
      const answer = m[1].trim();
      const k = normalizeTitle(answer);
      if (!answer || seen.has(k)) continue;
      seen.add(k);
      let i = 0;
      const front = line.replace(HIGHLIGHT_RE, (_f, inner: string) => {
        const isTarget = i++ === matches.indexOf(m);
        return isTarget ? '**[…]**' : inner;
      });
      i = 0;
      const back = line.replace(HIGHLIGHT_RE, (_f, inner: string) => {
        const isTarget = i++ === matches.indexOf(m);
        return isTarget ? `**${inner}**` : inner;
      });
      out.push({
        key: k,
        front: cleanForCard(front),
        back: cleanForCard(back),
      });
    }
  }
  return out;
}

export function clozeCardId(noteId: ID, key: string): ID {
  return `cz-${noteId}-${hashString(key)}`;
}

// ---------- Verdict metadata ----------

export const VERDICT_INFO: Record<Verdict, { label: string; tone: 'neutral' | 'good' | 'ok' | 'warn' | 'bad' }> = {
  unchecked: { label: 'Not checked', tone: 'neutral' },
  supported: { label: 'Supported', tone: 'good' },
  'mostly-supported': { label: 'Mostly supported', tone: 'ok' },
  mixed: { label: 'Mixed evidence', tone: 'warn' },
  misleading: { label: 'Misleading', tone: 'warn' },
  false: { label: 'False', tone: 'bad' },
  unverifiable: { label: 'Unverifiable', tone: 'neutral' },
};

export const SOURCE_KINDS: SourceKind[] = [
  'podcast',
  'article',
  'video',
  'book',
  'paper',
  'conversation',
  'social',
  'other',
];
