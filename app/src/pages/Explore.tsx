import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Brain, ChevronRight, FilePlus2, Layers, Network, Sparkles, TrendingDown, X } from 'lucide-react';
import { live, type Level, type Topic, type Vault } from '@shared/vault.ts';
import { isLeech, missingNotes, rootTopics, topicKnowledge, vaultKnowledge, type KnowledgeSummary } from '@shared/knowledge.ts';
import { findTopicByPath, topicPath, useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import Sheet from '../components/Sheet.tsx';
import { MasteryPill, Meter, Ring } from '../components/Knowledge.tsx';
import { CATALOGUE, POPULAR_TOPICS, type CatalogueTopic } from '../lib/catalogue.ts';
import { toast } from '../lib/toast.ts';

const LEVELS: { id: Level; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

export default function Explore() {
  const vault = useStore((s) => s.vault);
  const [pick, setPick] = useState<CatalogueTopic | { custom: string } | null>(null);
  const [custom, setCustom] = useState('');
  const [category, setCategory] = useState(CATALOGUE[0].id);
  const [leechesOpen, setLeechesOpen] = useState(false);

  const overall = useMemo(() => vaultKnowledge(vault), [vault]);
  const topics = useMemo(
    () =>
      rootTopics(vault)
        .map((t) => ({ topic: t, k: topicKnowledge(vault, t.id) }))
        .filter((x) => x.k.notes > 0)
        .sort((a, b) => b.k.cards - a.k.cards || b.k.notes - a.k.notes),
    [vault],
  );
  const queued = useMemo(() => live(vault.topics).filter((t) => (t.tasks ?? []).includes('explore')), [vault]);
  const suggestions = useSuggestions(vault, overall, topics);
  const cat = CATALOGUE.find((c) => c.id === category) ?? CATALOGUE[0];

  return (
    <div className="page">
      <Topbar title="Explore">
        <Link to="/graph" className="iconbtn" aria-label="Knowledge graph">
          <Network size={20} />
        </Link>
      </Topbar>

      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim()) setPick({ custom: custom.trim() });
        }}
      >
        <Sparkles size={18} />
        <input className="input" placeholder="What do you want to learn?" value={custom} onChange={(e) => setCustom(e.target.value)} enterKeyHint="go" />
      </form>

      {overall.notes > 0 && (
        <div className="section">
          <div className="card row" style={{ gap: 16 }}>
            <Ring pct={overall.mastery} size={72} />
            <div className="grow">
              <div style={{ fontWeight: 700 }}>Knowledge</div>
              <div className="faint num">
                {overall.notes} notes · {overall.cards} cards · {overall.mature} long-term
                {overall.recall !== undefined && ` · ${Math.round(overall.recall * 100)}% recall`}
              </div>
              <div style={{ marginBlockStart: 6 }}>
                <MasteryPill label={overall.label} />
              </div>
            </div>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="section">
          <div className="section-title">Next steps</div>
          <div className="list">
            {suggestions.slice(0, 5).map((s) =>
              s.to ? (
                <Link key={s.key} to={s.to} className="listitem">
                  <span className="emoji" style={{ color: s.color ?? 'var(--accent)' }}>
                    {s.icon}
                  </span>
                  <span className="grow">
                    <div className="title">{s.title}</div>
                    <div className="faint">{s.sub}</div>
                  </span>
                  <ChevronRight size={18} className="chev" />
                </Link>
              ) : (
                <button key={s.key} className="listitem" onClick={s.key === 'leech' ? () => setLeechesOpen(true) : s.onClick}>
                  <span className="emoji" style={{ color: s.color ?? 'var(--accent)' }}>
                    {s.icon}
                  </span>
                  <span className="grow">
                    <div className="title">{s.title}</div>
                    <div className="faint">{s.sub}</div>
                  </span>
                  <ChevronRight size={18} className="chev" />
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {topics.length > 0 && (
        <div className="section">
          <div className="section-title">Your topics</div>
          <div className="list">
            {topics.map(({ topic, k }) => (
              <Link key={topic.id} to={`/topic/${topic.id}`} className="listitem">
                <span className="emoji">{topic.emoji || '📁'}</span>
                <span className="grow">
                  <div className="row">
                    <span className="title grow">{topic.name}</span>
                    <span className="faint num">{k.cards ? `${k.mastery}%` : `${k.notes} notes`}</span>
                  </div>
                  <div style={{ marginBlockStart: 8 }}>
                    <Meter pct={k.mastery} tone={k.fading > k.cards / 3 ? 'warn' : k.mastery >= 65 ? 'good' : undefined} />
                  </div>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {queued.length > 0 && (
        <div className="section">
          <div className="section-title">
            <Sparkles size={16} /> Waiting on Claude
          </div>
          <div className="list">
            {queued.map((t) => (
              <div key={t.id} className="listitem">
                <span className="emoji">{t.emoji || '📁'}</span>
                <span className="grow">
                  <div className="title">{topicPath(vault, t.id)}</div>
                  <div className="faint">Starter pack · {t.level ?? 'beginner'}</div>
                </span>
                <button className="iconbtn" aria-label="Cancel request" onClick={() => useStore.getState().cancelExplore(t.id)}>
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">Popular</div>
        <div className="catalogue">
          {POPULAR_TOPICS.map((t) => (
            <TopicCard key={t.id} t={t} vault={vault} onClick={() => setPick(t)} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-title">Browse</div>
        <div className="chips scroll" style={{ marginBlockEnd: 12 }}>
          {CATALOGUE.map((c) => (
            <button key={c.id} className={`chip ${c.id === category ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 10rem), 1fr))' }}>
          {cat.topics.map((t) => (
            <TopicCard key={t.id} t={t} vault={vault} onClick={() => setPick(t)} />
          ))}
        </div>
      </div>

      <ExploreSheet pick={pick} onClose={() => setPick(null)} onDone={() => setCustom('')} />
      <LeechSheet open={leechesOpen} onClose={() => setLeechesOpen(false)} />
    </div>
  );
}

function TopicCard({ t, vault, onClick }: { t: CatalogueTopic; vault: Vault; onClick: () => void }) {
  const existing = findTopicByPath(vault, t.path);
  const queued = existing?.tasks?.includes('explore');
  const k = existing ? topicKnowledge(vault, existing.id) : undefined;
  return (
    <button className="topic-card" onClick={onClick}>
      <span className="emoji">{t.emoji}</span>
      <span className="name">{t.name}</span>
      <span className="blurb">{t.blurb}</span>
      {(queued || (k && k.notes > 0)) && (
        <span className="status">
          {queued ? (
            <span className="pill-label tone-neutral">Queued</span>
          ) : (
            <span className="faint num">
              {k!.notes} notes{k!.cards ? ` · ${k!.mastery}%` : ''}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function ExploreSheet({ pick, onClose, onDone }: { pick: CatalogueTopic | { custom: string } | null; onClose: () => void; onDone: () => void }) {
  const vault = useStore((s) => s.vault);
  const nav = useNavigate();
  const [level, setLevel] = useState<Level>('beginner');
  const [note, setNote] = useState('');
  const isCustom = !!pick && 'custom' in pick;
  const name = pick ? ('custom' in pick ? pick.custom : pick.name) : '';
  const path = pick ? ('custom' in pick ? pick.custom : pick.path) : '';
  const existing = pick ? findTopicByPath(vault, path) : undefined;
  const k = existing ? topicKnowledge(vault, existing.id) : undefined;
  const queued = existing?.tasks?.includes('explore');

  function request() {
    const st = useStore.getState();
    const topic: Topic | undefined = existing ?? st.ensureTopicPath(path, pick && !('custom' in pick) ? pick.emoji : undefined);
    if (!topic) return;
    const covers = pick && !('custom' in pick) ? `Cover: ${pick.covers.join('; ')}.` : '';
    st.requestExplore(topic.id, level, [covers, note.trim()].filter(Boolean).join('\n') || undefined);
    toast('Queued for Claude');
    onDone();
    onClose();
  }

  return (
    <Sheet open={!!pick} onClose={onClose}>
      {pick && (
        <div className="stack">
          <div className="row" style={{ gap: 12 }}>
            <span className="emoji" style={{ width: 48, height: 48, fontSize: '1.5rem' }}>
              {isCustom ? '✨' : (pick as CatalogueTopic).emoji}
            </span>
            <div className="grow">
              <h2 style={{ margin: 0 }}>{name}</h2>
              {!isCustom && <div className="faint">{(pick as CatalogueTopic).blurb}</div>}
            </div>
          </div>

          {!isCustom && (
            <ul className="muted" style={{ margin: 0, paddingInlineStart: 20, fontSize: 'var(--step--1)' }}>
              {(pick as CatalogueTopic).covers.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}

          {k && k.notes > 0 && (
            <Link to={`/topic/${existing!.id}`} className="card row" style={{ color: 'inherit' }} onClick={onClose}>
              <Ring pct={k.mastery} size={48} />
              <span className="grow">
                <div style={{ fontWeight: 650 }}>In your library</div>
                <div className="faint num">
                  {k.notes} notes · {k.cards} cards
                </div>
              </span>
              <ChevronRight size={18} className="chev" />
            </Link>
          )}

          {queued ? (
            <div className="card row">
              <Sparkles size={18} color="var(--accent)" />
              <span className="grow">Queued for Claude</span>
              <button
                className="btn sm ghost"
                onClick={() => {
                  useStore.getState().cancelExplore(existing!.id);
                  onClose();
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="segmented" role="group" aria-label="Level">
                {LEVELS.map((l) => (
                  <button key={l.id} aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <textarea className="textarea" rows={2} placeholder="Anything specific? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn primary block" onClick={request}>
                <Sparkles size={18} /> {k && k.notes > 0 ? 'Go deeper with Claude' : 'Build starter pack with Claude'}
              </button>
              {!existing && (
                <button
                  className="btn ghost block"
                  onClick={() => {
                    const t = useStore.getState().ensureTopicPath(path, pick && !('custom' in pick) ? pick.emoji : undefined);
                    onClose();
                    if (t) nav(`/topic/${t.id}`);
                  }}
                >
                  Just add the topic
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

interface Suggestion {
  key: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  to?: string;
  onClick?: () => void;
  color?: string;
}

function useSuggestions(vault: Vault, overall: KnowledgeSummary, topics: { topic: Topic; k: KnowledgeSummary }[]): Suggestion[] {
  const nav = useNavigate();
  return useMemo(() => {
    const out: Suggestion[] = [];
    if (overall.due > 0) {
      out.push({ key: 'due', icon: <Brain size={18} />, title: `Review ${overall.due} card${overall.due === 1 ? '' : 's'}`, sub: 'Due now', to: '/review' });
    }
    const fading = topics.filter((t) => t.k.fading >= 3).sort((a, b) => b.k.fading - a.k.fading)[0];
    if (fading) {
      out.push({
        key: 'fading',
        icon: <TrendingDown size={18} />,
        title: `Refresh ${fading.topic.name}`,
        sub: `${fading.k.fading} cards fading`,
        to: `/review?topic=${fading.topic.id}`,
        color: 'var(--warn)',
      });
    }
    const leeches = live(vault.cards).filter(isLeech).length;
    if (leeches > 0) {
      out.push({ key: 'leech', icon: <AlertTriangle size={18} />, title: `${leeches} card${leeches === 1 ? '' : 's'} keep slipping`, sub: 'Rewrite or get an explanation', color: 'var(--bad)' });
    }
    const missing = missingNotes(vault)[0];
    if (missing) {
      out.push({
        key: 'missing',
        icon: <FilePlus2 size={18} />,
        title: `Write “${missing.title}”`,
        sub: `Linked from ${missing.refs.length} note${missing.refs.length === 1 ? '' : 's'}`,
        onClick: () => {
          const n = useStore.getState().createNote({ title: missing.title, topicIds: missing.refs[0]?.topicIds ?? [] });
          nav(`/note/${n.id}?edit=1`);
        },
      });
    }
    if (overall.notesWithoutCards > 0) {
      out.push({ key: 'nocards', icon: <Layers size={18} />, title: `${overall.notesWithoutCards} note${overall.notesWithoutCards === 1 ? '' : 's'} without flashcards`, sub: 'Add cards to remember them', to: '/library?filter=nocards' });
    }
    const unchecked = live(vault.notes).filter((n) => !n.verification || n.verification.verdict === 'unchecked').length;
    if (unchecked > 0) {
      out.push({ key: 'unchecked', icon: <BadgeCheck size={18} />, title: `${unchecked} note${unchecked === 1 ? '' : 's'} not fact-checked`, sub: 'Queue them for Claude', to: '/library?filter=unchecked' });
    }
    return out;
  }, [vault, overall, topics, nav]);
}

function LeechSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vault = useStore((s) => s.vault);
  const leeches = live(vault.cards).filter(isLeech);
  return (
    <Sheet open={open} onClose={onClose} title="Cards that keep slipping">
      <p className="faint" style={{ marginBlockStart: 0 }}>
        Split them into smaller facts, add an example, or ask Claude to explain.
      </p>
      <div className="list">
        {leeches.map((c) => {
          const n = vault.notes[c.noteId];
          return (
            <Link key={c.id} to={`/note/${c.noteId}`} className="listitem" onClick={onClose}>
              <span className="grow">
                <div className="title">{c.front.replace(/\*\*/g, '')}</div>
                <div className="faint">
                  {n?.title} · forgotten {c.srs?.lapses}×
                </div>
              </span>
              <ChevronRight size={18} className="chev" />
            </Link>
          );
        })}
      </div>
    </Sheet>
  );
}
