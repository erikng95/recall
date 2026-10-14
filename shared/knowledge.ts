// What the user knows: mastery derived from flashcard scheduling state (FSRS).
// Shared by the app (Explore, Topic pages) and the MCP server (knowledge_profile).

import { live, normalizeTitle, parseWikilinks, titleIndex, type Card, type ID, type Note, type Topic, type Vault } from './vault.ts';

const DAY = 86_400_000;
// FSRS power forgetting curve: R(t) = (1 + FACTOR * t / S) ^ DECAY, so R(S) = 0.9
const DECAY = -0.5;
const FACTOR = 19 / 81;

/** Probability of recalling the card right now (undefined for never-reviewed cards). */
export function recallProbability(c: Card, now = Date.now()): number | undefined {
  const s = c.srs;
  if (!s || !s.last_review || s.stability <= 0) return undefined;
  const t = Math.max(0, (now - s.last_review) / DAY);
  return Math.pow(1 + (FACTOR * t) / s.stability, DECAY);
}

export type CardStage = 'new' | 'learning' | 'young' | 'mature';

export function cardStage(c: Card): CardStage {
  const s = c.srs;
  if (!s || s.state === 0) return 'new';
  if (s.state === 1 || s.state === 3) return 'learning';
  return s.stability >= 21 ? 'mature' : 'young';
}

/** 0..1: how well, and how durably, a card is known (current recall x durability). */
export function cardMastery(c: Card, now = Date.now()): number {
  const r = recallProbability(c, now);
  if (r === undefined) return 0;
  const durability = Math.min(1, Math.log1p(c.srs!.stability) / Math.log1p(30));
  return r * (0.35 + 0.65 * durability);
}

/** A card the user keeps forgetting. */
export function isLeech(c: Card): boolean {
  return !c.deleted && !c.suspended && (c.srs?.lapses ?? 0) >= 6;
}

export type MasteryLabel = 'Not started' | 'Learning' | 'Getting there' | 'Solid' | 'Mastered';

export function masteryLabel(pct: number, reviewed: number): MasteryLabel {
  if (reviewed === 0) return 'Not started';
  if (pct < 35) return 'Learning';
  if (pct < 65) return 'Getting there';
  if (pct < 85) return 'Solid';
  return 'Mastered';
}

export interface KnowledgeSummary {
  notes: number;
  notesWithoutCards: number;
  cards: number;
  newCards: number;
  learning: number;
  young: number;
  mature: number;
  /** Reviewed cards due now (new cards excluded). */
  due: number;
  leeches: number;
  /** 0..100 average card mastery (new cards count as 0). */
  mastery: number;
  /** Average recall probability of reviewed cards right now, 0..1 (undefined if none reviewed). */
  recall?: number;
  label: MasteryLabel;
  /** Reviewed cards whose recall dropped below 80%. */
  fading: number;
}

export function summarize(notes: Note[], cards: Card[], now = Date.now()): KnowledgeSummary {
  const noteIds = new Set(notes.map((n) => n.id));
  const cs = cards.filter((c) => !c.deleted && !c.suspended && noteIds.has(c.noteId));
  const withCards = new Set(cs.map((c) => c.noteId));
  let mastery = 0;
  let rSum = 0;
  let rN = 0;
  let fading = 0;
  let due = 0;
  const stages: Record<CardStage, number> = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const c of cs) {
    stages[cardStage(c)]++;
    mastery += cardMastery(c, now);
    const r = recallProbability(c, now);
    if (r !== undefined) {
      rSum += r;
      rN++;
      if (r < 0.8) fading++;
    }
    if (c.srs && c.srs.due <= now) due++;
  }
  const pct = cs.length ? Math.round((mastery / cs.length) * 100) : 0;
  return {
    notes: notes.length,
    notesWithoutCards: notes.filter((n) => !withCards.has(n.id)).length,
    cards: cs.length,
    newCards: stages.new,
    learning: stages.learning,
    young: stages.young,
    mature: stages.mature,
    due,
    leeches: cs.filter(isLeech).length,
    mastery: pct,
    recall: rN ? rSum / rN : undefined,
    label: masteryLabel(pct, rN),
    fading,
  };
}

/** Topic id plus all its descendants. */
export function topicSubtree(v: Vault, id: ID): Set<ID> {
  const out = new Set<ID>([id]);
  const topics = live(v.topics);
  let grew = true;
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

export function topicKnowledge(v: Vault, topicId: ID, now = Date.now()): KnowledgeSummary {
  const ids = topicSubtree(v, topicId);
  const notes = live(v.notes).filter((n) => n.topicIds.some((t) => ids.has(t)));
  return summarize(notes, Object.values(v.cards), now);
}

export function vaultKnowledge(v: Vault, now = Date.now()): KnowledgeSummary {
  return summarize(live(v.notes), Object.values(v.cards), now);
}

export function rootTopics(v: Vault): Topic[] {
  return live(v.topics)
    .filter((t) => !t.parentId || !v.topics[t.parentId] || v.topics[t.parentId].deleted)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** [[Links]] pointing at notes that don't exist yet, most-referenced first. */
export function missingNotes(v: Vault): { title: string; refs: Note[] }[] {
  const idx = titleIndex(v);
  const map = new Map<string, { title: string; refs: Note[] }>();
  for (const n of live(v.notes)) {
    for (const l of parseWikilinks(n.body)) {
      const key = normalizeTitle(l.target);
      if (idx.has(key)) continue;
      const e = map.get(key) ?? { title: l.target, refs: [] };
      if (!e.refs.includes(n)) e.refs.push(n);
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => b.refs.length - a.refs.length);
}

function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Review counts per local day for the last `days` days (oldest first). */
export function reviewHistory(v: Vault, days = 14, now = Date.now()): { date: Date; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of live(v.reviews)) counts.set(dayKey(r.createdAt), (counts.get(dayKey(r.createdAt)) ?? 0) + 1);
  const out: { date: Date; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push({ date: d, count: counts.get(dayKey(d.getTime())) ?? 0 });
  }
  return out;
}

/** Consecutive days with at least one review, ending today (or yesterday). */
export function reviewStreak(v: Vault, now = Date.now()): number {
  const days = new Set(live(v.reviews).map((r) => dayKey(r.createdAt)));
  const d = new Date(now);
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function reviewsToday(v: Vault, now = Date.now()): number {
  const k = dayKey(now);
  return live(v.reviews).filter((r) => dayKey(r.createdAt) === k).length;
}

/** Share of reviews in the last `days` days that were not "Again" (true retention). */
export function retentionRate(v: Vault, days = 30, now = Date.now()): number | undefined {
  const since = now - days * DAY;
  const rs = live(v.reviews).filter((r) => r.createdAt >= since);
  if (rs.length < 10) return undefined;
  return rs.filter((r) => r.rating > 1).length / rs.length;
}
