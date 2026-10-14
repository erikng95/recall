// Pure helpers over the Vault: lookups, topic paths, tasks. No I/O.
// Record conventions the PWA relies on are applied here and in tools.ts:
// new records get newId() + createdAt/updatedAt; edits bump updatedAt; deletes are tombstones.

import {
  live,
  newId,
  normalizeTitle,
  titleIndex,
  type Card,
  type ClaudeTask,
  type Evidence,
  type ID,
  type Note,
  type SourceKind,
  type Stance,
  type Topic,
  type Vault,
  type Verdict,
  type Verification,
} from '../../shared/vault.ts';

/** A problem the caller can fix (bad id, duplicate title…). Reported to Claude as a tool error. */
export class RecallError extends Error {}

export function fail(message: string): never {
  throw new RecallError(message);
}

// Literal lists for zod enums. Compile-time check below keeps them in sync with shared/vault.ts.
export const VERDICT_VALUES = [
  'unchecked',
  'supported',
  'mostly-supported',
  'mixed',
  'misleading',
  'false',
  'unverifiable',
] as const;
export const SOURCE_KIND_VALUES = ['podcast', 'article', 'video', 'book', 'paper', 'conversation', 'social', 'other'] as const;
export const TASK_VALUES = ['verify', 'cards', 'organize', 'explain'] as const;
export const STANCE_VALUES = ['supports', 'contradicts', 'context'] as const;
export const QUALITY_VALUES = ['high', 'medium', 'low'] as const;

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const literalListsMatchShared: [
  Equals<(typeof VERDICT_VALUES)[number], Verdict>,
  Equals<(typeof SOURCE_KIND_VALUES)[number], SourceKind>,
  Equals<(typeof TASK_VALUES)[number], ClaudeTask>,
  Equals<(typeof STANCE_VALUES)[number], Stance>,
  Equals<(typeof QUALITY_VALUES)[number], NonNullable<Evidence['quality']>>,
] = [true, true, true, true, true];

export function now(): number {
  return Date.now();
}

/** Own-property lookup, so ids like "constructor" never hit Object.prototype. */
export function getOwn<T>(coll: Record<ID, T>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(coll, id) ? coll[id] : undefined;
}

// ---------- Notes ----------

export function liveNote(v: Vault, id: ID): Note {
  const n = getOwn(v.notes, id);
  if (!n || n.deleted) fail(`No note with id "${id}". Use search_notes to find the right id.`);
  return n;
}

export function resolveNote(v: Vault, ref: { id?: string; title?: string }): Note {
  if (ref.id) return liveNote(v, ref.id);
  if (ref.title) {
    const n = titleIndex(v).get(normalizeTitle(ref.title));
    if (!n) fail(`No note titled "${ref.title}". Use search_notes to find it.`);
    return n;
  }
  return fail('Provide either id or title.');
}

export function effectiveVerdict(n: Note): Verdict {
  return n.verification?.verdict ?? 'unchecked';
}

export function cardsOf(v: Vault, noteId: ID): Card[] {
  return live(v.cards)
    .filter((c) => c.noteId === noteId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

export function appendMarkdown(body: string, extra: string): string {
  const add = extra.trim();
  if (!add) return body;
  return body.trim() ? `${body.replace(/\s+$/, '')}\n\n${add}` : add;
}

export interface VerificationInput {
  verdict: Verdict;
  confidence?: number;
  summary?: string;
  evidence?: Evidence[];
}

export function makeVerification(input: VerificationInput, t: number): Verification {
  return {
    verdict: input.verdict,
    confidence: input.confidence,
    summary: input.summary,
    evidence: input.evidence,
    checkedAt: t,
    checkedBy: 'claude',
  };
}

/** Remove the given tasks from a note. Returns true if anything changed (caller bumps updatedAt). */
export function clearTasks(note: Note, done: ClaudeTask[]): boolean {
  const before = note.tasks ?? [];
  const after = before.filter((task) => !done.includes(task));
  if (after.length === before.length) return false;
  note.tasks = after;
  if (after.length === 0) delete note.taskNote;
  return true;
}

// ---------- Topics ----------

export function liveTopic(v: Vault, id: string): Topic | undefined {
  const t = getOwn(v.topics, id);
  return t && !t.deleted ? t : undefined;
}

/** "Science/Biology/Genetics" for a topic id. */
export function topicPath(v: Vault, id: ID): string {
  const parts: string[] = [];
  const seen = new Set<ID>();
  let cur = liveTopic(v, id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? liveTopic(v, cur.parentId) : undefined;
  }
  return parts.join('/');
}

/**
 * Resolve a topic id or a path ("Science/Biology"). Path segments match names case-insensitively
 * under the same parent. With `create`, missing segments are created. Returns undefined if not found and !create.
 */
export function resolveTopicRef(v: Vault, ref: string, create: boolean): ID | undefined {
  const r = ref.trim();
  if (!r) fail('Empty topic path.');
  if (liveTopic(v, r)) return r;
  const segments = r
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) fail(`Invalid topic path "${ref}".`);

  let parent: ID | undefined;
  for (const seg of segments) {
    const key = normalizeTitle(seg);
    let found = live(v.topics).find((t) => (t.parentId || undefined) === parent && normalizeTitle(t.name) === key);
    if (!found) {
      if (!create) return undefined;
      const ts = now();
      const topic: Topic = {
        id: newId(),
        name: seg,
        createdAt: ts,
        updatedAt: ts,
        ...(parent ? { parentId: parent } : {}),
      };
      v.topics[topic.id] = topic;
      found = topic;
    }
    parent = found.id;
  }
  return parent;
}

export function resolveTopicList(v: Vault, refs: string[], create: boolean): ID[] {
  const ids: ID[] = [];
  for (const ref of refs) {
    const id = resolveTopicRef(v, ref, create);
    if (!id) fail(`Topic "${ref}" does not exist. Use create_topic to make it, or check list_topics.`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** A topic plus all of its live descendants. */
export function topicSubtree(v: Vault, rootId: ID): Set<ID> {
  const children = new Map<ID, ID[]>();
  for (const t of live(v.topics)) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t.id);
    children.set(t.parentId, list);
  }
  const out = new Set<ID>([rootId]);
  const stack: ID[] = [rootId];
  while (stack.length) {
    const id = stack.pop() as ID;
    for (const c of children.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/** Indented topic tree. Counts are direct note counts. */
export function topicTreeLines(v: Vault, opts: { ids?: boolean; descriptions?: boolean } = {}): string[] {
  const topics = live(v.topics);
  const liveIds = new Set(topics.map((t) => t.id));
  const direct = new Map<ID, number>();
  for (const n of live(v.notes)) {
    for (const tid of n.topicIds) direct.set(tid, (direct.get(tid) ?? 0) + 1);
  }

  const children = new Map<ID, Topic[]>();
  const roots: Topic[] = [];
  for (const t of topics) {
    if (t.parentId && liveIds.has(t.parentId)) {
      const list = children.get(t.parentId) ?? [];
      list.push(t);
      children.set(t.parentId, list);
    } else {
      roots.push(t);
    }
  }
  const byName = (a: Topic, b: Topic) => a.name.localeCompare(b.name);
  roots.sort(byName);

  const lines: string[] = [];
  const seen = new Set<ID>();
  const walk = (t: Topic, depth: number) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    const n = direct.get(t.id) ?? 0;
    let line = `${'  '.repeat(depth)}- ${t.emoji ? `${t.emoji} ` : ''}${t.name} (${n} note${n === 1 ? '' : 's'})`;
    if (opts.ids) line += ` [id: ${t.id}]`;
    if (opts.descriptions && t.description) line += ` — ${t.description}`;
    lines.push(line);
    for (const c of (children.get(t.id) ?? []).sort(byName)) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Anything unreachable (a parent cycle) is listed at the root so nothing disappears.
  for (const t of topics) if (!seen.has(t.id)) walk(t, 0);
  return lines;
}
