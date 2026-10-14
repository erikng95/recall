import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeTitle, titleIndex } from '@shared/vault.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { useStore } from '../store.ts';

/** Renders markdown with [[wikilinks]] (click → open/create note) and ==highlights==. */
export default function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const ref = useRef<HTMLDivElement>(null);
  const vault = useStore((s) => s.vault);
  const openByTitle = useOpenByTitle();

  // Mark unresolved links.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = titleIndex(vault);
    el.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach((a) => {
      a.classList.toggle('missing', !idx.has(normalizeTitle(a.dataset.target ?? '')));
    });
  }, [html, vault]);

  return (
    <div
      ref={ref}
      className={`md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a.wikilink') as HTMLAnchorElement | null;
        if (a) {
          e.preventDefault();
          openByTitle(a.dataset.target ?? '');
        }
      }}
    />
  );
}

/** Navigate to a note by title, creating it if it doesn't exist (like Obsidian). */
export function useOpenByTitle() {
  const nav = useNavigate();
  return (title: string) => {
    const st = useStore.getState();
    const existing = titleIndex(st.vault).get(normalizeTitle(title));
    if (existing) nav(`/note/${existing.id}`);
    else {
      const n = st.createNote({ title });
      nav(`/note/${n.id}?edit=1`);
    }
  };
}
