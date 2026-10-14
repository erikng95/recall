import { Link } from 'react-router-dom';
import { Pin, Sparkles } from 'lucide-react';
import type { Note } from '@shared/vault.ts';
import { plainSnippet } from '../lib/markdown.ts';
import { topicPath, useStore } from '../store.ts';
import VerdictBadge from './VerdictBadge.tsx';

export default function NoteItem({ note, showTopics = true }: { note: Note; showTopics?: boolean }) {
  const vault = useStore((s) => s.vault);
  const snippet = plainSnippet(note.body);
  const topics = showTopics ? note.topicIds.map((t) => vault.topics[t]).filter((t) => t && !t.deleted) : [];
  return (
    <Link to={`/note/${note.id}`} className="listitem">
      <div className="grow">
        <div className="row">
          {note.pinned && <Pin size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
          <div className="title grow">{note.title}</div>
        </div>
        {snippet && <div className="sub">{snippet}</div>}
        {(topics.length > 0 || note.verification || (note.tasks?.length ?? 0) > 0) && (
          <div className="meta">
            <VerdictBadge v={note.verification} small />
            {(note.tasks?.length ?? 0) > 0 && (
              <span className="chip sm tone-neutral">
                <Sparkles size={11} /> Claude: {note.tasks!.join(', ')}
              </span>
            )}
            {topics.slice(0, 2).map((t) => (
              <span key={t!.id} className="chip sm">
                {t!.emoji} {topicPath(vault, t!.id).split(' / ').pop()}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
