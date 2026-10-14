import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Brain, CloudOff, Inbox as InboxIcon, RefreshCw, Settings as SettingsIcon, Shuffle, Sparkles } from 'lucide-react';
import { live, type Note } from '@shared/vault.ts';
import { isDue, useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import NoteItem from '../components/NoteItem.tsx';
import { toast } from '../lib/toast.ts';

function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function SyncIndicator() {
  const sync = useStore((s) => s.sync);
  const syncNow = useStore((s) => s.syncNow);
  const nav = useNavigate();
  if (sync.status === 'disabled') return null;
  const title =
    sync.status === 'error'
      ? `Sync error: ${sync.error}`
      : sync.status === 'offline'
        ? 'Offline — will sync later'
        : sync.lastSync
          ? `Synced ${new Date(sync.lastSync).toLocaleTimeString()}`
          : 'Sync';
  return (
    <button
      className="iconbtn"
      title={title}
      aria-label={title}
      onClick={() => {
        if (sync.status === 'error') nav('/settings');
        else void syncNow().then(() => toast(useStore.getState().sync.status === 'idle' ? 'Synced' : 'Sync failed'));
      }}
      style={{ color: sync.status === 'error' ? 'var(--bad)' : sync.dirty ? 'var(--warn)' : undefined }}
    >
      {sync.status === 'offline' ? <CloudOff size={20} /> : <RefreshCw size={20} className={sync.status === 'syncing' ? 'spin' : ''} />}
    </button>
  );
}

export default function Home() {
  const vault = useStore((s) => s.vault);
  const addInbox = useStore((s) => s.addInbox);
  const [quick, setQuick] = useState('');

  const stats = useMemo(() => {
    const now = Date.now();
    const cards = live(vault.cards);
    const due = cards.filter((c) => isDue(c, now) && c.srs).length;
    const fresh = cards.filter((c) => !c.srs && !c.suspended).length;
    const inbox = live(vault.inbox).filter((i) => i.status === 'new').length;
    const notes = live(vault.notes);
    const pending = notes.filter((n) => (n.tasks?.length ?? 0) > 0);
    const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    const pinned = notes.filter((n) => n.pinned).slice(0, 5);
    const flagged = notes.filter((n) => n.verification && ['false', 'misleading', 'mixed'].includes(n.verification.verdict));
    // streak
    const days = new Set(live(vault.reviews).map((r) => dayKey(r.createdAt)));
    let streak = 0;
    const d = new Date();
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    const reviewedToday = live(vault.reviews).filter((r) => dayKey(r.createdAt) === dayKey(now)).length;
    return { due, fresh, inbox, notes, pending, recent, pinned, flagged, streak, reviewedToday };
  }, [vault]);

  const [randomNote, setRandomNote] = useState<Note | undefined>(() => pickRandom(stats.notes));

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const totalReview = stats.due + Math.min(stats.fresh, useStore.getState().settings.newCardsPerDay);

  return (
    <div className="page">
      <Topbar title={greeting}>
        <SyncIndicator />
        <Link to="/settings" className="iconbtn hide-desktop" aria-label="Settings">
          <SettingsIcon size={20} />
        </Link>
      </Topbar>

      {/* Quick capture */}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!quick.trim()) return;
          const urlMatch = /(https?:\/\/\S+)/.exec(quick);
          addInbox({ text: quick.trim(), url: urlMatch?.[1] });
          setQuick('');
          toast('Saved to inbox');
        }}
      >
        <textarea
          className="textarea"
          rows={2}
          placeholder="Heard something interesting? Jot it down…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          style={{ border: 0, padding: 0, minHeight: 0, boxShadow: 'none', background: 'transparent', resize: 'none' }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <Link to="/capture" className="faint">
            More options
          </Link>
          <span className="grow" />
          <button className="btn primary sm" disabled={!quick.trim()}>
            Save to inbox
          </button>
        </div>
      </form>

      {/* Review hero */}
      <Link to="/review" className="card hero" style={{ display: 'block', marginTop: 12 }}>
        <div className="row">
          <div className="grow">
            <div className="muted" style={{ fontWeight: 600 }}>
              {totalReview > 0 ? 'Ready to review' : 'Review'}
            </div>
            <div className="stat">{totalReview > 0 ? `${totalReview} cards` : 'All caught up ✨'}</div>
            <div className="muted" style={{ fontSize: '0.88rem' }}>
              {stats.streak > 0 ? `🔥 ${stats.streak}-day streak` : 'Start a streak today'} · {stats.reviewedToday} reviewed today
            </div>
          </div>
          <Brain size={44} style={{ opacity: 0.85 }} />
        </div>
      </Link>

      <div className="grid2" style={{ marginTop: 12 }}>
        <Link to="/inbox" className="tile">
          <span className="tile-icon">
            <InboxIcon size={18} />
          </span>
          <span className="stat">{stats.inbox}</span>
          <span className="faint">in inbox</span>
        </Link>
        <Link to="/library?filter=claude" className="tile">
          <span className="tile-icon">
            <Sparkles size={18} />
          </span>
          <span className="stat">{stats.pending.length}</span>
          <span className="faint">waiting on Claude</span>
        </Link>
      </div>

      {stats.notes.length === 0 && <Welcome />}

      {stats.flagged.length > 0 && (
        <div className="section">
          <div className="section-title">
            <BadgeCheck size={14} /> Fact-check flagged
          </div>
          <div className="list">
            {stats.flagged.slice(0, 3).map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}

      {stats.pinned.length > 0 && (
        <div className="section">
          <div className="section-title">Pinned</div>
          <div className="list">
            {stats.pinned.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}

      {randomNote && stats.notes.length > 3 && (
        <div className="section">
          <div className="section-title">
            Rediscover
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setRandomNote(pickRandom(stats.notes, randomNote.id))}>
              <Shuffle size={14} /> Another
            </button>
          </div>
          <div className="list">
            <NoteItem note={vault.notes[randomNote.id] ?? randomNote} />
          </div>
        </div>
      )}

      {stats.recent.length > 0 && (
        <div className="section">
          <div className="section-title">
            Recently edited
            <span className="spacer" />
            <Link to="/library">See all</Link>
          </div>
          <div className="list">
            {stats.recent.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function pickRandom(notes: Note[], exclude?: string): Note | undefined {
  const pool = notes.filter((n) => n.id !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

function Welcome() {
  const nav = useNavigate();
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Welcome to Recall 👋</h2>
      <div className="muted stack" style={{ gap: 8, fontSize: '0.95rem' }}>
        <div>
          <b>1. Capture</b> anything you hear or read — tap <b>+</b>, or share a link/text to Recall from any app.
        </div>
        <div>
          <b>2. Connect</b> ideas with <code>[[links]]</code> and organize them into topics.
        </div>
        <div>
          <b>3. Remember</b> — wrap key facts in <code>==highlights==</code> and they become flashcards on a smart review schedule.
        </div>
        <div>
          <b>4. Verify</b> — tap “Fact-check” on a note and Claude will research it for you.
        </div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn primary"
          onClick={() => {
            const n = useStore.getState().createNote({ title: 'Untitled' });
            nav(`/note/${n.id}?edit=1`);
          }}
        >
          Write first note
        </button>
        <Link to="/settings" className="btn ghost">
          Set up sync
        </Link>
      </div>
    </div>
  );
}
