import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, FilePlus2, FolderTree, Inbox as InboxIcon, Search, StickyNote } from 'lucide-react';
import { live, type Note } from '@shared/vault.ts';
import { useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import NoteItem from '../components/NoteItem.tsx';
import { topicTree } from '../components/TopicPicker.tsx';
import { SyncIndicator } from './Home.tsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: '📌 Pinned' },
  { id: 'claude', label: '✨ Queued for Claude' },
  { id: 'unchecked', label: 'Not fact-checked' },
  { id: 'flagged', label: '⚠️ Disputed' },
  { id: 'verified', label: '✅ Supported' },
  { id: 'notopic', label: 'No topic' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function matchFilter(n: Note, f: FilterId) {
  const verdict = n.verification?.verdict ?? 'unchecked';
  switch (f) {
    case 'pinned':
      return !!n.pinned;
    case 'claude':
      return (n.tasks?.length ?? 0) > 0;
    case 'unchecked':
      return verdict === 'unchecked';
    case 'flagged':
      return ['false', 'misleading', 'mixed'].includes(verdict);
    case 'verified':
      return ['supported', 'mostly-supported'].includes(verdict);
    case 'notopic':
      return n.topicIds.length === 0;
    default:
      return true;
  }
}

/** Search: plain words match title/body; #tag matches tags. Title matches rank first. */
export function searchNotes(notes: Note[], q: string): Note[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return notes;
  const scored: { n: Note; s: number }[] = [];
  for (const n of notes) {
    const title = n.title.toLowerCase();
    const body = n.body.toLowerCase();
    let s = 0;
    let ok = true;
    for (const t of terms) {
      if (t.startsWith('#') && t.length > 1) {
        if (n.tags.some((x) => x.toLowerCase() === t.slice(1))) s += 2;
        else ok = false;
      } else if (title.includes(t)) s += title.startsWith(t) ? 6 : 4;
      else if (body.includes(t) || n.tags.some((x) => x.toLowerCase().includes(t)) || n.source?.title?.toLowerCase().includes(t)) s += 1;
      else ok = false;
      if (!ok) break;
    }
    if (ok) scored.push({ n, s });
  }
  return scored.sort((a, b) => b.s - a.s || b.n.updatedAt - a.n.updatedAt).map((x) => x.n);
}

export default function Library() {
  const vault = useStore((s) => s.vault);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = (params.get('filter') as FilterId) || 'all';
  const tab = params.get('tab') === 'topics' ? 'topics' : 'notes';
  const [sort, setSort] = useState<'recent' | 'alpha' | 'created'>('recent');

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const notes = useMemo(() => {
    let list = live(vault.notes).filter((n) => matchFilter(n, filter));
    if (q.trim()) return searchNotes(list, q);
    list = [...list];
    if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
    return list;
  }, [vault, q, filter, sort]);

  const tree = useMemo(() => topicTree(vault), [vault]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of live(vault.notes)) for (const t of n.topicIds) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [vault]);
  const inboxCount = live(vault.inbox).filter((i) => i.status === 'new').length;

  return (
    <div className="page">
      <Topbar title="Library">
        <SyncIndicator />
        <button
          className="iconbtn"
          aria-label="New note"
          onClick={() => {
            const n = useStore.getState().createNote({ title: 'Untitled' });
            nav(`/note/${n.id}?edit=1`);
          }}
        >
          <FilePlus2 size={21} />
        </button>
      </Topbar>

      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search notes, #tags…" value={q} onChange={(e) => setParam('q', e.target.value)} />
      </div>

      <div className="row" style={{ margin: '12px 0' }}>
        <button className={`chip ${tab === 'notes' ? 'on' : ''}`} onClick={() => setParam('tab', '')}>
          <StickyNote size={15} /> Notes
        </button>
        <button className={`chip ${tab === 'topics' ? 'on' : ''}`} onClick={() => setParam('tab', 'topics')}>
          <FolderTree size={15} /> Topics
        </button>
        <span className="grow" />
        {inboxCount > 0 && (
          <Link to="/inbox" className="chip">
            <InboxIcon size={15} /> Inbox <span className="badge accent">{inboxCount}</span>
          </Link>
        )}
      </div>

      {tab === 'notes' ? (
        <>
          <div className="chips scroll" style={{ marginBottom: 12 }}>
            {FILTERS.map((f) => (
              <button key={f.id} className={`chip sm ${filter === f.id ? 'on' : ''}`} onClick={() => setParam('filter', f.id === 'all' ? '' : f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ margin: '0 4px 8px' }}>
            <span className="faint grow">
              {notes.length} note{notes.length === 1 ? '' : 's'}
            </span>
            {!q && (
              <select className="faint" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ border: 0, background: 'transparent' }}>
                <option value="recent">Recently edited</option>
                <option value="created">Newest</option>
                <option value="alpha">A–Z</option>
              </select>
            )}
          </div>
          {notes.length > 0 ? (
            <div className="list">
              {notes.slice(0, 300).map((n) => (
                <NoteItem key={n.id} note={n} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <StickyNote size={36} />
              <div>{q ? `Nothing matches “${q}”.` : 'No notes here yet.'}</div>
            </div>
          )}
        </>
      ) : (
        <>
          {tree.length > 0 ? (
            <div className="list">
              {tree.map((r) => (
                <Link key={r.topic.id} to={`/topic/${r.topic.id}`} className="listitem" style={{ paddingLeft: 14 + r.depth * 20 }}>
                  <span className="emoji">{r.topic.emoji || '📁'}</span>
                  <span className="grow title">{r.topic.name}</span>
                  <span className="faint">{counts.get(r.topic.id) ?? 0}</span>
                  <ChevronRight size={18} className="faint" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">
              <FolderTree size={36} />
              <div>No topics yet. Add a topic from any note, or ask Claude to “Organize & link”.</div>
            </div>
          )}
          <NewTopicButton />
        </>
      )}
    </div>
  );
}

function NewTopicButton() {
  const [name, setName] = useState('');
  const create = () => {
    const parts = name.split('/').map((p) => p.trim()).filter(Boolean);
    let parent: string | undefined;
    for (const p of parts) parent = useStore.getState().createTopic(p, parent).id;
    setName('');
  };
  return (
    <form
      className="row"
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create();
      }}
    >
      <input className="input" placeholder="New topic (e.g. Health/Sleep)" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn primary" disabled={!name.trim()}>
        Add
      </button>
    </form>
  );
}
