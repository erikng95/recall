import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph from 'force-graph';
import { useStore } from '../store.ts';
import {
  adjacencyOf,
  gravityForce,
  buildGraphModel,
  neighborhood,
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
import '../pages/graph.css';

export interface LocalGraphProps {
  noteId: string;
  /** Hops from the focus note to include (1 = direct links). */
  depth?: number;
  /** Height in px; width follows the container. */
  height?: number;
}

/**
 * Small, calm neighbourhood graph for a note page. Renders nothing when the note has no links.
 * Wheel zoom and panning are off so it never hijacks page scrolling; taps on a neighbour open it.
 */
export default function LocalGraph({ noteId, depth = 1, height = 260 }: LocalGraphProps) {
  const vault = useStore((s) => s.vault);
  const linked = useMemo(() => (adjacencyOf(vault).get(noteId)?.size ?? 0) > 0, [vault, noteId]);
  if (!linked) return null;
  return <LocalGraphView key={noteId} noteId={noteId} depth={depth} height={height} />;
}

function LocalGraphView({ noteId, depth, height }: { noteId: string; depth: number; height: number }) {
  const vault = useStore((s) => s.vault);
  const nav = useNavigate();
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });

  const colors = useGraphColors();

  const stageRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const cache = useMemo(() => new Map<string, GraphNode>(), []);
  const view = useRef<ViewState>({
    colors,
    query: '',
    focusId: noteId,
    labelAll: true,
    selected: null,
    hovered: null,
    adj: new Map(),
    active: null,
    focus: null,
  });

  const model = useMemo(() => {
    const adj = adjacencyOf(vault);
    return buildGraphModel(vault, cache, { noteIds: neighborhood(adj, noteId, depth) });
  }, [vault, cache, noteId, depth]);

  // Create once; the stage is absolutely positioned so its size comes from the container.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let fitted = false;

    const g = new ForceGraph<GraphNode, GraphLink>(el)
      .width(el.clientWidth)
      .height(el.clientHeight)
      .minZoom(0.5)
      .maxZoom(2.4)
      .enableNodeDrag(false)
      .warmupTicks(80)
      .cooldownTime(2000)
      .enableZoomInteraction(false)
      .enablePanInteraction(false)
      .nodeCanvasObject((node, ctx, scale) => paintNode(node, ctx, scale, view.current))
      .nodePointerAreaPaint((node, color, ctx, scale) => paintPointer(node, color, ctx, scale))
      .linkCanvasObjectMode(() => 'replace')
      .linkCanvasObject((link, ctx, scale) => paintLink(link, ctx, scale, view.current))
      .onNodeClick((node) => {
        if (node.id !== view.current.focusId) navRef.current(`/note/${node.id}`);
      })
      .onEngineStop(() => {
        if (fitted) return;
        fitted = true;
        g.zoomToFit(300, 24);
      });

    g.d3Force('charge')?.strength(-90);
    g.d3Force('link')?.distance(40);
    g.d3Force('gravity', gravityForce() as unknown as Parameters<typeof g.d3Force>[1]);
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
  }, []);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    view.current.adj = model.adj;
    g.graphData({ nodes: model.nodes, links: model.links });
    setTimeout(() => graphRef.current?.zoomToFit(0, 24), 60);
  }, [model]);

  useEffect(() => {
    view.current.colors = colors;
    requestRedraw(graphRef.current);
  }, [colors]);

  return (
    <div className="gr-local" style={{ height }}>
      <div className="gr-stage" ref={stageRef} />
    </div>
  );
}
