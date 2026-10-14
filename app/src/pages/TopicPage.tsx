import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Brain, ChevronRight, FilePlus2, Pencil, Trash2 } from 'lucide-react';
import { live } from '@shared/vault.ts';
import { isDue, topicPath, topicWithDescendants, useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import NoteItem from '../components/NoteItem.tsx';
import Sheet from '../components/Sheet.tsx';
import { topicTree } from '../components/TopicPicker.tsx';
import { toast } from '../lib/toast.ts';

const EMOJIS = ['📁', '🧠', '🔬', '🧬', '🩺', '💊', '🥗', '🏃', '😴', '🌍', '🏛️', '📜', '💰', '📈', '💻', '🤖', '🧪', '⚛️', '🌌', '🐾', '🌱', '🎨', '🎵', '🗣️', '🧘', '❤️', '⚖️', '🍳', '✈️', '📚'];

export default function TopicPage() {
  const { id = '' } = useParams();
  const vault = useStore((s) => s.vault);
  const topic = vault.topics[id];
  const nav = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [includeSub, setIncludeSub] = useState(true);

  const data = useMemo(() => {
    if (!topic) return null;
    const ids = includeSub ? topicWithDescendants(vault, id) : new Set([id]);
    const notes = live(vault.notes)
      .filter((n) => n.topicIds.some((t) => ids.has(t)))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
    const noteIds = new Set(notes.map((n) => n.id));
    const cards = live(vault.cards).filter((c) => noteIds.has(c.noteId));
    const due = cards.filter((c) => isDue(c)).length;
    const children = live(vault.topics)
      .filter((t) => t.parentId === id)
      .sort((a, b) => a.name.localeCompare(b.name));
    const checked = notes.filter((n) => n.verification && n.verification.verdict !== 'unchecked').length;
    return { notes, cards, due, children, checked };
  }, [vault, id, topic, includeSub]);

  if (!topic || topic.deleted || !data) {
    return (
      <div className="page">
        <Topbar back />
        <div className="empty">Topic not found.</div>
      </div>
    );
  }

  const path = topicPath(vault, id).split(' / ');

  return (
    <div className="page">
      <Topbar back>
        <button className="iconbtn" aria-label="Edit topic" onClick={() => setEditOpen(true)}>
          <Pencil size={20} />
        </button>
      </Topbar>

      {path.length > 1 && (
        <div className="faint" style={{ margin: '0 2px 4px' }}>
          {path.slice(0, -1).join(' / ')}
        </div>
      )}
      <h1 className="note-title" style={{ marginBottom: 4 }}>
        {topic.emoji || '📁'} {topic.name}
      </h1>
      {topic.description && <p className="muted" style={{ margin: '0 2px 12px' }}>{topic.description}</p>}

      <div className="grid2" style={{ margin: '12px 0' }}>
        <div className="tile">
          <span className="stat">{data.notes.length}</span>
          <span className="faint">notes · {data.checked} fact-checked</span>
        </div>
        <Link to={`/review?topic=${id}`} className="tile">
          <span className="stat">{data.due}</span>
          <span className="faint">
            <Brain size={13} /> cards to review · {data.cards.length} total
          </span>
        </Link>
      </div>

      {data.children.length > 0 && (
        <div className="section">
          <div className="section-title">Subtopics</div>
          <div className="list">
            {data.children.map((c) => (
              <Link key={c.id} to={`/topic/${c.id}`} className="listitem">
                <span className="emoji">{c.emoji || '📁'}</span>
                <span className="grow title">{c.name}</span>
                <ChevronRight size={18} className="faint" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">
          Notes
          <span className="spacer" />
          {data.children.length > 0 && (
            <button className="btn ghost sm" onClick={() => setIncludeSub(!includeSub)}>
              {includeSub ? 'Incl. subtopics' : 'This topic only'}
            </button>
          )}
          <button
            className="btn ghost sm"
            onClick={() => {
              const n = useStore.getState().createNote({ title: 'Untitled', topicIds: [id] });
              nav(`/note/${n.id}?edit=1`);
            }}
          >
            <FilePlus2 size={15} /> New
          </button>
        </div>
        {data.notes.length > 0 ? (
          <div className="list">
            {data.notes.map((n) => (
              <NoteItem key={n.id} note={n} showTopics={false} />
            ))}
          </div>
        ) : (
          <div className="empty">No notes in this topic yet.</div>
        )}
      </div>

      <TopicEditSheet id={id} open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}

function TopicEditSheet({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const vault = useStore((s) => s.vault);
  const topic = vault.topics[id];
  const { updateTopic, deleteTopic } = useStore.getState();
  const nav = useNavigate();
  const descendants = useMemo(() => topicWithDescendants(vault, id), [vault, id]);
  const parents = topicTree(vault).filter((r) => !descendants.has(r.topic.id));
  if (!topic) return null;
  return (
    <Sheet open={open} onClose={onClose} title="Edit topic">
      <div className="stack">
        <div>
          <label className="label">Name</label>
          <input className="input" defaultValue={topic.name} onBlur={(e) => e.target.value.trim() && updateTopic(id, { name: e.target.value.trim() })} />
        </div>
        <div>
          <label className="label">Icon</label>
          <div className="chips">
            {EMOJIS.map((e) => (
              <button key={e} className={`chip ${topic.emoji === e ? 'on' : ''}`} onClick={() => updateTopic(id, { emoji: e })} style={{ fontSize: '1.1rem', padding: '0 10px' }}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="textarea" rows={2} defaultValue={topic.description} onBlur={(e) => updateTopic(id, { description: e.target.value.trim() || undefined })} />
        </div>
        <div>
          <label className="label">Parent topic</label>
          <select className="select" value={topic.parentId ?? ''} onChange={(e) => updateTopic(id, { parentId: e.target.value || undefined })}>
            <option value="">— None (top level) —</option>
            {parents.map((r) => (
              <option key={r.topic.id} value={r.topic.id}>
                {'  '.repeat(r.depth)}
                {r.topic.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            className="btn ghost danger"
            onClick={() => {
              if (confirm(`Delete topic “${topic.name}”? Notes are kept; subtopics move up a level.`)) {
                deleteTopic(id);
                onClose();
                toast('Topic deleted');
                nav('/library?tab=topics');
              }
            }}
          >
            <Trash2 size={16} /> Delete
          </button>
          <span className="grow" />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
