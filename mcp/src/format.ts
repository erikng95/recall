// Human-readable text for tool results. Read-only helpers.

import {
  VERDICT_INFO,
  backlinks,
  outgoingLinks,
  type Note,
  type SourceRef,
  type Verification,
  type Vault,
} from '../../shared/vault.ts';
import { cardsOf, topicPath, effectiveVerdict } from './model.ts';

export function iso(ms?: number): string {
  return ms ? new Date(ms).toISOString() : 'unknown';
}

export function verdictLabel(verdict: string): string {
  const info = (VERDICT_INFO as Record<string, { label: string } | undefined>)[verdict];
  return info ? `${info.label} [${verdict}]` : verdict;
}

export function formatSource(s?: SourceRef): string {
  if (!s) return '(none)';
  const parts: string[] = [s.kind];
  if (s.title) parts.push(`"${s.title}"`);
  if (s.author) parts.push(`by ${s.author}`);
  if (s.locator) parts.push(`@ ${s.locator}`);
  if (s.url) parts.push(`<${s.url}>`);
  return parts.join(' ');
}

/** Verification as indented lines (first line has no indent). */
export function formatVerification(v?: Verification): string[] {
  if (!v) return ['verification: none (not fact-checked yet)'];
  const head = [verdictLabel(v.verdict)];
  if (v.confidence !== undefined) head.push(`confidence ${v.confidence}`);
  if (v.checkedAt) head.push(`checked ${iso(v.checkedAt)}`);
  if (v.checkedBy) head.push(`by ${v.checkedBy}`);
  const lines = [`verification: ${head.join(', ')}`];
  if (v.summary) lines.push(`  summary: ${v.summary}`);
  for (const e of v.evidence ?? []) {
    const meta = [e.stance, e.quality].filter(Boolean).join(', ');
    lines.push(`  - [${meta}] ${e.title}${e.url ? ` — ${e.url}` : ''}${e.note ? ` — ${e.note}` : ''}`);
  }
  return lines;
}

/** Flattened one-line-ish snippet of a body, centred on `query` when it matches. */
export function snippetFor(body: string, query?: string, len = 160): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  let start = 0;
  if (query) {
    const i = flat.toLowerCase().indexOf(query.toLowerCase());
    if (i > 60) start = i - 60;
  }
  const slice = flat.slice(start, start + len);
  return `${start > 0 ? '…' : ''}${slice}${start + len < flat.length ? '…' : ''}`;
}

export function topicPaths(v: Vault, n: Note): string[] {
  return n.topicIds.map((id) => topicPath(v, id)).filter(Boolean);
}

/** Full note view for get_note. */
export function formatNote(v: Vault, n: Note): string {
  const lines: string[] = [];
  lines.push(`# ${n.title}`);
  lines.push(`id: ${n.id}`);
  const topics = topicPaths(v, n);
  lines.push(`topics: ${topics.length ? topics.join(', ') : '(none)'}`);
  lines.push(`tags: ${n.tags.length ? n.tags.join(', ') : '(none)'}`);
  lines.push(`source: ${formatSource(n.source)}`);
  lines.push(...formatVerification(n.verification));
  if (n.tasks?.length) {
    lines.push(`pending tasks: ${n.tasks.join(', ')}${n.taskNote ? ` — note from user: ${n.taskNote}` : ''}`);
  } else {
    lines.push('pending tasks: none');
  }
  lines.push(`created: ${iso(n.createdAt)}  updated: ${iso(n.updatedAt)}`);

  const links = outgoingLinks(v, n);
  lines.push('');
  lines.push(`outgoing links (${links.length}):`);
  for (const l of links) {
    lines.push(l.note ? `- [[${l.title}]] → ${l.note.id}` : `- [[${l.title}]] → missing`);
  }
  if (!links.length) lines.push('- (none)');

  const back = backlinks(v, n);
  lines.push(`backlinks (${back.length}):`);
  for (const b of back) lines.push(`- ${b.title} (${b.id})`);
  if (!back.length) lines.push('- (none)');

  const cards = cardsOf(v, n.id);
  lines.push(`cards (${cards.length}):`);
  for (const c of cards) {
    const flags = [c.kind, c.createdBy ? `by ${c.createdBy}` : '', c.suspended ? 'suspended' : '']
      .filter(Boolean)
      .join(', ');
    lines.push(`- [${c.id}] (${flags}) Q: ${c.front} / A: ${c.back}`);
  }
  if (!cards.length) lines.push('- (none)');

  lines.push('');
  lines.push('--- body ---');
  lines.push(n.body);
  return lines.join('\n');
}

/** Entry for list_pending_tasks. */
export function formatPendingNote(v: Vault, n: Note): string {
  const lines: string[] = [];
  lines.push(`## ${n.title}`);
  lines.push(`id: ${n.id}`);
  lines.push(`tasks: ${(n.tasks ?? []).join(', ')}`);
  if (n.taskNote) lines.push(`task note from user: ${n.taskNote}`);
  const topics = topicPaths(v, n);
  lines.push(`topics: ${topics.length ? topics.join(', ') : '(none)'}`);
  lines.push(`tags: ${n.tags.length ? n.tags.join(', ') : '(none)'}`);
  lines.push(`source: ${formatSource(n.source)}`);
  lines.push(...formatVerification(n.verification));
  lines.push('--- body ---');
  lines.push(n.body);
  return lines.join('\n');
}

export const TASK_MEANINGS = [
  'verify — fact-check the claims in this note: research them with web search, then call set_verification (verdict, calibrated confidence, summary, evidence with real URLs). If a claim is false or misleading, add a short correction with update_note appendBody.',
  'cards — create 2-6 good flashcards from the note with add_cards (one fact per card, question on the front, concise answer on the back). Check get_note first so you do not duplicate existing cards.',
  'organize — assign topics (update_note topics or addTopics), add [[wikilinks]] to related existing notes, and fix the title if it is vague (update_note title).',
  'explain — append an "## Deeper dive" section (update_note appendBody) with context and mechanisms, linking related notes with [[wikilinks]].',
];

export function formatPendingHeader(count: number): string {
  return [
    `${count} note${count === 1 ? '' : 's'} with pending Claude tasks.`,
    '',
    'What each task means:',
    ...TASK_MEANINGS.map((m) => `- ${m}`),
    '',
    'When a task is done, call complete_task (set_verification clears "verify", add_cards clears "cards"). If the note has a task note from the user, follow those instructions too.',
  ].join('\n');
}

/** Compact record used by search_notes. */
export function noteListItem(v: Vault, n: Note, query?: string) {
  return {
    id: n.id,
    title: n.title,
    topics: topicPaths(v, n),
    tags: n.tags,
    verdict: effectiveVerdict(n),
    updatedAt: iso(n.updatedAt),
    snippet: snippetFor(n.body, query),
  };
}
