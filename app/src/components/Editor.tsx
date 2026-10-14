import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bold, Heading2, Highlighter, Link2, List, Quote } from 'lucide-react';
import { live } from '@shared/vault.ts';
import { useStore } from '../store.ts';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  excludeTitle?: string;
  autoFocus?: boolean;
  minRows?: number;
}

/** Markdown textarea with a formatting toolbar and [[wikilink]] autocomplete. */
export default function Editor({ value, onChange, placeholder, excludeTitle, autoFocus, minRows = 8 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const vault = useStore((s) => s.vault);

  // Auto-grow
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Link autocomplete: text between the last unmatched "[[" and the caret.
  const linkQuery = useMemo(() => {
    const before = value.slice(0, caret);
    const m = /\[\[([^\[\]\n|]*)$/.exec(before);
    return m ? m[1] : null;
  }, [value, caret]);

  const suggestions = useMemo(() => {
    if (linkQuery === null) return [];
    const q = linkQuery.trim().toLowerCase();
    return live(vault.notes)
      .filter((n) => n.title !== excludeTitle && (!q || n.title.toLowerCase().includes(q)))
      .sort((a, b) => {
        const as = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bs = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return as - bs || b.updatedAt - a.updatedAt;
      })
      .slice(0, 6);
  }, [linkQuery, vault, excludeTitle]);

  function replaceRange(start: number, end: number, text: string, caretOffset = text.length) {
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = start + caretOffset;
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  function wrap(before: string, after = before, placeholderText = '') {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = value.slice(s, e) || placeholderText;
    replaceRange(s, e, before + sel + after, before.length + sel.length + (value.slice(s, e) ? after.length : 0));
  }

  function linePrefix(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    if (value.startsWith(prefix, lineStart)) {
      replaceRange(lineStart, lineStart + prefix.length, '', s - lineStart - prefix.length);
    } else {
      replaceRange(lineStart, lineStart, prefix, s - lineStart + prefix.length);
    }
  }

  function pickSuggestion(title: string) {
    const start = caret - (linkQuery?.length ?? 0);
    // swallow existing closing brackets if present
    const hasClose = value.slice(caret, caret + 2) === ']]';
    replaceRange(start, caret + (hasClose ? 2 : 0), `${title}]]`);
  }

  const showNew = linkQuery !== null && linkQuery.trim() && !suggestions.some((s) => s.title.toLowerCase() === linkQuery.trim().toLowerCase());

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button type="button" className="iconbtn" title="Link a note [[ ]]" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('[[', ']]')}>
          <Link2 size={19} />
        </button>
        <button type="button" className="iconbtn" title="Highlight key fact (becomes a flashcard)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('==', '==', 'key fact')}>
          <Highlighter size={19} />
        </button>
        <button type="button" className="iconbtn" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**', '**', 'bold')}>
          <Bold size={19} />
        </button>
        <button type="button" className="iconbtn" title="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix('## ')}>
          <Heading2 size={19} />
        </button>
        <button type="button" className="iconbtn" title="List" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix('- ')}>
          <List size={19} />
        </button>
        <button type="button" className="iconbtn" title="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix('> ')}>
          <Quote size={19} />
        </button>
      </div>
      {linkQuery !== null && (suggestions.length > 0 || showNew) && (
        <div className="editor-suggest" role="listbox">
          {suggestions.map((n) => (
            <button key={n.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(n.title)}>
              {n.title}
            </button>
          ))}
          {showNew && (
            <button type="button" className="new" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(linkQuery!.trim())}>
              + New note “{linkQuery!.trim()}”
            </button>
          )}
        </div>
      )}
      <textarea
        ref={ref}
        className="textarea editor-area"
        value={value}
        rows={minRows}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => {
          if (linkQuery !== null && suggestions.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            pickSuggestion(suggestions[0].title);
          }
        }}
      />
    </div>
  );
}
