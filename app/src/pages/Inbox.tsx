import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Check, ExternalLink, FileText, Inbox as InboxIcon, Trash2, Undo2 } from 'lucide-react';
import { live, type InboxItem } from '@shared/vault.ts';
import { useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import { toast } from '../lib/toast.ts';

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

export default function Inbox() {
  const vault = useStore((s) => s.vault);
  const [showDone, setShowDone] = useState(false);
  const items = useMemo(
    () =>
      live(vault.inbox)
        .filter((i) => (showDone ? i.status === 'done' : i.status === 'new'))
        .sort((a, b) => b.createdAt - a.createdAt),
    [vault, showDone],
  );

  return (
    <div className="page">
      <Topbar title="Inbox" back />
      <div className="segmented" role="group" aria-label="Filter" style={{ marginBlockEnd: 'var(--space-s)' }}>
        <button aria-pressed={!showDone} onClick={() => setShowDone(false)}>
          To process
        </button>
        <button aria-pressed={showDone} onClick={() => setShowDone(true)}>
          Processed
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <InboxIcon size={36} />
          <div>{showDone ? 'Nothing processed yet.' : 'Inbox zero 🎉'}</div>
        </div>
      ) : (
        <div className="stack">
          {items.map((i) => (
            <InboxCard key={i.id} item={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxCard({ item }: { item: InboxItem }) {
  const nav = useNavigate();
  const vault = useStore((s) => s.vault);
  const { updateInbox, deleteInbox, createNote } = useStore.getState();
  const notes = (item.noteIds ?? []).map((id) => vault.notes[id]).filter((n) => n && !n.deleted);

  function toNote() {
    const lines = item.text.split('\n');
    const title = (item.title || lines[0] || 'Untitled').replace(/^[#>\-*\s]+/, '').slice(0, 100);
    const body = item.title ? item.text : lines.slice(1).join('\n').trim();
    const n = createNote({ title, body, source: item.source ?? (item.url ? { kind: 'article', url: item.url } : undefined) });
    updateInbox(item.id, { status: 'done', noteIds: [...(item.noteIds ?? []), n.id] });
    nav(`/note/${n.id}?edit=1`);
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="faint grow">
          {ago(item.createdAt)}
          {item.source?.kind ? ` · ${item.source.kind}` : ''}
        </span>
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="iconbtn" aria-label="Open link" style={{ width: 32, height: 32 }}>
            <ExternalLink size={16} />
          </a>
        )}
      </div>
      {item.title && <div style={{ fontWeight: 700 }}>{item.title}</div>}
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</div>
      {notes.length > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {notes.map((n) => (
            <Link key={n!.id} to={`/note/${n!.id}`} className="chip sm">
              <FileText size={12} /> {n!.title}
            </Link>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        {item.status === 'new' ? (
          <>
            <button className="btn sm primary" onClick={toNote}>
              <FileText size={15} /> Make note
            </button>
            <button
              className="btn sm"
              onClick={() => {
                updateInbox(item.id, { status: 'done' });
                toast('Archived');
              }}
            >
              <Archive size={15} /> Done
            </button>
          </>
        ) : (
          <button className="btn sm" onClick={() => updateInbox(item.id, { status: 'new' })}>
            <Undo2 size={15} /> Back to inbox
          </button>
        )}
        <span className="grow" />
        <button
          className="iconbtn"
          aria-label="Delete"
          onClick={() => {
            if (confirm('Delete this capture?')) deleteInbox(item.id);
          }}
        >
          <Trash2 size={17} />
        </button>
      </div>
      {item.status === 'done' && notes.length === 0 && (
        <div className="faint" style={{ marginTop: 6 }}>
          <Check size={12} /> Processed
        </div>
      )}
    </div>
  );
}
