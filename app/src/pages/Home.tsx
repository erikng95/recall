import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CloudOff, Compass, Flame, Inbox as InboxIcon, PenLine, RefreshCw, Settings as SettingsIcon, Shuffle, Sparkles } from 'lucide-react';
import { live, type Note } from '@shared/vault.ts';
import { reviewStreak, reviewsToday, rootTopics, topicKnowledge } from '@shared/knowledge.ts';
import { isDue, useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import NoteItem from '../components/NoteItem.tsx';
import { Meter, Ring } from '../components/Knowledge.tsx';
import { formatInterval } from '../lib/srs.ts';
import { toast } from '../lib/toast.ts';

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
      {sync.status === 'offline' ? <CloudOff size={20} /> : <RefreshCw size={19} className={sync.status === 'syncing' ? 'spin' : ''} />}
    </button>
  );
}

export default function Home() {
  const vault = useStore((s) => s.vault);
  const settings = useStore((s) => s.settings);
  const addInbox = useStore((s) => s.addInbox);
  const [quick, setQuick] = useState('');

  const d = useMemo(() => {
    const now = Date.now();
    const cards = live(vault.cards).filter((c) => !c.suspended);
    const due = cards.filter((c) => c.srs && isDue(c, now)).length;
    const fresh = cards.filter((c) => !c.srs).length;
    const nextDue = cards.filter((c) => c.srs && c.srs.due > now).sort((a, b) => a.srs!.due - b.srs!.due)[0]?.srs?.due;
    const notes = live(vault.notes);
    return {
      due,
      ready: due + Math.min(fresh, settings.newCardsPerDay),
      nextDue,
      inbox: live(vault.inbox).filter((i) => i.status === 'new').length,
      claude: notes.filter((n) => (n.tasks?.length ?? 0) > 0).length + live(vault.topics).filter((t) => (t.tasks?.length ?? 0) > 0).length,
      notes,
      recent: [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
      pinned: notes.filter((n) => n.pinned).slice(0, 4),
      flagged: notes.filter((n) => n.verification && ['false', 'misleading'].includes(n.verification.verdict)).slice(0, 3),
      streak: reviewStreak(vault, now),
      today: reviewsToday(vault, now),
      topics: rootTopics(vault)
        .map((t) => ({ t, k: topicKnowledge(vault, t.id, now) }))
        .filter((x) => x.k.cards > 0)
        .sort((a, b) => b.k.due - a.k.due || a.k.mastery - b.k.mastery)
        .slice(0, 3),
    };
  }, [vault, settings.newCardsPerDay]);

  const [randomNote, setRandomNote] = useState<Note | undefined>(() => pickRandom(d.notes));
  const goal = Math.max(1, settings.dailyGoal);
  const goalPct = Math.min(100, (d.today / goal) * 100);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (d.notes.length === 0 && d.inbox === 0) return <Welcome />;

  return (
    <div className="page">
      <Topbar
        title={
          <>
            <span className="eyebrow">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
            {greeting}
          </>
        }
      >
        <SyncIndicator />
        <Link to="/settings" className="iconbtn hide-desktop" aria-label="Settings">
          <SettingsIcon size={20} />
        </Link>
      </Topbar>

      {/* Daily review */}
      <div className="card hero row" style={{ gap: 16, padding: 'var(--space-l) var(--space-m)' }}>
        <Ring pct={goalPct} size={76}>
          <span className="num" style={{ color: 'white' }}>
            {d.today}
            <span style={{ opacity: 0.7, fontWeight: 600 }}>/{goal}</span>
          </span>
        </Ring>
        <div className="grow">
          <div className="muted" style={{ fontSize: 'var(--step--1)', fontWeight: 600 }}>
            {d.streak > 0 ? (
              <>
                <Flame size={13} style={{ verticalAlign: '-2px' }} /> {d.streak}-day streak
              </>
            ) : (
              'Daily review'
            )}
          </div>
          <div style={{ fontSize: 'var(--step-2)', fontWeight: 750, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {d.ready > 0 ? `${d.ready} cards ready` : 'All caught up'}
          </div>
          {d.ready > 0 ? (
            <Link to="/review" className="btn light sm" style={{ marginBlockStart: 10 }}>
              Start review <ArrowRight size={15} />
            </Link>
          ) : (
            d.nextDue && <div className="muted" style={{ fontSize: 'var(--step--1)' }}>Next in {formatInterval(d.nextDue - Date.now())}</div>
          )}
        </div>
      </div>

      {/* Quick capture */}
      <form
        className="card"
        style={{ marginBlockStart: 'var(--space-s)', padding: 'var(--space-s) var(--space-s) var(--space-s) var(--space-m)' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!quick.trim()) return;
          const urlMatch = /(https?:\/\/\S+)/.exec(quick);
          addInbox({ text: quick.trim(), url: urlMatch?.[1] });
          setQuick('');
          toast('Saved to inbox');
        }}
      >
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <textarea
            className="grow"
            rows={1}
            placeholder="Jot down something you learned…"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            style={{ border: 0, outline: 'none', background: 'transparent', resize: 'none', fieldSizing: 'content', maxHeight: '8lh', padding: '10px 0', lineHeight: 1.5 } as React.CSSProperties}
          />
          <button className="btn primary sm" disabled={!quick.trim()} aria-label="Save to inbox">
            Save
          </button>
        </div>
      </form>

      <div className="tiles" style={{ marginBlockStart: 'var(--space-s)', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Link to="/inbox" className="tile">
          <span className="tile-icon">
            <InboxIcon size={17} />
          </span>
          <span className="stat">{d.inbox}</span>
          <span className="faint">Inbox</span>
        </Link>
        <Link to="/library?filter=claude" className="tile">
          <span className="tile-icon">
            <Sparkles size={17} />
          </span>
          <span className="stat">{d.claude}</span>
          <span className="faint">For Claude</span>
        </Link>
        <Link to="/explore" className="tile">
          <span className="tile-icon">
            <Compass size={17} />
          </span>
          <span className="stat">{d.notes.length}</span>
          <span className="faint">Notes</span>
        </Link>
      </div>

      {d.topics.length > 0 && (
        <div className="section">
          <div className="section-title">
            Keep learning
            <span className="spacer" />
            <Link to="/explore">Explore</Link>
          </div>
          <div className="list">
            {d.topics.map(({ t, k }) => (
              <Link key={t.id} to={k.due > 0 ? `/review?topic=${t.id}` : `/topic/${t.id}`} className="listitem">
                <span className="emoji">{t.emoji || '📁'}</span>
                <span className="grow">
                  <div className="row">
                    <span className="title grow">{t.name}</span>
                    <span className="faint num">{k.due > 0 ? `${k.due} due` : `${k.mastery}%`}</span>
                  </div>
                  <div style={{ marginBlockStart: 8 }}>
                    <Meter pct={k.mastery} tone={k.mastery >= 65 ? 'good' : undefined} />
                  </div>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {d.flagged.length > 0 && (
        <div className="section">
          <div className="section-title">Corrected by fact-check</div>
          <div className="list">
            {d.flagged.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}

      {d.pinned.length > 0 && (
        <div className="section">
          <div className="section-title">Pinned</div>
          <div className="list">
            {d.pinned.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}

      {d.recent.length > 0 && (
        <div className="section">
          <div className="section-title">
            Recent
            <span className="spacer" />
            <Link to="/library">All notes</Link>
          </div>
          <div className="list">
            {d.recent.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}

      {randomNote && d.notes.length > 5 && vault.notes[randomNote.id] && !vault.notes[randomNote.id].deleted && (
        <div className="section">
          <div className="section-title">
            Rediscover
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setRandomNote(pickRandom(d.notes, randomNote.id))} aria-label="Another note">
              <Shuffle size={14} />
            </button>
          </div>
          <div className="list">
            <NoteItem note={vault.notes[randomNote.id]} />
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
    <div className="page">
      <Topbar>
        <Link to="/settings" className="iconbtn hide-desktop" aria-label="Settings">
          <SettingsIcon size={20} />
        </Link>
      </Topbar>
      <div style={{ textAlign: 'center', paddingBlock: 'var(--space-xl) var(--space-l)' }}>
        <img src="./pwa-192.png" alt="" width={72} height={72} style={{ margin: '0 auto 18px', borderRadius: 18 }} />
        <h1 style={{ fontSize: 'var(--step-3)', fontWeight: 760 }}>Remember what you learn</h1>
        <p className="muted" style={{ maxWidth: '30ch', margin: '10px auto 0' }}>
          Capture ideas, link them, check they're true, and review them before you forget.
        </p>
      </div>
      <div className="stack" style={{ maxWidth: 380, marginInline: 'auto' }}>
        <button
          className="btn primary block"
          onClick={() => {
            const n = useStore.getState().createNote({ title: 'Untitled' });
            nav(`/note/${n.id}?edit=1`);
          }}
        >
          <PenLine size={18} /> Write your first note
        </button>
        <Link to="/explore" className="btn block">
          <Compass size={18} /> Explore topics
        </Link>
      </div>
    </div>
  );
}
