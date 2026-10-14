// Human-readable text for tool results. Read-only helpers.

import {
  VERDICT_INFO,
  backlinks,
  live,
  outgoingLinks,
  type Card,
  type ID,
  type Note,
  type SourceRef,
  type Topic,
  type Verification,
  type Vault,
} from '../../shared/vault.ts';
import {
  cardMastery,
  isLeech,
  missingNotes,
  reviewStreak,
  reviewsToday,
  retentionRate,
  rootTopics,
  summarize,
  topicKnowledge,
  type KnowledgeSummary,
} from '../../shared/knowledge.ts';
import { cardsOf, liveTopic, topicPath, effectiveVerdict, topicSubtree } from './model.ts';

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

export const TOPIC_TASK_MEANINGS = [
  'explore — Write a starter pack: 6–10 atomic notes that build understanding from fundamentals up (adjust depth to `level`, default beginner); if the topic already has notes, go deeper/fill gaps instead of repeating. Each note: clear declarative title, concise markdown body, key facts marked with ==highlights== (they become flashcards), [[wikilinks]] between the new notes and to related existing notes, a real source (cite only URLs found via web search), and set_verification for factual claims. Put notes under the topic path (subtopics allowed). Finish with complete_topic_task.',
];

export function formatPendingTopicHeader(count: number): string {
  return [
    `${count} topic${count === 1 ? '' : 's'} with pending Claude tasks.`,
    '',
    'What each topic task means:',
    ...TOPIC_TASK_MEANINGS.map((m) => `- ${m}`),
    '',
    'When the starter pack is written, call complete_topic_task with the topic id and task "explore".',
  ].join('\n');
}

function knowledgeLine(k: KnowledgeSummary): string {
  return `mastery ${k.mastery}% (${k.label}), ${k.notes} notes, ${k.cards} cards, ${k.due} due, ${k.fading} fading, ${k.leeches} leeches`;
}

/** Entry for list_pending_tasks: a topic with pending topic tasks, plus what it already holds. */
export function formatPendingTopic(v: Vault, t: Topic): string {
  const lines: string[] = [];
  lines.push(`## ${topicPath(v, t.id)}`);
  lines.push(`id: ${t.id}`);
  lines.push(`tasks: ${(t.tasks ?? []).join(', ')}`);
  lines.push(`level: ${t.level ?? 'not set (default beginner)'}`);
  if (t.taskNote) lines.push(`task note from user: ${t.taskNote}`);
  if (t.description) lines.push(`description: ${t.description}`);
  const ids = topicSubtree(v, t.id);
  const existing = live(v.notes).filter((n) => n.topicIds.some((tid) => ids.has(tid)));
  if (existing.length) {
    lines.push(`notes already in this topic (${existing.length}): ${existing.map((n) => `"${n.title}"`).join('; ')}`);
  } else {
    lines.push('notes already in this topic: none yet');
  }
  lines.push(`knowledge: ${knowledgeLine(topicKnowledge(v, t.id))}`);
  return lines.join('\n');
}

function cell(s: string): string {
  return s.replace(/\|/g, '/');
}

/** Topics shown in the knowledge profile table: the scope topic plus its direct children, or every root plus its children. */
function profileTopics(v: Vault, scopeId?: ID): Topic[] {
  const childrenOf = (parent: ID) =>
    live(v.topics)
      .filter((t) => t.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name));
  if (scopeId) {
    const top = liveTopic(v, scopeId);
    return top ? [top, ...childrenOf(scopeId)] : [];
  }
  return rootTopics(v).flatMap((r) => [r, ...childrenOf(r.id)]);
}

function sectionLines(lines: string[], heading: string, items: string[], limit: number, empty: string): void {
  lines.push('', heading);
  if (!items.length) {
    lines.push(empty);
    return;
  }
  lines.push(...items.slice(0, limit).map((i) => `- ${i}`));
  if (items.length > limit) lines.push(`…and ${items.length - limit} more (raise limit to see them)`);
}

/**
 * What the user knows, for knowledge_profile. scopeId limits everything to that topic and its subtopics.
 * Review streak and reviews-today are always whole-vault (they are about habit, not topics).
 */
export function formatKnowledgeProfile(v: Vault, scopeId: ID | undefined, limit: number, t: number = Date.now()): string {
  const scopeIds = scopeId ? topicSubtree(v, scopeId) : undefined;
  const scopeNotes = live(v.notes).filter((n) => !scopeIds || n.topicIds.some((tid) => scopeIds.has(tid)));
  const noteById = new Map(scopeNotes.map((n) => [n.id, n] as const));
  const summary = summarize(scopeNotes, Object.values(v.cards), t);

  const scopedCards = live(v.cards).filter((c) => noteById.has(c.noteId));
  const scopedCardIds = new Set(scopedCards.map((c) => c.id));
  const scopedVault: Vault = {
    ...v,
    reviews: Object.fromEntries(
      live(v.reviews)
        .filter((r) => !scopeId || scopedCardIds.has(r.cardId))
        .map((r) => [r.id, r] as const),
    ),
  };
  const retention = retentionRate(scopedVault, 30, t);
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const lines: string[] = [];
  lines.push(`Knowledge profile: ${scopeId ? topicPath(v, scopeId) : 'whole vault'}`);
  lines.push(`Mastery: ${summary.mastery}% (${summary.label})`);
  lines.push(`Notes: ${summary.notes} (${summary.notesWithoutCards} without flashcards)`);
  lines.push(
    `Flashcards: ${summary.cards} (new ${summary.newCards}, learning ${summary.learning}, young ${summary.young}, mature ${summary.mature})`,
  );
  lines.push(`Due now: ${summary.due} · Mature: ${summary.mature} · Fading (recall under 80%): ${summary.fading} · Leeches: ${summary.leeches}`);
  lines.push(`Recall right now (reviewed cards): ${summary.recall !== undefined ? pct(summary.recall) : 'no reviewed cards yet'}`);
  lines.push(
    `Retention, last 30 days: ${retention !== undefined ? pct(retention) : 'not enough reviews yet (needs 10 in 30 days)'}`,
  );
  lines.push(`Whole vault: review streak ${reviewStreak(v, t)} day(s), ${reviewsToday(v, t)} review(s) today`);

  lines.push('', '## Topics (mastery includes subtopics)');
  const rows = profileTopics(v, scopeId);
  if (!rows.length) {
    lines.push('(no topics yet)');
  } else {
    lines.push('| Topic | Mastery | Label | Notes | Cards | Fading |', '|---|---|---|---|---|---|');
    for (const topic of rows) {
      const k = topicKnowledge(v, topic.id, t);
      lines.push(`| ${cell(topicPath(v, topic.id))} | ${k.mastery}% | ${k.label} | ${k.notes} | ${k.cards} | ${k.fading} |`);
    }
  }

  // Weakest notes: average mastery of their reviewed cards, lowest first.
  const scored: { n: Note; pct: number; reviewed: number }[] = [];
  for (const n of scopeNotes) {
    const reviewed = cardsOf(v, n.id).filter((c) => !c.suspended && c.srs?.last_review !== undefined);
    if (!reviewed.length) continue;
    const avg = reviewed.reduce((sum, c) => sum + cardMastery(c, t), 0) / reviewed.length;
    scored.push({ n, pct: Math.round(avg * 100), reviewed: reviewed.length });
  }
  scored.sort((a, b) => a.pct - b.pct);
  sectionLines(
    lines,
    `## Weakest notes (lowest mastery of reviewed cards first)`,
    scored.map((s) => `${s.n.title} — mastery ${s.pct}% over ${s.reviewed} reviewed card(s) (id ${s.n.id})`),
    limit,
    '(no reviewed cards yet)',
  );

  const leeches = scopedCards
    .filter(isLeech)
    .sort((a, b) => (b.srs?.lapses ?? 0) - (a.srs?.lapses ?? 0));
  sectionLines(
    lines,
    `## Leech cards (forgotten 4+ times)`,
    leeches.map(
      (c: Card) =>
        `"${c.front}" — note "${noteById.get(c.noteId)?.title ?? '?'}", ${c.srs?.lapses ?? 0} lapses`,
    ),
    limit,
    '(none)',
  );

  const bare = scopeNotes.filter((n) => !cardsOf(v, n.id).some((c) => !c.suspended));
  sectionLines(
    lines,
    `## Notes without flashcards (${bare.length})`,
    bare.map((n) => `${n.title} (id ${n.id})`),
    limit,
    '(every note has flashcards)',
  );

  const missing = missingNotes(v)
    .map((m) => ({ title: m.title, refs: scopeIds ? m.refs.filter((r) => noteById.has(r.id)) : m.refs }))
    .filter((m) => m.refs.length > 0)
    .sort((a, b) => b.refs.length - a.refs.length);
  sectionLines(
    lines,
    `## Missing notes (linked but not written yet)`,
    missing.map((m) => `[[${m.title}]] — linked from ${m.refs.length} note${m.refs.length === 1 ? '' : 's'}`),
    limit,
    '(no dangling links)',
  );

  lines.push(
    '',
    'Use this to tailor explanations to what the user already knows, pick what to quiz (quiz_me prompt), and suggest what to learn next: missing notes, notes without flashcards, and starter packs.',
  );
  return lines.join('\n');
}

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
