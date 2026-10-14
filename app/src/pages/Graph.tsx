import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph from 'force-graph';
import { Eye, EyeOff, Network, Plus, Search, X } from 'lucide-react';
import { live, type Topic } from '@shared/vault.ts';
import Topbar from '../components/Topbar.tsx';
import { topicPath, useStore } from '../store.ts';
import {
  buildGraphModel,
  computeFocus,
  notesInTopic,
  paintLink,
  paintNode,
  paintPointer,
  requestRedraw,
  useGraphColors,
  type GraphInstance,
  type GraphLink,
  type GraphNode,
  type ViewState,
} from '../lib/graphData.ts';
import './graph.css';

/** Above this many notes the unlinked notes start hidden (toggle in the top bar). */
const UNLINKED_AUTO_LIMIT = 30;

export default function Graph() {
  const vault = useStore((s) => s.vault);
  const nav = useNavigate();
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });

  const colors = useGraphColors();

  const [topicId, setTopicId] = useState<string | null>(null);
  const [unlinkedPref, setUnlinkedPref] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const cache = useMemo(() => new Map<string, GraphNode>(), []);
  const view = useRef<ViewState>({
    colors,
    query: '',
    focusId: null,
    labelAll: false,
    selected: null,
    hovered: null,
    adj: new Map(),
    active: null,
    focus: null,
  });

  // ----- derived data -----
  const noteCount = useMemo(() => live(vault.notes).length, [vault.notes]);
  const showUnlinked = unlinkedPref ?? noteCount <= UNLINKED_AUTO_LIMIT;

  const rootTopics = useMemo(
    () =>
      live(vault.topics)
        .filter((t) => {
          const parent: Topic | undefined = t.parentId ? vault.topics[t.parentId] : undefined;
          return !parent || parent.deleted;
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [vault.topics],
  );

  const subset = useMemo(() => (topicId ? notesInTopic(vault, topicId) : undefined), [vault, topicId]);
  const model = useMemo(
    () => buildGraphModel(vault, cache, { noteIds: subset, showUnlinked }),
    [vault, cache, subset, showUnlinked],
  );
  const inGraph = useMemo(() => new Set(model.nodes.map((n) => n.id)), [model]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? live(vault.notes)
            .filter((n) => n.title.toLowerCase().includes(q))
            .sort((a, b) => a.title.localeCompare(b.title))
            .slice(0, 8)
        : [],
    [vault.notes, q],
  );

  const selNote = selectedId ? vault.notes[selectedId] : undefined;
  const selected = selNote && !selNote.deleted ? selNote : undefined;

  // ----- graph instance -----

  /** Select a node (or clear with null) and repaint. Only touches refs and stable setters. */
  const select = useCallback((id: string | null) => {
    const v = view.current;
    v.selected = id;
    computeFocus(v);
    setSelectedId(id);
    requestRedraw(graphRef.current);
  }, []);

  /** Select a node and bring it into the centre, zoomed in. */
  const focusOn = useCallback(
    (id: string) => {
      select(id);
      const g = graphRef.current;
      const node = cache.get(id);
      if (!g || !node || node.x === undefined || node.y === undefined) return;
      // Centre first (instant), then zoom: zoom keeps the viewport centre fixed.
      g.centerAt(node.x, node.y);
      g.zoom(Math.max(g.zoom(), 2.2), 600);
    },
    [select, cache],
  );

  // Create the force graph once; it is updated through graphData() afterwards.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let fitted = false;

    const g = new ForceGraph<GraphNode, GraphLink>(el)
      .width(el.clientWidth)
      .height(el.clientHeight)
      .minZoom(0.25)
      .maxZoom(6)
      .nodeCanvasObject((node, ctx, scale) => paintNode(node, ctx, scale, view.current))
      .nodePointerAreaPaint((node, color, ctx, scale) => paintPointer(node, color, ctx, scale))
      .linkCanvasObjectMode(() => 'replace')
      .linkCanvasObject((link, ctx, scale) => paintLink(link, ctx, scale, view.current))
      .onNodeClick((node) => {
        if (view.current.selected === node.id) navRef.current(`/note/${node.id}`);
        else select(node.id);
      })
      .onNodeHover((node) => {
        const v = view.current;
        const id = node?.id ?? null;
        if (v.hovered === id) return;
        v.hovered = id;
        computeFocus(v);
        requestRedraw(g);
      })
      .onBackgroundClick(() => select(null))
      .onEngineStop(() => {
        if (fitted) return;
        fitted = true;
        g.zoomToFit(400, 40);
      });

    g.d3Force('charge')?.strength(-110);
    g.d3Force('link')?.distance(46);
    graphRef.current = g;

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) g.width(w).height(h);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      graphRef.current = null;
      g._destructor();
    };
  }, [select]);

  // Push data into the graph whenever the model changes.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    view.current.adj = model.adj;
    computeFocus(view.current);
    g.graphData({ nodes: model.nodes, links: model.links });
    const pending = pendingFocus.current;
    if (pending) {
      pendingFocus.current = null;
      focusOn(pending);
    }
  }, [model, focusOn]);

  // Theme and search changes only need a repaint.
  useEffect(() => {
    view.current.colors = colors;
    requestRedraw(graphRef.current);
  }, [colors]);

  useEffect(() => {
    view.current.query = q;
    requestRedraw(graphRef.current);
  }, [q]);

  // ----- actions -----

  function pickNote(id: string) {
    setQuery('');
    if (inGraph.has(id)) {
      focusOn(id);
      return;
    }
    // Hidden by the current filters: widen them so the note can be shown.
    pendingFocus.current = id;
    setTopicId(null);
    setUnlinkedPref(true);
    setSelectedId(id);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && matches[0]) {
      e.preventDefault();
      pickNote(matches[0].id);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  const selectedTopics = selected
    ? selected.topicIds
        .filter((t) => vault.topics[t] && !vault.topics[t].deleted)
        .map((t) => topicPath(vault, t))
        .join(', ')
    : '';
  const selectedDegree = selected ? (cache.get(selected.id)?.degree ?? 0) : 0;

  return (
    <div className="page wide gr-page">
      <Topbar title="Graph">
        <button
          type="button"
          className={`iconbtn${showUnlinked ? ' active' : ''}`}
          aria-pressed={showUnlinked}
          aria-label={showUnlinked ? 'Hide unlinked notes' : 'Show unlinked notes'}
          title="Show unlinked notes"
          onClick={() => setUnlinkedPref(!showUnlinked)}
        >
          {showUnlinked ? <Eye size={20} /> : <EyeOff size={20} />}
        </button>
      </Topbar>

      <div className="gr-tools">
        <div className="search gr-search">
          <Search size={18} />
          <input
            className="input"
            type="search"
            placeholder="Find a note"
            aria-label="Find a note"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {matches.length > 0 && (
            <div className="gr-results">
              {matches.map((n) => {
                const firstTopic = n.topicIds.find((t) => vault.topics[t] && !vault.topics[t].deleted);
                return (
                  <button key={n.id} type="button" className="gr-result" onClick={() => pickNote(n.id)}>
                    <span className="gr-result-title">{n.title}</span>
                    {firstTopic && <span className="gr-result-sub">{topicPath(vault, firstTopic)}</span>}
                    {!inGraph.has(n.id) && <span className="chip sm">hidden</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="chips scroll" role="group" aria-label="Filter by topic">
          <button type="button" className={`chip${topicId === null ? ' on' : ''}`} onClick={() => setTopicId(null)}>
            All
          </button>
          {rootTopics.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip${topicId === t.id ? ' on' : ''}`}
              aria-pressed={topicId === t.id}
              onClick={() => setTopicId(topicId === t.id ? null : t.id)}
            >
              {t.emoji && <span aria-hidden="true">{t.emoji}</span>}
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="gr-canvas">
        <div className="gr-stage" ref={stageRef} />

        {model.nodes.length > 0 && (
          <div className="gr-stats faint">
            {model.nodes.length} {model.nodes.length === 1 ? 'note' : 'notes'} · {model.links.length}{' '}
            {model.links.length === 1 ? 'link' : 'links'}
          </div>
        )}

        {noteCount === 0 ? (
          <div className="gr-overlay">
            <div className="gr-empty">
              <Network size={44} />
              <div className="gr-empty-title">No notes yet</div>
              <p>
                Link notes with [[double brackets]] and they appear here as a web of connected ideas. Capture your
                first note to get started.
              </p>
              <button type="button" className="btn primary sm" onClick={() => nav('/capture')}>
                <Plus size={16} /> Capture a note
              </button>
            </div>
          </div>
        ) : model.nodes.length === 0 ? (
          <div className="gr-overlay">
            <div className="gr-empty">
              <Network size={44} />
              <p>
                Nothing to show here. Pick another topic, or use the eye icon to show notes that have no links yet.
              </p>
            </div>
          </div>
        ) : null}

        {selected && (
          <div className="gr-card" role="dialog" aria-label="Selected note">
            <div className="gr-card-main">
              <div className="gr-card-title">{selected.title}</div>
              <div className="gr-card-meta">
                {selectedTopics || 'No topic'} · {selectedDegree} {selectedDegree === 1 ? 'link' : 'links'}
              </div>
            </div>
            <button type="button" className="btn primary sm" onClick={() => nav(`/note/${selected.id}`)}>
              Open note
            </button>
            <button type="button" className="iconbtn" aria-label="Clear selection" onClick={() => select(null)}>
              <X size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
