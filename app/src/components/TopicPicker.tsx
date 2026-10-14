import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { live, normalizeTitle, type ID, type Topic, type Vault } from '@shared/vault.ts';
import { topicPath, useStore } from '../store.ts';
import Sheet from './Sheet.tsx';

export interface TopicRow {
  topic: Topic;
  depth: number;
  path: string;
}

/** Depth-first ordered topic list for tree rendering. */
export function topicTree(v: Vault): TopicRow[] {
  const all = live(v.topics);
  const byParent = new Map<string, Topic[]>();
  for (const t of all) {
    const p = t.parentId && v.topics[t.parentId] && !v.topics[t.parentId].deleted ? t.parentId : '';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(t);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out: TopicRow[] = [];
  const walk = (parent: string, depth: number) => {
    for (const t of byParent.get(parent) ?? []) {
      if (depth > 12) return;
      out.push({ topic: t, depth, path: topicPath(v, t.id) });
      walk(t.id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

/** Find-or-create a topic path like "Science/Biology". Returns the leaf topic id. */
export function ensureTopicPath(path: string): ID | undefined {
  const parts = path
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  let parent: ID | undefined;
  for (const name of parts) {
    const st = useStore.getState();
    const t = st.createTopic(name, parent);
    parent = t.id;
  }
  return parent;
}

export default function TopicPicker({
  open,
  onClose,
  selected,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  selected: ID[];
  onChange: (ids: ID[]) => void;
}) {
  const vault = useStore((s) => s.vault);
  const [q, setQ] = useState('');
  const rows = useMemo(() => topicTree(vault), [vault]);
  const filtered = q.trim() ? rows.filter((r) => r.path.toLowerCase().includes(q.trim().toLowerCase())) : rows;
  const exact = rows.some((r) => normalizeTitle(r.path.replace(/ \/ /g, '/')) === normalizeTitle(q.replace(/\s*\/\s*/g, '/')));

  const toggle = (id: ID) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <Sheet open={open} onClose={onClose} title="Topics">
      <input
        className="input"
        placeholder="Search or create (e.g. Science/Biology)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim() && !exact) {
            const id = ensureTopicPath(q);
            if (id && !selected.includes(id)) onChange([...selected, id]);
            setQ('');
          }
        }}
        autoFocus={rows.length === 0}
      />
      <div className="list" style={{ marginTop: 12 }}>
        {q.trim() && !exact && (
          <button
            className="listitem"
            onClick={() => {
              const id = ensureTopicPath(q);
              if (id && !selected.includes(id)) onChange([...selected, id]);
              setQ('');
            }}
          >
            <span className="emoji">
              <Plus size={18} />
            </span>
            <span className="grow">
              Create <b>{q.trim()}</b>
            </span>
          </button>
        )}
        {filtered.map((r) => {
          const on = selected.includes(r.topic.id);
          return (
            <button key={r.topic.id} className="listitem" onClick={() => toggle(r.topic.id)} style={{ paddingLeft: 14 + (q ? 0 : r.depth * 18) }}>
              <span className="emoji">{r.topic.emoji || '📁'}</span>
              <span className="grow">
                <span className="title">{q ? r.path : r.topic.name}</span>
              </span>
              {on && <Check size={20} style={{ color: 'var(--accent)' }} />}
            </button>
          );
        })}
        {rows.length === 0 && !q && <div className="empty">No topics yet — type a name above to create one.</div>}
      </div>
      <button className="btn primary block" style={{ marginTop: 16 }} onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
