// Shared model + canvas painting for the Graph page and the note-page LocalGraph.
import { useEffect, useState } from 'react';
import type ForceGraph from 'force-graph';
import type { LinkObject, NodeObject } from 'force-graph';
import { graphEdges, hashString, live, type ID, type Note, type Topic, type Vault } from '@shared/vault.ts';
import { topicWithDescendants } from '../store.ts';

// ---------- Model ----------

export interface GraphNode extends NodeObject {
  id: string;
  title: string;
  degree: number;
  r: number;
  color: string | null; // null = note has no topic (drawn grey)
  pinned: boolean;
}

export interface GraphLink extends LinkObject<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export type GraphInstance = ForceGraph<GraphNode, GraphLink>;

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
  adj: Map<string, Set<string>>;
}

export interface BuildOptions {
  /** Only these note ids are candidates (default: all live notes). */
  noteIds?: Set<string>;
  /** Keep notes without links (default true). */
  showUnlinked?: boolean;
}

/** Pleasant, distinct colours for root-level topics (picked by a hash of the topic id). */
export const PALETTE: readonly string[] = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#8b5cf6',
  '#84cc16',
  '#f97316',
  '#0ea5e9',
];

export function radiusFor(degree: number): number {
  return 3 + Math.sqrt(degree) * 2.2;
}

/** Walk up parentId links to the root-level topic of `topicId`. */
export function rootTopicId(vault: Vault, topicId: ID): ID {
  let id = topicId;
  let cur: Topic | undefined = vault.topics[topicId];
  let guard = 0;
  while (cur?.parentId && guard++ < 20) {
    const parent: Topic | undefined = vault.topics[cur.parentId];
    if (!parent || parent.deleted) break;
    id = parent.id;
    cur = parent;
  }
  return id;
}

/**
 * Colour of a note = colour of its first live topic. A topic's own `color` wins,
 * then its root topic's `color`, then a stable palette entry hashed from the root id
 * (so subtopics share their root's colour). Returns null for notes without topics.
 */
export function noteColor(vault: Vault, note: Note): string | null {
  const first = note.topicIds.map((id) => vault.topics[id]).find((t): t is Topic => !!t && !t.deleted);
  if (!first) return null;
  if (first.color) return first.color;
  const rootId = rootTopicId(vault, first.id);
  const root: Topic | undefined = vault.topics[rootId];
  if (root?.color) return root.color;
  return PALETTE[parseInt(hashString(rootId), 16) % PALETTE.length];
}

/** Live note ids whose topics fall inside the subtree of `topicId`. */
export function notesInTopic(vault: Vault, topicId: ID): Set<string> {
  const topics = topicWithDescendants(vault, topicId);
  const ids = new Set<string>();
  for (const n of live(vault.notes)) {
    if (n.topicIds.some((t) => topics.has(t))) ids.add(n.id);
  }
  return ids;
}

function adjacencyFrom(edges: { source: string; target: string }[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    let a = adj.get(e.source);
    if (!a) adj.set(e.source, (a = new Set<string>()));
    a.add(e.target);
    let b = adj.get(e.target);
    if (!b) adj.set(e.target, (b = new Set<string>()));
    b.add(e.source);
  }
  return adj;
}

/** Undirected adjacency over all live notes. */
export function adjacencyOf(vault: Vault): Map<string, Set<string>> {
  return adjacencyFrom(graphEdges(vault));
}

/** Ids within `depth` hops of `focusId` (including the focus). */
export function neighborhood(adj: Map<string, Set<string>>, focusId: string, depth: number): Set<string> {
  const seen = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}

/**
 * Build nodes + links for the given vault. Node objects are reused by id through `cache`
 * so force-graph keeps their positions across rebuilds (filters, edits, navigation).
 */
export function buildGraphModel(vault: Vault, cache: Map<string, GraphNode>, opts: BuildOptions = {}): GraphModel {
  const notes = live(vault.notes).filter((n) => !opts.noteIds || opts.noteIds.has(n.id));
  const inSet = new Set(notes.map((n) => n.id));
  const edges = graphEdges(vault).filter((e) => inSet.has(e.source) && inSet.has(e.target));
  const adj = adjacencyFrom(edges);
  const degreeOf = (id: string) => adj.get(id)?.size ?? 0;
  const showUnlinked = opts.showUnlinked !== false;

  const kept = notes.filter((n) => showUnlinked || degreeOf(n.id) > 0);
  const keptIds = new Set(kept.map((n) => n.id));

  const nodes: GraphNode[] = kept.map((n) => {
    const degree = degreeOf(n.id);
    const fields = {
      title: n.title,
      degree,
      r: radiusFor(degree),
      color: noteColor(vault, n),
      pinned: !!n.pinned,
    };
    let node = cache.get(n.id);
    if (!node) {
      node = { id: n.id, ...fields };
      cache.set(n.id, node);
    } else {
      Object.assign(node, fields);
    }
    return node;
  });

  const links: GraphLink[] = edges
    .filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  return { nodes, links, adj };
}

// ---------- Theme ----------

export interface GraphColors {
  text: string;
  muted: string;
  accent: string;
  bg: string;
  border: string;
}

/** Read the current theme's colours from the CSS variables on :root. */
export function readColors(): GraphColors {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--text', '#171a26'),
    muted: read('--text-3', '#8b90a5'),
    accent: read('--accent', '#4f46e5'),
    bg: read('--bg', '#f6f7fb'),
    border: read('--border', '#e3e5ee'),
  };
}

/** Theme colours for the canvas; re-read (and the caller re-rendered) whenever <html data-theme> changes. */
export function useGraphColors(): GraphColors {
  const [colors, setColors] = useState<GraphColors>(readColors);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(readColors()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

// ---------- Painting ----------

/** Mutable interaction state read by the canvas callbacks (kept in a ref, not React state). */
export interface ViewState {
  colors: GraphColors;
  /** Lower-cased search term ('' = none). */
  query: string;
  /** Local graph: the note being previewed (drawn accent + larger). */
  focusId: string | null;
  /** Always label every node (small graphs). */
  labelAll: boolean;
  selected: string | null;
  hovered: string | null;
  adj: Map<string, Set<string>>;
  /** selected ?? hovered */
  active: string | null;
  /** active + its neighbours; null = nothing focused, so nothing is dimmed. */
  focus: Set<string> | null;
}

export function computeFocus(v: ViewState): void {
  const active = v.selected ?? v.hovered;
  v.active = active;
  if (active === null) {
    v.focus = null;
    return;
  }
  v.focus = new Set([active, ...(v.adj.get(active) ?? [])]);
}

/**
 * Ask force-graph to repaint. Its render loop pauses when idle, and setting a canvas
 * callback prop is the public hook that flags a redraw (the value is unchanged here).
 */
export function requestRedraw(g: GraphInstance | null): void {
  g?.nodeCanvasObjectMode(() => 'replace');
}

const TAU = Math.PI * 2;

export function truncateTitle(title: string, max = 28): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  scale: number,
  colors: GraphColors,
  alpha: number,
  strong: boolean,
): void {
  const size = (strong ? 13 : 11.5) / scale;
  ctx.font = `${strong ? 700 : 600} ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width;
  const padX = 4 / scale;
  const padY = 2 / scale;
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(x - w / 2 - padX, top - padY, w + padX * 2, size + padY * 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colors.text;
  ctx.fillText(text, x, top);
}

/** Draws one node (circle, rings, label). Called by force-graph for every node each frame. */
export function paintNode(node: GraphNode, ctx: CanvasRenderingContext2D, scale: number, v: ViewState): void {
  if (node.x === undefined || node.y === undefined) return;
  const x = node.x;
  const y = node.y;
  const isFocus = node.id === v.focusId;
  const isActive = node.id === v.active;
  const inFocusSet = v.focus?.has(node.id) ?? false;
  const dimmed = v.focus !== null && !inFocusSet;
  const matched = v.query !== '' && node.title.toLowerCase().includes(v.query);
  const alpha = dimmed ? 0.14 : 1;
  const r = isFocus ? node.r + 2 : node.r;

  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = isFocus ? v.colors.accent : (node.color ?? v.colors.muted);
  ctx.fill();

  if (node.pinned) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5 / scale, 0, TAU);
    ctx.lineWidth = 1.2 / scale;
    ctx.strokeStyle = v.colors.text;
    ctx.stroke();
  }

  if (isActive || matched) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4.5 / scale, 0, TAU);
    ctx.lineWidth = (isActive ? 2 : 1.4) / scale;
    ctx.strokeStyle = v.colors.accent;
    ctx.setLineDash(isActive ? [] : [4 / scale, 3 / scale]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const showLabel =
    v.labelAll || isActive || isFocus || matched || inFocusSet || node.degree >= 4 || scale > 1.6;
  if (showLabel) {
    drawLabel(ctx, truncateTitle(node.title), x, y + r + 3 / scale, scale, v.colors, alpha, isActive || isFocus);
  }
  ctx.globalAlpha = 1;
}

/** Enlarged invisible hit area so taps on phones land reliably (about 10 screen px of slop). */
export function paintPointer(node: GraphNode, color: string, ctx: CanvasRenderingContext2D, scale: number): void {
  if (node.x === undefined || node.y === undefined) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.r + 10 / scale, 0, TAU);
  ctx.fill();
}

function endNode(e: string | number | GraphNode | undefined): GraphNode | undefined {
  return typeof e === 'object' && e !== null ? e : undefined;
}

/** Draws one link as a plain line (force-graph's default line is replaced). */
export function paintLink(link: GraphLink, ctx: CanvasRenderingContext2D, scale: number, v: ViewState): void {
  const s = endNode(link.source);
  const t = endNode(link.target);
  if (!s || !t || s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return;
  const touches = v.active !== null && (s.id === v.active || t.id === v.active);
  ctx.globalAlpha = touches ? 0.9 : v.focus ? 0.06 : 0.3;
  ctx.strokeStyle = touches ? v.colors.accent : v.colors.muted;
  ctx.lineWidth = (touches ? 1.8 : 1) / scale;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
