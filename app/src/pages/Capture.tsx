import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BadgeCheck, FolderPlus, Inbox as InboxIcon, Layers, Save } from 'lucide-react';
import { SOURCE_KINDS, type ClaudeTask, type SourceKind, type SourceRef } from '@shared/vault.ts';
import { topicPath, useStore } from '../store.ts';
import Topbar from '../components/Topbar.tsx';
import TopicPicker from '../components/TopicPicker.tsx';
import { toast } from '../lib/toast.ts';

const KIND_EMOJI: Record<SourceKind, string> = {
  podcast: '🎧',
  article: '📰',
  video: '📺',
  book: '📖',
  paper: '🔬',
  conversation: '💬',
  social: '📱',
  other: '📄',
};

function guessKind(url: string): SourceKind {
  if (/youtube\.com|youtu\.be|vimeo|tiktok/i.test(url)) return 'video';
  if (/spotify\.com\/episode|podcasts\.apple|pca\.st|overcast|pocketcasts|podcast/i.test(url)) return 'podcast';
  if (/doi\.org|pubmed|ncbi\.nlm|arxiv|nature\.com|sciencedirect|biorxiv|medrxiv/i.test(url)) return 'paper';
  if (/twitter\.com|x\.com|reddit\.com|instagram|threads\.net|bsky/i.test(url)) return 'social';
  return 'article';
}

export default function Capture() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const shared = params.get('shared') === '1';
  const sharedUrl = params.get('url') ?? '';
  const [text, setText] = useState(params.get('text') ?? '');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<SourceRef>({
    kind: sharedUrl ? guessKind(sharedUrl) : 'podcast',
    url: sharedUrl || undefined,
    title: params.get('title') || undefined,
  });
  const [showSource, setShowSource] = useState(shared || !!sharedUrl);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [tasks, setTasks] = useState<Set<ClaudeTask>>(new Set(['verify']));
  const vault = useStore((s) => s.vault);
  const { addInbox, createNote } = useStore.getState();

  const hasContent = !!(text.trim() || title.trim() || source.url);
  const cleanSource = (): SourceRef | undefined => (source.title || source.url || source.author || source.locator ? source : undefined);

  function toggleTask(t: ClaudeTask) {
    const next = new Set(tasks);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTasks(next);
  }

  function saveInbox() {
    addInbox({
      text: [title.trim(), text.trim()].filter(Boolean).join('\n\n') || source.url || '',
      title: source.title,
      url: source.url,
      source: cleanSource(),
    });
    toast('Saved to inbox');
    if (shared || window.history.length <= 1) nav('/inbox', { replace: true });
    else nav(-1);
  }

  function saveNote() {
    let t = title.trim();
    let body = text.trim();
    if (!t) {
      const lines = body.split('\n');
      t = lines[0].replace(/^[#>\-*\s]+/, '').slice(0, 100) || source.title || 'Untitled';
      body = lines.slice(1).join('\n').trim();
    }
    const n = createNote({ title: t, body, topicIds, source: cleanSource(), tasks: tasks.size ? [...tasks] : undefined });
    toast(tasks.size ? 'Note saved · queued for Claude' : 'Note saved');
    nav(`/note/${n.id}`, { replace: true });
  }

  return (
    <div className="page">
      <Topbar title={shared ? 'Shared to Recall' : 'Capture'} back />

      <input className="input" placeholder="Title or claim (optional)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontWeight: 700, fontSize: '1.05rem' }} />
      <textarea
        className="textarea capture-area"
        style={{ marginTop: 10 }}
        placeholder={'What did you learn?\n\ne.g. “Huberman said morning sunlight within 30 min of waking helps set the circadian clock.”'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus={!shared}
        rows={6}
      />

      <div className="chips" style={{ marginTop: 12 }}>
        <button className="chip" onClick={() => setTopicsOpen(true)}>
          <FolderPlus size={14} /> {topicIds.length ? 'Topics' : 'Add topic'}
        </button>
        {topicIds.map((id) => (
          <span key={id} className="chip on">
            {vault.topics[id]?.emoji} {topicPath(vault, id)}
          </span>
        ))}
        <button className={`chip ${showSource ? 'on' : ''}`} onClick={() => setShowSource(!showSource)}>
          {KIND_EMOJI[source.kind]} Source
        </button>
      </div>

      {showSource && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <div className="chips">
            {SOURCE_KINDS.map((k) => (
              <button key={k} className={`chip sm ${source.kind === k ? 'on' : ''}`} onClick={() => setSource({ ...source, kind: k })}>
                {KIND_EMOJI[k]} {k}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Episode / article / book title" value={source.title ?? ''} onChange={(e) => setSource({ ...source, title: e.target.value || undefined })} />
          <input className="input" placeholder="Who said it (host, author, channel)" value={source.author ?? ''} onChange={(e) => setSource({ ...source, author: e.target.value || undefined })} />
          <div className="row">
            <input className="input" placeholder="Link" inputMode="url" value={source.url ?? ''} onChange={(e) => setSource({ ...source, url: e.target.value || undefined })} />
            <input className="input" placeholder="Time / page" value={source.locator ?? ''} onChange={(e) => setSource({ ...source, locator: e.target.value || undefined })} style={{ maxWidth: 120 }} />
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">When saved as a note, ask Claude to…</div>
        <div className="claude-tasks">
          <button className={`claude-task ${tasks.has('verify') ? 'on' : ''}`} onClick={() => toggleTask('verify')}>
            <BadgeCheck size={18} /> Fact-check it
          </button>
          <button className={`claude-task ${tasks.has('cards') ? 'on' : ''}`} onClick={() => toggleTask('cards')}>
            <Layers size={18} /> Make flashcards
          </button>
        </div>
      </div>

      <div className="row sticky-actions">
        <button className="btn grow" disabled={!hasContent} onClick={saveInbox}>
          <InboxIcon size={18} /> Inbox
        </button>
        <button className="btn gradient grow" disabled={!hasContent} onClick={saveNote}>
          <Save size={18} /> Save note
        </button>
      </div>
      <p className="faint" style={{ textAlign: 'center', marginTop: 10 }}>
        <b>Inbox</b> = quick dump, sort later (or let Claude do it). <b>Note</b> = goes straight into your library.
      </p>

      <TopicPicker open={topicsOpen} onClose={() => setTopicsOpen(false)} selected={topicIds} onChange={setTopicIds} />
    </div>
  );
}
