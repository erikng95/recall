import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  Check,
  ExternalLink,
  FolderPlus,
  Layers,
  Link2,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  Telescope,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  backlinks,
  live,
  normalizeTitle,
  outgoingLinks,
  SOURCE_KINDS,
  type Card,
  type ClaudeTask,
  type Note,
  type SourceKind,
  type SourceRef,
} from '@shared/vault.ts';
import { topicPath, useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import Markdown from '../components/Markdown.tsx';
import Editor from '../components/Editor.tsx';
import Sheet from '../components/Sheet.tsx';
import TopicPicker from '../components/TopicPicker.tsx';
import VerdictBadge, { verdictIcon } from '../components/VerdictBadge.tsx';
import NoteItem from '../components/NoteItem.tsx';
import { toast } from '../lib/toast.ts';
import { formatInterval } from '../lib/srs.ts';

const LocalGraph = lazy(() => import('../components/LocalGraph.tsx'));

const TASKS: { id: ClaudeTask; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'verify', label: 'Fact-check', icon: <BadgeCheck size={18} />, hint: 'Research the claims and rate how well-supported they are' },
  { id: 'cards', label: 'Make cards', icon: <Layers size={18} />, hint: 'Write flashcards for the key facts' },
  { id: 'organize', label: 'Organize & link', icon: <Wand2 size={18} />, hint: 'Assign topics and link related notes' },
  { id: 'explain', label: 'Explain deeper', icon: <Telescope size={18} />, hint: 'Add context, mechanisms and background' },
];

export default function NotePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const note = useStore((s) => s.vault.notes[id]);
  const editing = params.get('edit') === '1';

  if (!note || note.deleted) {
    return (
      <div className="page">
        <Topbar back />
        <div className="empty">This note doesn't exist (or was deleted).</div>
      </div>
    );
  }

  return editing ? (
    <NoteEditor key={note.id} note={note} onDone={() => setParams({}, { replace: true })} />
  ) : (
    <NoteView key={note.id} note={note} onEdit={() => setParams({ edit: '1' }, { replace: true })} />
  );
}

// ---------------------------------------------------------------------------
// Editor

function NoteEditor({ note, onDone }: { note: Note; onDone: () => void }) {
  const updateNote = useStore((s) => s.updateNote);
  const renameNote = useStore((s) => s.renameNote);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const originalTitle = useRef(note.title);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ title, body });
  latest.current = { title, body };
  // Decided once on open: re-evaluating after the first autosave would steal focus mid-typing.
  const [isNew] = useState(() => note.title === 'Untitled');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (el) el.style.height = `${el.scrollHeight}px`;
  }, []);

  function flush() {
    clearTimeout(saveTimer.current);
    const { title: t, body: b } = latest.current;
    const cur = useStore.getState().vault.notes[note.id];
    if (!cur) return;
    const patch: Partial<Note> = {};
    if (b !== cur.body) patch.body = b;
    const clean = t.trim() || 'Untitled';
    if (clean !== cur.title && !titleTaken(clean, note.id)) patch.title = clean;
    if (Object.keys(patch).length) updateNote(note.id, patch);
  }

  function schedule() {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 400);
  }

  function commitTitle() {
    flush();
    const t = latest.current.title.trim() || 'Untitled';
    if (titleTaken(t, note.id)) {
      toast('Another note already has that title');
      setTitle(originalTitle.current);
      return;
    }
    if (t !== originalTitle.current) {
      renameNote(note.id, originalTitle.current, t);
      originalTitle.current = t;
    }
  }

  // flush on unmount
  useEffect(() => () => {
    flush();
    const t = latest.current.title.trim() || 'Untitled';
    if (t !== originalTitle.current && !titleTaken(t, note.id)) {
      useStore.getState().renameNote(note.id, originalTitle.current, t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <Topbar back>
        <button
          className="btn primary sm"
          onClick={() => {
            commitTitle();
            onDone();
          }}
        >
          <Check size={16} /> Done
        </button>
      </Topbar>
      <textarea
        ref={titleRef}
        className="title-input"
        rows={1}
        value={title}
        placeholder="Title"
        autoFocus={isNew}
        onFocus={(e) => {
          if (title === 'Untitled') e.target.select();
        }}
        onChange={(e) => {
          setTitle(e.target.value.replace(/\n/g, ''));
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
          schedule();
        }}
        onBlur={commitTitle}
      />
      <Editor
        value={body}
        onChange={(v) => {
          setBody(v);
          schedule();
        }}
        excludeTitle={note.title}
        autoFocus={!isNew}
        placeholder={'Write what you learned…\n\n• Use [[Note title]] to link ideas\n• Wrap key facts in ==double equals== to turn them into flashcards'}
      />
      <SourceEditor note={note} />
    </div>
  );
}

function titleTaken(title: string, selfId: string) {
  const key = normalizeTitle(title);
  return live(useStore.getState().vault.notes).some((n) => n.id !== selfId && normalizeTitle(n.title) === key);
}

function SourceEditor({ note }: { note: Note }) {
  const updateNote = useStore((s) => s.updateNote);
  const src: SourceRef = note.source ?? { kind: 'podcast' };
  const set = (patch: Partial<SourceRef>) => {
    const next = { ...src, ...patch };
    const empty = !next.title && !next.url && !next.author && !next.locator;
    updateNote(note.id, { source: empty ? undefined : next });
  };
  const [tags, setTags] = useState(note.tags.join(', '));
  return (
    <details className="card" style={{ marginTop: 16 }} open={!!note.source}>
      <summary style={{ fontWeight: 700, cursor: 'pointer' }}>Source & tags</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="chips">
          {SOURCE_KINDS.map((k) => (
            <button key={k} className={`chip sm ${src.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k as SourceKind })}>
              {k}
            </button>
          ))}
        </div>
        <input className="input" placeholder="Title (episode, article…)" defaultValue={src.title} onBlur={(e) => set({ title: e.target.value.trim() || undefined })} />
        <input className="input" placeholder="Author / show / channel" defaultValue={src.author} onBlur={(e) => set({ author: e.target.value.trim() || undefined })} />
        <input className="input" placeholder="Link (https://…)" inputMode="url" defaultValue={src.url} onBlur={(e) => set({ url: e.target.value.trim() || undefined })} />
        <input className="input" placeholder="Timestamp / page (e.g. 34:10)" defaultValue={src.locator} onBlur={(e) => set({ locator: e.target.value.trim() || undefined })} />
        <input
          className="input"
          placeholder="Tags, comma separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() =>
            updateNote(note.id, {
              tags: tags
                .split(',')
                .map((t) => t.trim().replace(/^#/, ''))
                .filter(Boolean),
            })
          }
        />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Viewer

function NoteView({ note, onEdit }: { note: Note; onEdit: () => void }) {
  const nav = useNavigate();
  const vault = useStore((s) => s.vault);
  const { updateNote, deleteNote, toggleTask } = useStore.getState();
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardEdit, setCardEdit] = useState<Card | 'new' | null>(null);

  const links = useMemo(() => outgoingLinks(vault, note), [vault, note]);
  const backs = useMemo(() => backlinks(vault, note), [vault, note]);
  const unlinked = useMemo(() => {
    if (note.title.length < 4) return [];
    const re = new RegExp(`\\b${note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const backIds = new Set(backs.map((b) => b.id));
    return live(vault.notes).filter((n) => n.id !== note.id && !backIds.has(n.id) && re.test(n.body));
  }, [vault, note, backs]);
  const cards = useMemo(() => live(vault.cards).filter((c) => c.noteId === note.id), [vault, note.id]);
  const topics = note.topicIds.map((t) => vault.topics[t]).filter((t) => t && !t.deleted);
  const tasks = new Set(note.tasks ?? []);
  const v = note.verification;

  function linkMention(other: Note) {
    const re = new RegExp(`\\b(${note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
    const body = other.body.replace(re, (m) => (m === note.title ? `[[${note.title}]]` : `[[${note.title}|${m}]]`));
    updateNote(other.id, { body });
    toast(`Linked from “${other.title}”`);
  }

  return (
    <div className="page">
      <Topbar back>
        <button className={`iconbtn ${note.pinned ? 'active' : ''}`} aria-label="Pin" onClick={() => updateNote(note.id, { pinned: !note.pinned })}>
          <Pin size={20} />
        </button>
        <button className="iconbtn" aria-label="Edit" onClick={onEdit}>
          <Pencil size={20} />
        </button>
        <button className="iconbtn" aria-label="More" onClick={() => setMenuOpen(true)}>
          <MoreVertical size={20} />
        </button>
      </Topbar>

      <h1 className="note-title" onDoubleClick={onEdit}>
        {note.title}
      </h1>

      <div className="chips" style={{ marginBottom: 16 }}>
        {topics.map((t) => (
          <Link key={t!.id} to={`/topic/${t!.id}`} className="chip">
            {t!.emoji} {topicPath(vault, t!.id)}
          </Link>
        ))}
        <button className="chip" onClick={() => setTopicsOpen(true)}>
          <FolderPlus size={14} /> {topics.length ? 'Edit' : 'Add topic'}
        </button>
        <VerdictBadge v={v} onClick={() => setVerifyOpen(true)} />
        {note.source && <SourceChip src={note.source} />}
        {note.tags.map((t) => (
          <Link key={t} to={`/library?q=${encodeURIComponent('#' + t)}`} className="chip sm tone-neutral">
            #{t}
          </Link>
        ))}
      </div>

      {note.body.trim() ? (
        <div onDoubleClick={onEdit}>
          <Markdown source={note.body} />
        </div>
      ) : (
        <button className="card empty" style={{ width: '100%' }} onClick={onEdit}>
          Nothing here yet — tap to write.
        </button>
      )}

      {/* Verification summary */}
      {v && v.verdict !== 'unchecked' && (
        <div className="section">
          <div className="section-title">Fact-check</div>
          <button className="card" style={{ width: '100%', textAlign: 'left' }} onClick={() => setVerifyOpen(true)}>
            <div className="row" style={{ marginBottom: 6 }}>
              <VerdictBadge v={v} />
              <span className="grow" />
              <span className="faint">{v.evidence?.length ?? 0} sources</span>
            </div>
            {v.summary && <div className="muted" style={{ fontSize: '0.92rem' }}>{v.summary}</div>}
          </button>
        </div>
      )}

      {/* Ask Claude */}
      <div className="section">
        <div className="section-title">
          <Sparkles size={14} /> Ask Claude
        </div>
        <div className="claude-tasks">
          {TASKS.map((t) => (
            <button key={t.id} className={`claude-task ${tasks.has(t.id) ? 'on' : ''}`} onClick={() => toggleTask(note.id, t.id)} title={t.hint}>
              {tasks.has(t.id) ? <Check size={18} /> : t.icon}
              <span className="grow">
                {t.label}
                {tasks.has(t.id) && <div style={{ fontSize: '0.72rem', fontWeight: 500 }}>Queued</div>}
              </span>
            </button>
          ))}
        </div>
        {tasks.size > 0 && (
          <p className="faint" style={{ margin: '8px 4px 0' }}>
            Queued for Claude. Run <b>/recall</b> in Claude Code (desktop) and it'll handle these, then sync back here.
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="section">
        <div className="section-title">
          <Layers size={14} /> Flashcards ({cards.length})
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => setCardEdit('new')}>
            <Plus size={15} /> Add
          </button>
        </div>
        {cards.length > 0 ? (
          <div className="list">
            {cards.map((c) => (
              <button key={c.id} className="cardpreview" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border)' }} onClick={() => setCardEdit(c)}>
                <div className="front">
                  <Markdown source={c.front} />
                </div>
                <div className="back">
                  <Markdown source={c.back} />
                </div>
                <div className="faint" style={{ marginTop: 4 }}>
                  {c.auto ? 'From highlight' : c.createdBy === 'claude' ? 'By Claude' : 'Manual'}
                  {c.suspended ? ' · suspended' : c.srs ? ` · next in ${formatInterval(Math.max(0, c.srs.due - Date.now()))}` : ' · new'}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="faint" style={{ margin: '0 4px' }}>
            Wrap key facts in <mark style={{ background: 'var(--mark)', color: 'var(--mark-text)', borderRadius: 4, padding: '0 3px' }}>==double equals==</mark> to create cards automatically, add one manually, or ask Claude.
          </p>
        )}
      </div>

      {/* Links */}
      <Suspense fallback={null}>
        <LocalGraph noteId={note.id} />
      </Suspense>

      {links.length > 0 && (
        <div className="section">
          <div className="section-title">
            <Link2 size={14} /> Links to ({links.length})
          </div>
          <div className="chips">
            {links.map((l) =>
              l.note ? (
                <Link key={l.title} to={`/note/${l.note.id}`} className="chip">
                  {l.note.title}
                </Link>
              ) : (
                <button
                  key={l.title}
                  className="chip"
                  style={{ borderStyle: 'dashed' }}
                  onClick={() => {
                    const n = useStore.getState().createNote({ title: l.title });
                    nav(`/note/${n.id}?edit=1`);
                  }}
                >
                  <Plus size={13} /> {l.title}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">Linked mentions ({backs.length})</div>
        {backs.length > 0 ? (
          <div className="list">
            {backs.map((b) => (
              <NoteItem key={b.id} note={b} />
            ))}
          </div>
        ) : (
          <p className="faint" style={{ margin: '0 4px' }}>
            No other notes link here yet. Mention <code>[[{note.title}]]</code> in another note to connect them.
          </p>
        )}
      </div>

      {unlinked.length > 0 && (
        <div className="section">
          <div className="section-title">Unlinked mentions ({unlinked.length})</div>
          <div className="list">
            {unlinked.map((u) => (
              <div key={u.id} className="listitem">
                <Link to={`/note/${u.id}`} className="grow title" style={{ color: 'inherit' }}>
                  {u.title}
                </Link>
                <button className="btn sm" onClick={() => linkMention(u)}>
                  <Link2 size={14} /> Link
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="faint" style={{ textAlign: 'center', margin: '28px 0 8px' }}>
        Created {new Date(note.createdAt).toLocaleDateString()} · Edited {new Date(note.updatedAt).toLocaleString()}
      </p>

      <TopicPicker open={topicsOpen} onClose={() => setTopicsOpen(false)} selected={note.topicIds} onChange={(ids) => updateNote(note.id, { topicIds: ids })} />

      <Sheet open={verifyOpen} onClose={() => setVerifyOpen(false)} title="Fact-check">
        {v && <VerificationDetails note={note} />}
      </Sheet>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="list">
          <button
            className="listitem"
            onClick={() => {
              setMenuOpen(false);
              void navigator.clipboard?.writeText(`# ${note.title}\n\n${note.body}`).then(() => toast('Copied as Markdown'));
            }}
          >
            Copy as Markdown
          </button>
          <button
            className="listitem"
            onClick={() => {
              setMenuOpen(false);
              const n = useStore.getState().createNote({ title: `${note.title} (copy)`, body: note.body, topicIds: note.topicIds, tags: note.tags, source: note.source });
              nav(`/note/${n.id}`);
            }}
          >
            Duplicate
          </button>
          <button
            className="listitem"
            style={{ color: 'var(--bad)' }}
            onClick={() => {
              if (confirm(`Delete “${note.title}” and its flashcards?`)) {
                deleteNote(note.id);
                setMenuOpen(false);
                toast('Note deleted');
                nav(-1);
              }
            }}
          >
            <Trash2 size={18} /> Delete note
          </button>
        </div>
      </Sheet>

      <CardEditor note={note} card={cardEdit} onClose={() => setCardEdit(null)} />
    </div>
  );
}

function SourceChip({ src }: { src: SourceRef }) {
  const label = [src.title || src.kind, src.locator].filter(Boolean).join(' @ ');
  const content = (
    <>
      {src.kind === 'podcast' ? '🎧' : src.kind === 'video' ? '📺' : src.kind === 'book' ? '📖' : src.kind === 'paper' ? '🔬' : '📄'} {label.length > 34 ? label.slice(0, 33) + '…' : label}
      {src.url && <ExternalLink size={12} />}
    </>
  );
  return src.url ? (
    <a className="chip" href={src.url} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : (
    <span className="chip">{content}</span>
  );
}

function VerificationDetails({ note }: { note: Note }) {
  const v = note.verification!;
  const { updateNote, toggleTask } = useStore.getState();
  return (
    <div className="stack">
      <div className="row wrap">
        <VerdictBadge v={v} />
        {v.checkedAt && (
          <span className="faint">
            by {v.checkedBy ?? 'unknown'} · {new Date(v.checkedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      {v.summary && <Markdown source={v.summary} />}
      {v.evidence && v.evidence.length > 0 && (
        <div>
          <div className="section-title" style={{ margin: '8px 0 4px' }}>
            Sources
          </div>
          {v.evidence.map((e, i) => (
            <div key={i} className="evidence">
              <span className={`stance chip sm tone-${e.stance === 'supports' ? 'good' : e.stance === 'contradicts' ? 'bad' : 'neutral'}`}>
                {verdictIcon(e.stance === 'supports' ? 'good' : e.stance === 'contradicts' ? 'bad' : 'neutral', 12)}
                {e.stance}
              </span>
              <div className="grow">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                    {e.title} <ExternalLink size={12} />
                  </a>
                ) : (
                  <b>{e.title}</b>
                )}
                {e.quality && <span className="faint"> · {e.quality} quality</span>}
                {e.note && <div className="muted" style={{ fontSize: '0.88rem' }}>{e.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <button
          className="btn sm"
          onClick={() => {
            if (!(note.tasks ?? []).includes('verify')) toggleTask(note.id, 'verify');
            toast('Queued for Claude to re-check');
          }}
        >
          <BadgeCheck size={15} /> Re-check
        </button>
        <button className="btn sm ghost danger" onClick={() => updateNote(note.id, { verification: undefined })}>
          Clear
        </button>
      </div>
    </div>
  );
}

function CardEditor({ note, card, onClose }: { note: Note; card: Card | 'new' | null; onClose: () => void }) {
  const { addCard, updateCard, deleteCard } = useStore.getState();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  useEffect(() => {
    if (card && card !== 'new') {
      setFront(card.front);
      setBack(card.back);
    } else {
      setFront('');
      setBack('');
    }
  }, [card]);
  const isAuto = card !== 'new' && card?.auto;
  return (
    <Sheet open={card !== null} onClose={onClose} title={card === 'new' ? 'New flashcard' : 'Flashcard'}>
      <div className="stack">
        {isAuto && <p className="faint" style={{ margin: 0 }}>This card comes from a ==highlight== in the note. Edit the note text to change it.</p>}
        <div>
          <label className="label">Front (question)</label>
          <textarea className="textarea" rows={3} value={front} disabled={!!isAuto} onChange={(e) => setFront(e.target.value)} autoFocus={card === 'new'} placeholder={`e.g. What does ${note.title} …?`} />
        </div>
        <div>
          <label className="label">Back (answer)</label>
          <textarea className="textarea" rows={3} value={back} disabled={!!isAuto} onChange={(e) => setBack(e.target.value)} />
        </div>
        <div className="row">
          {card !== 'new' && card && (
            <>
              <button
                className="btn sm ghost danger"
                onClick={() => {
                  deleteCard(card.id);
                  onClose();
                }}
              >
                <Trash2 size={15} /> Delete
              </button>
              <button
                className="btn sm ghost"
                onClick={() => {
                  updateCard(card.id, { suspended: !card.suspended });
                  onClose();
                }}
              >
                {card.suspended ? 'Unsuspend' : 'Suspend'}
              </button>
            </>
          )}
          <span className="grow" />
          {!isAuto && (
            <button
              className="btn primary"
              disabled={!front.trim() || !back.trim()}
              onClick={() => {
                if (card === 'new') addCard(note.id, front.trim(), back.trim());
                else if (card) updateCard(card.id, { front: front.trim(), back: back.trim() });
                onClose();
              }}
            >
              Save
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
