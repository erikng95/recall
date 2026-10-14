import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isLeech } from '@shared/knowledge.ts';
import { Brain, Eye, Flame, Layers, ShieldAlert, Shuffle, Sparkles, Trophy, X } from 'lucide-react';
import { live, type Card, type ID, type Topic, type Vault } from '@shared/vault.ts';
import Markdown from '../components/Markdown.tsx';
import Topbar from '../components/Topbar.tsx';
import VerdictBadge from '../components/VerdictBadge.tsx';
import { RATINGS, formatInterval, previewRatings, type RatingValue } from '../lib/srs.ts';
import { topicPath, topicWithDescendants, useStore } from '../store.ts';
import './review.css';

const LEARN_WINDOW_MS = 15 * 60 * 1000; // cards due sooner than this are re-queued in-session
const CRAM_SIZE = 20;
const MATURE_DAYS = 21;
const RATING_TONE: Record<RatingValue, string> = { 1: 'tone-bad', 2: 'tone-warn', 3: 'tone-good', 4: 'rv-easy' };

type Mode = 'review' | 'cram';

interface Answer {
  cardId: ID;
  rating: RatingValue;
}

interface Session {
  mode: Mode;
  queue: ID[]; // snapshot taken at start; learning-step cards are appended
  pos: number;
  revealed: boolean;
  answers: Answer[];
  startedAt: number;
  finishedAt: number | null;
}

interface Snapshot {
  activeTopic: string; // '' = all topics
  totalCards: number;
  mature: number;
  reviewsToday: number;
  streak: number;
  newLeft: number; // remaining daily allowance of new cards
  unseenNew: number; // new cards waiting, before the daily cap
  scoped: Card[]; // live, unsuspended cards within the topic filter
  due: Card[]; // sorted by due date, oldest first
  fresh: Card[]; // new cards within the allowance, oldest first
  nextDue?: number;
  topicChips: Topic[];
}

// ---------- Helpers ----------

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayBefore(dayStart: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() - 1);
  return startOfDay(d.getTime());
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A card is usable if it and its note are both live. */
function isLiveCard(v: Vault, c: Card): boolean {
  if (c.deleted) return false;
  const note = v.notes[c.noteId];
  return note !== undefined && !note.deleted;
}

function playable(v: Vault, id: ID): boolean {
  const c = v.cards[id];
  return c !== undefined && isLiveCard(v, c);
}

/** Skip forward past cards that no longer exist; finish the session when the queue runs out. */
function settle(s: Session, v: Vault): Session {
  let pos = s.pos;
  while (pos < s.queue.length && !playable(v, s.queue[pos])) pos++;
  if (pos >= s.queue.length) return { ...s, pos, revealed: false, finishedAt: s.finishedAt ?? Date.now() };
  if (pos === s.pos) return s;
  return { ...s, pos, revealed: false };
}

/**
 * Interleaving: mix topics (and avoid two cards from the same note in a row)
 * instead of reviewing one topic in a block — this strengthens retention.
 * Round-robin across groups keyed by the note's first topic, keeping order within a group.
 */
function interleave(cards: Card[], v: Vault): Card[] {
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const key = v.notes[c.noteId]?.topicIds[0] ?? `note:${c.noteId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const lists = [...groups.values()];
  const out: Card[] = [];
  let i = 0;
  while (out.length < cards.length) {
    const list = lists[i % lists.length];
    if (list.length) {
      // prefer a card from a different note than the previous one
      const prev = out[out.length - 1];
      const idx = prev ? Math.max(0, list.findIndex((c) => c.noteId !== prev.noteId)) : 0;
      out.push(list.splice(idx, 1)[0]);
    }
    i++;
  }
  return out;
}

function buildSnapshot(v: Vault, now: number, topicParam: string, newPerDay: number): Snapshot {
  const activeTopic = topicParam && v.topics[topicParam] && !v.topics[topicParam].deleted ? topicParam : '';
  const topicSet = activeTopic ? topicWithDescendants(v, activeTopic) : null;

  const liveCards = live(v.cards).filter((c) => isLiveCard(v, c));

  const scoped: Card[] = [];
  for (const c of liveCards) {
    if (c.suspended) continue;
    if (topicSet && !v.notes[c.noteId].topicIds.some((t) => topicSet.has(t))) continue;
    scoped.push(c);
  }

  // Review log bookkeeping: reviews today, streak, and when each card was first introduced.
  const todayStart = startOfDay(now);
  const reviewDays = new Set<number>();
  const firstSeen = new Map<ID, number>();
  let reviewsToday = 0;
  for (const r of live(v.reviews)) {
    const day = startOfDay(r.createdAt);
    reviewDays.add(day);
    if (day === todayStart) reviewsToday++;
    const prev = firstSeen.get(r.cardId);
    if (prev === undefined || r.createdAt < prev) firstSeen.set(r.cardId, r.createdAt);
  }
  let introducedToday = 0;
  for (const t of firstSeen.values()) if (t >= todayStart) introducedToday++;

  let streak = 0;
  let cursor = todayStart;
  if (!reviewDays.has(cursor)) cursor = dayBefore(cursor);
  while (reviewDays.has(cursor)) {
    streak++;
    cursor = dayBefore(cursor);
  }

  let mature = 0;
  for (const c of liveCards) if ((c.srs?.scheduled_days ?? 0) >= MATURE_DAYS) mature++;

  // Queue building.
  const newLeft = Math.max(0, newPerDay - introducedToday);
  const due: Card[] = [];
  const unseen: Card[] = [];
  let nextDue: number | undefined;
  for (const c of scoped) {
    if (c.srs) {
      if (c.srs.due <= now) due.push(c);
      else if (nextDue === undefined || c.srs.due < nextDue) nextDue = c.srs.due;
    } else {
      unseen.push(c);
    }
  }
  due.sort((a, b) => (a.srs?.due ?? 0) - (b.srs?.due ?? 0));
  unseen.sort((a, b) => a.createdAt - b.createdAt);
  const fresh = interleave(unseen.slice(0, newLeft), v);
  const dueMixed = interleave(due, v);

  // Topics that have cards, plus their ancestors (filtering a parent includes its children).
  const withCards = new Set<ID>();
  for (const c of liveCards) {
    for (const t of v.notes[c.noteId].topicIds) {
      let cur: ID | undefined = t;
      let guard = 0;
      while (cur && !withCards.has(cur) && guard++ < 20) {
        withCards.add(cur);
        cur = v.topics[cur]?.parentId;
      }
    }
  }
  const topicChips = live(v.topics)
    .filter((t) => withCards.has(t.id))
    .sort((a, b) => topicPath(v, a.id).localeCompare(topicPath(v, b.id)));

  return {
    activeTopic,
    totalCards: liveCards.length,
    mature,
    reviewsToday,
    streak,
    newLeft,
    unseenNew: unseen.length,
    scoped,
    due: dueMixed,
    fresh,
    nextDue,
    topicChips,
  };
}

function caughtUpReason(snap: Snapshot, newPerDay: number): string {
  if (snap.totalCards === 0) return 'No flashcards yet. Highlight ==text== in a note, or add a card, to get started.';
  if (snap.scoped.length === 0) return 'No active cards in this topic.';
  if (snap.unseenNew > 0 && snap.newLeft === 0) return `You have reached today's limit of ${newPerDay} new cards.`;
  return 'Nothing is due right now.';
}

// ---------- Page ----------

export default function Review() {
  const vault = useStore((s) => s.vault);
  const newPerDay = useStore((s) => s.settings.newCardsPerDay);
  const [params, setParams] = useSearchParams();
  const topicParam = params.get('topic') ?? '';
  const noteParam = params.get('note') ?? '';
  const typeAnswers = useStore((s) => s.settings.typeAnswers);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const snap = useMemo(
    () => buildSnapshot(vault, now, topicParam, newPerDay),
    [vault, now, topicParam, newPerDay],
  );

  // The session lives in state plus a ref, so key handlers always see the latest value.
  const [session, setSession] = useState<Session | null>(null);
  const sRef = useRef<Session | null>(null);
  const commit = useCallback((next: Session | null) => {
    sRef.current = next;
    setSession(next);
  }, []);

  const begin = useCallback(
    (mode: Mode, queue: ID[]) => {
      commit(
        settle(
          { mode, queue, pos: 0, revealed: false, answers: [], startedAt: Date.now(), finishedAt: null },
          useStore.getState().vault,
        ),
      );
    },
    [commit],
  );

  const setTopic = (id: string) => setParams(id ? { topic: id } : {}, { replace: true });

  // Practice one note (e.g. right after learning it): due/new cards are scheduled
  // normally; if none are due, run them as practice without touching the schedule.
  const startedForNote = useRef('');
  useEffect(() => {
    if (!noteParam || startedForNote.current === noteParam) return;
    startedForNote.current = noteParam;
    const v = useStore.getState().vault;
    const cards = live(v.cards).filter((c) => c.noteId === noteParam && !c.suspended && isLiveCard(v, c));
    if (!cards.length) return;
    const t = Date.now();
    const ready = cards.filter((c) => !c.srs || c.srs.due <= t);
    if (ready.length) begin('review', ready.map((c) => c.id));
    else begin('cram', shuffle(cards).map((c) => c.id));
  }, [noteParam, begin]);
  const startReview = () => begin('review', [...snap.due, ...snap.fresh].map((c) => c.id));
  const startCram = () => begin('cram', shuffle(snap.scoped).slice(0, CRAM_SIZE).map((c) => c.id));
  const exit = () => commit(null);

  const reveal = useCallback(() => {
    const s = sRef.current;
    if (!s || s.finishedAt !== null || s.revealed) return;
    commit({ ...s, revealed: true });
  }, [commit]);

  const rate = useCallback(
    (r: RatingValue) => {
      const s = sRef.current;
      if (!s || s.finishedAt !== null || !s.revealed) return;
      const store = useStore.getState();
      const id = s.queue[s.pos];
      if (!playable(store.vault, id)) {
        commit(settle(s, store.vault));
        return;
      }
      let queue = s.queue;
      if (s.mode === 'review') {
        const card = store.vault.cards[id];
        const next = previewRatings(card.srs)[r].srs;
        store.recordReview(id, r, next);
        if (next.due - Date.now() <= LEARN_WINDOW_MS) queue = [...queue, id];
      } else if (r === 1) {
        // Practice mode: "Again" brings the card back later in the same run. Nothing is recorded.
        queue = [...queue, id];
      }
      const answers = [...s.answers, { cardId: id, rating: r }];
      commit(settle({ ...s, queue, answers, pos: s.pos + 1, revealed: false }, useStore.getState().vault));
    },
    [commit],
  );

  // Skip cards that were deleted mid-session.
  useEffect(() => {
    const s = sRef.current;
    if (!s || s.finishedAt !== null) return;
    const next = settle(s, vault);
    if (next !== s) commit(next);
  }, [vault, commit]);

  // Start each new card at the top of the page.
  const pos = session?.pos;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pos]);

  // Keyboard: Space/Enter reveal, 1-4 rate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = sRef.current;
      if (!s || s.finishedAt !== null || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || t.closest('input, textarea, select'))) return;
      if (e.key === ' ' || e.key === 'Enter') {
        if (t && t.closest('button, a')) return; // native activation handles focused controls
        e.preventDefault();
        reveal();
      } else if (s.revealed && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
        e.preventDefault();
        rate(Number(e.key) as RatingValue);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, rate]);

  const inSession = session !== null && session.finishedAt === null;
  const showSummary = session !== null && session.finishedAt !== null;
  const card = inSession && session ? vault.cards[session.queue[session.pos]] : undefined;

  return (
    <div className="page">
      <Topbar title="Review">
        {inSession && (
          <button type="button" className="iconbtn" aria-label="End session" title="End session" onClick={exit}>
            <X size={22} />
          </button>
        )}
      </Topbar>

      {!session && (
        <StartView
          snap={snap}
          now={now}
          newPerDay={newPerDay}
          onTopic={setTopic}
          onStart={startReview}
          onCram={startCram}
        />
      )}

      {showSummary && session && <Summary session={session} onDone={exit} />}

      {inSession && session && card && (
        <SessionView key={session.pos} session={session} card={card} vault={vault} typeAnswers={typeAnswers} onReveal={reveal} onRate={rate} />
      )}
    </div>
  );
}

// ---------- Start screen ----------

function StartView({
  snap,
  now,
  newPerDay,
  onTopic,
  onStart,
  onCram,
}: {
  snap: Snapshot;
  now: number;
  newPerDay: number;
  onTopic: (id: string) => void;
  onStart: () => void;
  onCram: () => void;
}) {
  const queueLen = snap.due.length + snap.fresh.length;
  return (
    <>
      {snap.topicChips.length > 0 && (
        <div className="chips scroll rv-chips" role="group" aria-label="Filter by topic">
          <button
            type="button"
            className={`chip ${snap.activeTopic === '' ? 'on' : ''}`}
            aria-pressed={snap.activeTopic === ''}
            onClick={() => onTopic('')}
          >
            All
          </button>
          {snap.topicChips.map((t) => {
            const on = snap.activeTopic === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => onTopic(t.id)}
              >
                {t.emoji ? `${t.emoji} ` : ''}
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {queueLen > 0 ? (
        <section className="card hero rv-hero">
          <div className="rv-hero-label">Ready to review</div>
          <div className="rv-hero-nums">
            <div>
              <div className="stat">{snap.due.length}</div>
              <div className="rv-hero-sub">due</div>
            </div>
            <div>
              <div className="stat">{snap.fresh.length}</div>
              <div className="rv-hero-sub">new</div>
            </div>
          </div>
          <button type="button" className="btn rv-start" onClick={onStart}>
            <Brain size={18} /> Start review
          </button>
        </section>
      ) : (
        <section className="card rv-caught">
          <div className="rv-caught-icon">
            <Trophy size={26} />
          </div>
          <h2>All caught up</h2>
          <p className="muted">{caughtUpReason(snap, newPerDay)}</p>
          {snap.nextDue !== undefined && <p className="faint">Next card due in {formatInterval(snap.nextDue - now)}</p>}
          {snap.scoped.length > 0 && (
            <>
              <button type="button" className="btn block" onClick={onCram}>
                <Shuffle size={18} /> Practice anyway
              </button>
              <p className="faint">Up to {CRAM_SIZE} random cards. Nothing is recorded or rescheduled.</p>
            </>
          )}
        </section>
      )}

      <div className="section-title">Progress</div>
      <div className="grid2 rv-tiles">
        <Tile icon={<Eye size={18} />} value={snap.reviewsToday} label="Reviews today" />
        <Tile icon={<Flame size={18} />} value={snap.streak} label="Day streak" />
        <Tile icon={<Layers size={18} />} value={snap.totalCards} label="Total cards" />
        <Tile icon={<Sparkles size={18} />} value={snap.mature} label="Mature cards" />
      </div>
    </>
  );
}

function Tile({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="tile">
      <div className="tile-icon">{icon}</div>
      <div className="stat">{value}</div>
      <div className="faint">{label}</div>
    </div>
  );
}

// ---------- Session ----------

function SessionView({
  session,
  card,
  vault,
  typeAnswers,
  onReveal,
  onRate,
}: {
  session: Session;
  card: Card;
  vault: Vault;
  typeAnswers: boolean;
  onReveal: () => void;
  onRate: (r: RatingValue) => void;
}) {
  const [typed, setTyped] = useState('');
  const note = vault.notes[card.noteId];
  const cram = session.mode === 'cram';
  const paths = note.topicIds
    .map((id) => vault.topics[id])
    .filter((t): t is Topic => !!t && !t.deleted)
    .map((t) => topicPath(vault, t.id));
  const verdict = note.verification?.verdict;
  const flagged = verdict === 'false' || verdict === 'misleading' || verdict === 'mixed';
  const preview = session.revealed && !cram ? previewRatings(card.srs) : null;
  const left = session.queue.length - session.pos;
  const pct = (session.pos / session.queue.length) * 100;

  return (
    <div className="rv-session">
      <div className="rv-progress">
        <div className="rv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="faint">{left} left</span>
      </div>

      {cram && (
        <div className="rv-cram">
          <Shuffle size={14} /> Practice · not scheduled
        </div>
      )}

      <div className="rv-meta">
        <Link to={`/note/${note.id}`} className="rv-note">
          {note.title}
        </Link>
        {paths.length > 0 && <div className="faint">{paths.join(' · ')}</div>}
      </div>

      {flagged && note.verification && (
        <div className="rv-warn" role="note">
          <ShieldAlert size={18} />
          <div className="rv-warn-text">
            Fact-check: <VerdictBadge v={note.verification} small />
          </div>
        </div>
      )}

      <article
        className={`card rv-card${session.revealed ? '' : ' tap'}`}
        onClick={(e) => {
          if (session.revealed) return;
          if ((e.target as HTMLElement).closest('a, button')) return;
          onReveal();
        }}
      >
        <Markdown source={card.front} className="rv-md" />
        {session.revealed && (
          <>
            <hr className="sep" />
            {typeAnswers && typed.trim() && (
              <p className="rv-typed">
                <span className="faint">You wrote</span> {typed.trim()}
              </p>
            )}
            <Markdown source={card.back} className="rv-md" />
          </>
        )}
      </article>


      {isLeech(card) && session.revealed && (
        <Link to={`/note/${note.id}`} className="rv-leech faint">
          Forgotten {card.srs?.lapses}× — try rewriting this card or splitting it up
        </Link>
      )}

      <div className="rv-dock">
        <div className="rv-dock-inner">
          {session.revealed ? (
            <div className="rv-ratings">
              {RATINGS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`btn rv-rate ${RATING_TONE[r.value]}`}
                  title={`${r.label} (${r.key})`}
                  onClick={() => onRate(r.value)}
                >
                  <span className="rv-rate-name">{r.label}</span>
                  {preview && <span className="rv-rate-ival">{preview[r.value].label}</span>}
                </button>
              ))}
            </div>
          ) : (
            <>
              {typeAnswers && (
                <textarea
                  className="textarea rv-answer"
                  rows={1}
                  placeholder="Type your answer…"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                      onReveal();
                    }
                  }}
                />
              )}
            <button type="button" className="btn primary rv-show" onClick={onReveal}>
              Show answer <span className="kbd hide-mobile">Space</span>
            </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Summary ----------

function Summary({ session, onDone }: { session: Session; onDone: () => void }) {
  const answers = session.answers;
  const cards = new Set(answers.map((a) => a.cardId)).size;
  const again = answers.filter((a) => a.rating === 1).length;
  const pctAgain = answers.length > 0 ? Math.round((again / answers.length) * 100) : 0;
  const elapsed = (session.finishedAt ?? session.startedAt) - session.startedAt;
  const cram = session.mode === 'cram';

  return (
    <section className="card hero rv-summary">
      <div className="rv-caught-icon">
        <Trophy size={26} />
      </div>
      <h2>{cram ? 'Practice complete' : 'Session complete'}</h2>
      <p className="rv-hero-sub">{cram ? 'Nothing was recorded.' : 'Your schedule has been updated.'}</p>
      <div className="rv-sum">
        <div>
          <div className="stat">{cards}</div>
          <div className="rv-sum-label">Cards reviewed</div>
        </div>
        <div>
          <div className="stat">{pctAgain}%</div>
          <div className="rv-sum-label">Again</div>
        </div>
        <div>
          <div className="stat">{formatDuration(elapsed)}</div>
          <div className="rv-sum-label">Time spent</div>
        </div>
      </div>
      <button type="button" className="btn rv-done" onClick={onDone}>
        Done
      </button>
    </section>
  );
}
