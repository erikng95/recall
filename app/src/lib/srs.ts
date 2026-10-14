import { createEmptyCard, fsrs, generatorParameters, Rating, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { SrsState } from '@shared/vault.ts';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));

export function toFsrs(s: SrsState | undefined, now = new Date()): FsrsCard {
  if (!s) return createEmptyCard(now);
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps ?? 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function fromFsrs(c: FsrsCard): SrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : undefined,
  };
}

export type RatingValue = 1 | 2 | 3 | 4;

export const RATINGS: { value: RatingValue; label: string; key: string }[] = [
  { value: 1, label: 'Again', key: '1' },
  { value: 2, label: 'Hard', key: '2' },
  { value: 3, label: 'Good', key: '3' },
  { value: 4, label: 'Easy', key: '4' },
];

/** Compute the next state for each rating, plus a human interval label. */
export function previewRatings(s: SrsState | undefined, now = new Date()) {
  const card = toFsrs(s, now);
  const out = {} as Record<RatingValue, { srs: SrsState; label: string }>;
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    const next = scheduler.next(card, now, r).card;
    out[r as RatingValue] = { srs: fromFsrs(next), label: formatInterval(next.due.getTime() - now.getTime()) };
  }
  return out;
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/** Estimated probability you'd still recall the card right now. */
export function retrievability(s: SrsState | undefined, now = new Date()): number | undefined {
  if (!s || s.state === 0) return undefined;
  return scheduler.get_retrievability(toFsrs(s), now, false) as number;
}
