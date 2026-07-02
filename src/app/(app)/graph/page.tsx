'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Waypoints, Loader2, Crosshair, X } from 'lucide-react';
import { RelationType } from '@/types';

interface GraphNode {
  id: string;
  title: string;
  slug: string;
  parent_id: string | null;
  keyword_type: string;
  status: string;
  completeness_score: number;
  definition: string | null;
  color: string | null;
  // focus-mode extras
  depth?: number;
  relevance?: number;
  via?: string;
}

interface GraphEdge {
  id: string;
  from_keyword_id: string;
  to_keyword_id: string;
  relation_type: RelationType | 'hierarchy';
  strength?: number;
}

const CATEGORIES: Record<string, { label: string; color: string; types: string[] }> = {
  structure: {
    label: 'Structure',
    color: '#8b5cf6',
    types: ['is-a', 'part-of', 'contains', 'belongs-to'],
  },
  dependency: {
    label: 'Dependencies',
    color: '#f59e0b',
    types: ['depends-on', 'requires', 'blocks', 'enables', 'uses'],
  },
  flow: {
    label: 'Flow & effects',
    color: '#ef4444',
    types: ['causes', 'leads-to', 'triggers', 'precedes', 'succeeds', 'produces', 'affects', 'replaces'],
  },
  data: {
    label: 'Data & metrics',
    color: '#3b82f6',
    types: ['measured-by', 'calculated-from', 'reported-in', 'generated-by', 'derived-from'],
  },
  governance: {
    label: 'Governance',
    color: '#10b981',
    types: ['owned-by', 'approves', 'validated-by'],
  },
  other: {
    label: 'Other',
    color: '#64748b',
    types: ['related-to', 'conflicts-with'],
  },
};

function categoryOf(type: string): string {
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (cat.types.includes(type)) return key;
  }
  return 'other';
}

function nodeColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#f87171';
}

/** Deterministic force-directed layout, computed synchronously. */
function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = nodes.length;
  if (n === 0) return positions;

  const R = Math.max(220, n * 16);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    // small deterministic jitter from the id so overlapping rings split apart
    const jitter = (node.id.charCodeAt(0) % 17) * 3;
    positions.set(node.id, {
      x: (R + jitter) * Math.cos(angle),
      y: (R + jitter) * Math.sin(angle),
    });
  });

  const index = new Map(nodes.map((node, i) => [node.id, i] as const));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  nodes.forEach((node, i) => {
    const p = positions.get(node.id)!;
    xs[i] = p.x;
    ys[i] = p.y;
  });

  const edgePairs = edges
    .map((e) => [index.get(e.from_keyword_id), index.get(e.to_keyword_id)] as const)
    .filter(([a, b]) => a !== undefined && b !== undefined) as Array<readonly [number, number]>;

  const iterations = Math.min(300, 80 + n * 2);
  const repulsion = 12000;
  const springLength = 120;
  const springK = 0.02;
  const gravity = 0.01;

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[i] - xs[j];
        let dy = ys[i] - ys[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const f = repulsion / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        fx[i] += dx * f;
        fy[i] += dy * f;
        fx[j] -= dx * f;
        fy[j] -= dy * f;
      }
    }

    for (const [a, b] of edgePairs) {
      let dx = xs[b] - xs[a];
      let dy = ys[b] - ys[a];
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = springK * (d - springLength);
      dx /= d;
      dy /= d;
      fx[a] += dx * f * 60;
      fy[a] += dy * f * 60;
      fx[b] -= dx * f * 60;
      fy[b] -= dy * f * 60;
    }

    for (let i = 0; i < n; i++) {
      fx[i] -= xs[i] * gravity * 60;
      fy[i] -= ys[i] * gravity * 60;
      const limit = 18 * cooling + 2;
      xs[i] += Math.max(-limit, Math.min(limit, fx[i] * 0.01));
      ys[i] += Math.max(-limit, Math.min(limit, fy[i] * 0.01));
    }
  }

  nodes.forEach((node, i) => positions.set(node.id, { x: xs[i], y: ys[i] }));
  return positions;
}

export default function GraphPage() {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(
    new Set(Object.keys(CATEGORIES))
  );
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [focusId, setFocusId] = useState<string>('');
  const [focusDepth, setFocusDepth] = useState(2);
  const [focusGraph, setFocusGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => r.json())
      .then(({ data, error }) => {
        if (error) throw new Error(error);
        setAllNodes(data.nodes ?? []);
        setAllEdges(data.edges ?? []);
      })
      .catch((err) => setError(err.message || 'Failed to load graph'))
      .finally(() => setLoading(false));
  }, []);

  // Focus mode: load a dependency-context subgraph around one keyword
  useEffect(() => {
    if (!focusId) {
      setFocusGraph(null);
      return;
    }
    setFocusLoading(true);
    fetch('/api/graph/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword_ids: [focusId], depth: focusDepth, max_nodes: 40 }),
    })
      .then((r) => r.json())
      .then(({ data, error }) => {
        if (error) throw new Error(error);
        setFocusGraph({
          nodes: (data.nodes ?? []).map((n: any) => ({
            ...n.keyword,
            depth: n.depth,
            relevance: n.relevance,
            via: n.via,
          })),
          edges: data.edges ?? [],
        });
      })
      .catch((err) => setError(err.message || 'Failed to load focus graph'))
      .finally(() => setFocusLoading(false));
  }, [focusId, focusDepth]);

  const { nodes, edges } = useMemo(() => {
    const baseNodes = focusGraph ? focusGraph.nodes : allNodes;
    const baseEdges = focusGraph ? focusGraph.edges : allEdges;

    const typedEdges = baseEdges.filter((e) =>
      enabledCategories.has(categoryOf(e.relation_type))
    );

    const hierarchyEdges: GraphEdge[] = [];
    if (showHierarchy && !focusGraph) {
      const ids = new Set(baseNodes.map((node) => node.id));
      for (const node of baseNodes) {
        if (node.parent_id && ids.has(node.parent_id)) {
          hierarchyEdges.push({
            id: `h-${node.id}`,
            from_keyword_id: node.parent_id,
            to_keyword_id: node.id,
            relation_type: 'hierarchy',
          });
        }
      }
    }

    return { nodes: baseNodes, edges: [...typedEdges, ...hierarchyEdges] };
  }, [allNodes, allEdges, focusGraph, enabledCategories, showHierarchy]);

  const positions = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);

  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of edges) {
      map.set(edge.from_keyword_id, (map.get(edge.from_keyword_id) ?? 0) + 1);
      map.set(edge.to_keyword_id, (map.get(edge.to_keyword_id) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!map.has(edge.from_keyword_id)) map.set(edge.from_keyword_id, new Set());
      if (!map.has(edge.to_keyword_id)) map.set(edge.to_keyword_id, new Set());
      map.get(edge.from_keyword_id)!.add(edge.to_keyword_id);
      map.get(edge.to_keyword_id)!.add(edge.from_keyword_id);
    }
    return map;
  }, [edges]);

  const viewBox = useMemo(() => {
    if (positions.size === 0) return '-300 -300 600 600';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const pad = 80;
    return `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  }, [positions]);

  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const activeId = hoverId ?? selectedId;
  const activeNeighbors = activeId ? neighbors.get(activeId) ?? new Set() : null;

  const toggleCategory = (key: string) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Waypoints className="w-6 h-6 text-slate-400" />
            Graph View
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {nodes.length} keywords · {edges.length} connections
            {focusGraph && ' · focused dependency context'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={focusId}
            onChange={(e) => {
              setFocusId(e.target.value);
              setSelectedId(e.target.value || null);
            }}
            className="px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 max-w-[220px]"
          >
            <option value="">Whole organization</option>
            {allNodes.map((node) => (
              <option key={node.id} value={node.id}>
                Focus: {node.title}
              </option>
            ))}
          </select>
          {focusId && (
            <select
              value={focusDepth}
              onChange={(e) => setFocusDepth(parseInt(e.target.value, 10))}
              className="px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-700"
            >
              {[1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>Depth {d}</option>
              ))}
            </select>
          )}
          {!focusGraph && (
            <button
              onClick={() => setShowHierarchy((v) => !v)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                showHierarchy
                  ? 'bg-slate-800 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Hierarchy
            </button>
          )}
        </div>
      </div>

      {/* Relation category filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <button
            key={key}
            onClick={() => toggleCategory(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              enabledCategories.has(key)
                ? 'bg-white border-slate-300 text-slate-700'
                : 'bg-slate-100 border-transparent text-slate-400'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color, opacity: enabledCategories.has(key) ? 1 : 0.3 }} />
            {cat.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-5">
        {/* Graph canvas */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 relative overflow-hidden" style={{ height: 640 }}>
          {focusLoading && (
            <div className="absolute inset-0 z-10 bg-white/60 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          )}
          {nodes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              No keywords yet — create some in the Keyword Map.
            </div>
          ) : (
            <svg viewBox={viewBox} className="w-full h-full">
              {/* Edges */}
              {edges.map((edge) => {
                const a = positions.get(edge.from_keyword_id);
                const b = positions.get(edge.to_keyword_id);
                if (!a || !b) return null;
                const isHierarchy = edge.relation_type === 'hierarchy';
                const color = isHierarchy ? '#cbd5e1' : CATEGORIES[categoryOf(edge.relation_type)].color;
                const dimmed =
                  activeId &&
                  edge.from_keyword_id !== activeId &&
                  edge.to_keyword_id !== activeId;
                return (
                  <g key={edge.id} opacity={dimmed ? 0.12 : isHierarchy ? 0.5 : 0.75}>
                    <line
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={color}
                      strokeWidth={isHierarchy ? 1 : 1.6}
                      strokeDasharray={isHierarchy ? '4 4' : undefined}
                    />
                    {!isHierarchy && !dimmed && activeId && (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 4}
                        textAnchor="middle"
                        fontSize={9}
                        fill={color}
                        className="select-none pointer-events-none"
                      >
                        {edge.relation_type}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const p = positions.get(node.id);
                if (!p) return null;
                const r = Math.min(22, 9 + (degree.get(node.id) ?? 0) * 1.5);
                const isActive = node.id === activeId;
                const isNeighbor = activeNeighbors?.has(node.id) ?? false;
                const dimmed = activeId && !isActive && !isNeighbor;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${p.x},${p.y})`}
                    opacity={dimmed ? 0.25 : 1}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverId(node.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <circle
                      r={r}
                      fill={node.status === 'archived' ? '#e2e8f0' : nodeColor(node.completeness_score ?? 0)}
                      fillOpacity={0.9}
                      stroke={isActive ? '#1d4ed8' : node.id === selectedId ? '#3b82f6' : '#fff'}
                      strokeWidth={isActive || node.id === selectedId ? 3 : 1.5}
                    />
                    {node.status === 'draft' && (
                      <circle r={r + 3.5} fill="none" stroke="#f59e0b" strokeWidth={1.2} strokeDasharray="3 3" />
                    )}
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={isActive ? 700 : 500}
                      fill="#334155"
                      className="select-none pointer-events-none"
                    >
                      {node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Side panel */}
        {selected && (
          <div className="w-80 shrink-0 bg-white rounded-2xl border border-slate-200 p-5 h-fit sticky top-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900 leading-tight">{selected.title}</h2>
              <button
                onClick={() => setSelectedId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold capitalize">
                {(selected.keyword_type || 'concept').replace('_', ' ')}
              </span>
              <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold capitalize">
                {selected.status}
              </span>
              <span
                className="px-2 py-1 rounded-lg text-xs font-semibold text-white"
                style={{ background: nodeColor(selected.completeness_score ?? 0) }}
              >
                {selected.completeness_score ?? 0}%
              </span>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              {selected.definition || <span className="text-slate-400 italic">No definition yet.</span>}
            </p>

            {selected.via && selected.via !== 'seed' && (
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                Reached via <span className="font-semibold">{selected.via}</span> at depth {selected.depth}
                {typeof selected.relevance === 'number' && ` · relevance ${selected.relevance}`}
              </div>
            )}

            <div className="text-xs text-slate-400">
              {(neighbors.get(selected.id)?.size ?? 0)} connections in view
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Link
                href={`/keywords/${selected.id}`}
                className="w-full text-center px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                Open detail page
              </Link>
              <button
                onClick={() => setFocusId(selected.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Crosshair className="w-4 h-4" />
                Focus dependencies here
              </button>
              {focusId && (
                <button
                  onClick={() => setFocusId('')}
                  className="w-full px-4 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Clear focus
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
