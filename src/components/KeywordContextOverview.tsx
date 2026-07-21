'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Calculator,
  Database,
  FileText,
  Link2,
  ListChecks,
  Loader2,
} from 'lucide-react';
import { Asset, Keyword, KeywordRelation } from '@/types';
import { CaptureFormDef } from '@/lib/capture-types';

interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  is_blocked: boolean;
  keyword?: { id: string } | null;
  assignee?: { profiles?: { full_name?: string | null; email?: string | null } | null } | null;
}

interface MetricSummary {
  id: string;
  name: string;
  formula: string | null;
  keyword?: { id: string } | null;
  source_table?: { id: string } | null;
}

interface MetricValue {
  value: number | null;
  matched_rows: number;
}

function relationText(relation: KeywordRelation, keyword: Keyword): string {
  const row = relation as any;
  if (relation.from_keyword_id === keyword.id) {
    return `${keyword.title} ${relation.relation_type} ${row.to_keyword?.title ?? 'connected concept'}`;
  }
  return `${row.from_keyword?.title ?? 'Connected concept'} ${relation.relation_type} ${keyword.title}`;
}

export default function KeywordContextOverview({
  keyword,
  children,
  relations,
  assets,
}: {
  keyword: Keyword;
  children: Keyword[];
  relations: KeywordRelation[];
  assets: Asset[];
}) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [forms, setForms] = useState<CaptureFormDef[]>([]);
  const [metrics, setMetrics] = useState<MetricSummary[]>([]);
  const [values, setValues] = useState<Record<string, MetricValue>>({});
  const [loading, setLoading] = useState(true);
  const contextKeywordIds = useMemo(() => [keyword.id, ...children.map((child) => child.id)], [children, keyword.id]);
  const contextKeywordKey = contextKeywordIds.join(',');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [taskResponse, captureResponses, metricResponse] = await Promise.all([
          fetch('/api/tasks'),
          Promise.all(contextKeywordIds.map((id) => fetch(`/api/capture?keyword_id=${encodeURIComponent(id)}`))),
          fetch('/api/metrics'),
        ]);
        const [taskJson, captureJsons, metricJson] = await Promise.all([
          taskResponse.json(), Promise.all(captureResponses.map((response) => response.json())), metricResponse.json(),
        ]);
        if (cancelled) return;
        const allowedKeywordIds = new Set(contextKeywordIds);
        const nextTasks = ((taskJson.data ?? []) as TaskSummary[]).filter((task) => task.keyword?.id && allowedKeywordIds.has(task.keyword.id));
        const nextForms = captureJsons.flatMap((json) => (json.data?.forms ?? []) as CaptureFormDef[]);
        const tableIds = new Set(nextForms.map((form) => form.dataset_table_id));
        const nextMetrics = ((metricJson.data ?? []) as MetricSummary[]).filter(
          (metric) => Boolean(metric.keyword?.id && allowedKeywordIds.has(metric.keyword.id)) || Boolean(metric.source_table?.id && tableIds.has(metric.source_table.id))
        );
        setTasks(nextTasks);
        setForms(nextForms);
        setMetrics(nextMetrics);
        const computed = await Promise.all(nextMetrics.slice(0, 8).map(async (metric) => {
          const response = await fetch(`/api/metrics/${metric.id}/compute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'value' }),
          });
          const json = await response.json();
          return [metric.id, json.data as MetricValue] as const;
        }));
        if (!cancelled) setValues(Object.fromEntries(computed));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [contextKeywordKey]);

  const openTasks = useMemo(() => tasks.filter((task) => !['done', 'cancelled'].includes(task.status)), [tasks]);
  const blockedTasks = useMemo(() => openTasks.filter((task) => task.is_blocked || task.status === 'blocked'), [openTasks]);
  const rowCount = forms.reduce((sum, form) => sum + form.row_count, 0);
  const documentExcerpt = assets.find((asset) => asset.extracted_text)?.extracted_text?.slice(0, 420);
  const prompt = encodeURIComponent(`Act as project manager for ${keyword.title}. Give me the current status, blockers, risks, budget signals, responsible next actions, and missing evidence.`);

  return (
    <div className="border-b border-slate-200 bg-slate-50/60 p-5 sm:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <BrainCircuit className="w-4 h-4 text-indigo-600" /> Company context available to AI
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Definitions, rules, dependencies, tasks, tables, metrics, and evidence are combined for grounded answers.
          </p>
        </div>
        <Link
          href={`/chat?keyword_id=${keyword.id}&mode=report&prompt=${prompt}`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
        >
          Ask AI project manager <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
        {[
          { label: 'Sub-concepts', value: children.length, icon: BrainCircuit },
          { label: 'Relations', value: relations.length, icon: Link2 },
          { label: 'Open tasks', value: openTasks.length, icon: ListChecks },
          { label: 'Blocked', value: blockedTasks.length, icon: AlertTriangle },
          { label: 'Data rows', value: rowCount, icon: Database },
          { label: 'Metrics', value: metrics.length, icon: Calculator },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <item.icon className="w-3.5 h-3.5 text-slate-400 mb-2" />
            <div className="text-xl font-bold text-slate-900">{loading ? '—' : item.value}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Meaning and operating rules</h3>
          {keyword.explanation && <p className="text-sm leading-relaxed text-slate-700">{keyword.explanation}</p>}
          {keyword.rules?.length ? (
            <div className="space-y-1.5">
              {keyword.rules.slice(0, 5).map((rule) => (
                <div key={rule} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {rule}
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-slate-400">No approved business rules yet.</p>}
          {keyword.examples?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {keyword.examples.slice(0, 5).map((example) => <span key={example} className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[11px]">{example}</span>)}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Operational signals</h3>
          {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : (
            <>
              {metrics.slice(0, 6).map((metric) => (
                <div key={metric.id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-700 truncate">{metric.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{metric.formula}</div>
                  </div>
                  <span className="font-mono text-sm font-bold text-slate-900">
                    {values[metric.id]?.value == null ? '—' : values[metric.id].value!.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {metrics.length === 0 && <p className="text-xs text-slate-400">No metrics linked yet.</p>}
            </>
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-2"><ListChecks className="w-3.5 h-3.5" /> Next work</h3>
          <div className="space-y-2">
            {openTasks.slice(0, 4).map((task) => (
              <div key={task.id} className="text-xs">
                <div className="font-semibold text-slate-700">{task.title}</div>
                <div className="text-[10px] text-slate-400">{task.priority}{task.due_date ? ` · due ${task.due_date}` : ''}</div>
              </div>
            ))}
            {!loading && openTasks.length === 0 && <p className="text-xs text-slate-400">No open tasks linked.</p>}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-2"><Link2 className="w-3.5 h-3.5" /> Connected concepts</h3>
          <div className="space-y-1.5">
            {relations.slice(0, 5).map((relation) => <p key={relation.id} className="text-xs text-slate-600">{relationText(relation, keyword)}</p>)}
            {relations.length === 0 && <p className="text-xs text-slate-400">No relations linked.</p>}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-2"><FileText className="w-3.5 h-3.5" /> Evidence text</h3>
          {documentExcerpt ? <p className="text-xs leading-relaxed text-slate-600 line-clamp-6">{documentExcerpt}</p> : <p className="text-xs text-slate-400">No extracted document text linked yet.</p>}
        </section>
      </div>
    </div>
  );
}
