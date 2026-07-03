'use client';

import React, { useEffect, useState } from 'react';
import {
  FileText,
  Plus,
  Loader2,
  Trash2,
  Download,
  Printer,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import { Keyword } from '@/types';

interface ReportRow {
  id: string;
  title: string;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  created_at: string;
  profiles?: { email: string; full_name: string | null } | null;
}

interface ReportDetail extends ReportRow {
  sections: any;
}

const REPORT_TYPES = ['monthly', 'weekly', 'income', 'expense', 'project', 'operations', 'risk', 'custom'];

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [selected, setSelected] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    report_type: 'monthly',
    from: '',
    to: '',
    keyword_ids: [] as string[],
  });

  const load = async () => {
    const [reportsRes, keywordsRes] = await Promise.all([
      fetch('/api/reports').then((r) => r.json()),
      fetch('/api/keywords').then((r) => r.json()),
    ]);
    setReports(reportsRes.data ?? []);
    setKeywords(keywordsRes.data ?? []);
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title || undefined,
          report_type: form.report_type,
          period: form.from && form.to ? { from: form.from, to: form.to } : undefined,
          keyword_ids: form.keyword_ids,
        }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setShowForm(false);
      await load();
      setSelected(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const open = async (id: string) => {
    const response = await fetch(`/api/reports/${id}`);
    const { data, error } = await response.json();
    if (!error) setSelected(data);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this report?')) return;
    await fetch(`/api/reports/${id}`, { method: 'DELETE' });
    if (selected?.id === id) setSelected(null);
    await load();
  };

  const formatValue = (v: number | null) =>
    v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  // ---- Detail view ----
  if (selected) {
    const s = selected.sections ?? {};
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="w-4 h-4" /> All reports
          </button>
          <div className="flex items-center gap-2">
            <a
              href={`/api/reports/${selected.id}/export?format=md`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> Markdown
            </a>
            <a
              href={`/api/reports/${selected.id}/export?format=csv`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </a>
            <a
              href={`/api/reports/${selected.id}/export?format=html`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"
            >
              <Printer className="w-3.5 h-3.5" /> HTML / print to PDF
            </a>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{selected.title}</h1>
            <p className="text-sm text-slate-400 mt-1">{s.scope}</p>
          </div>

          {s.executive_summary && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Executive summary</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{s.executive_summary}</p>
            </section>
          )}

          {(s.kpi_table ?? []).length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">KPI table</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-semibold">Metric</th>
                      <th className="px-4 py-2.5 font-semibold">Value</th>
                      <th className="px-4 py-2.5 font-semibold">Rows</th>
                      <th className="px-4 py-2.5 font-semibold">Recent trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {s.kpi_table.map((k: any) => (
                      <tr key={k.metric_id}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{k.metric}</td>
                        <td className="px-4 py-2.5 font-bold text-slate-900">{formatValue(k.value)}</td>
                        <td className="px-4 py-2.5 text-slate-500">{k.matched_rows}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {(k.trend ?? []).map((t: any) => `${t.period}: ${formatValue(t.value)}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {s.trends && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Trends</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{s.trends}</p>
            </section>
          )}

          {(s.anomalies ?? []).length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Anomalies</h2>
              <ul className="space-y-1">
                {s.anomalies.map((a: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {s.risks && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Risks</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{s.risks}</p>
            </section>
          )}

          {(s.missing_data ?? []).length > 0 && (
            <section className="bg-amber-50/60 border border-amber-100 rounded-xl p-4">
              <h2 className="text-sm font-bold text-amber-800 uppercase tracking-wide mb-2">Missing data</h2>
              <ul className="space-y-0.5">
                {s.missing_data.map((m: string, i: number) => (
                  <li key={i} className="text-xs text-amber-700">• {m}</li>
                ))}
              </ul>
            </section>
          )}

          {(s.recommended_actions ?? []).length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Recommended actions</h2>
              <ol className="space-y-1 list-decimal pl-5">
                {s.recommended_actions.map((a: string, i: number) => (
                  <li key={i} className="text-sm text-slate-600">{a}</li>
                ))}
              </ol>
            </section>
          )}

          <section className="pt-4 border-t border-slate-100 text-xs text-slate-400 space-y-1">
            <div>Keywords: {(s.keywords_used ?? []).map((k: any) => k.title).join(', ') || '—'}</div>
            <div>
              Sources: {(s.data_sources ?? []).slice(0, 8).map((d: any) => d.name).join(' · ') || '—'}
            </div>
            <div>{(s.evidence ?? []).length} evidence row references stored with this report.</div>
          </section>
        </div>
      </div>
    );
  }

  // ---- List view ----
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileText className="w-6 h-6 text-slate-400" />
            Reports
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Every number computed from your data; every source referenced.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" /> Generate report
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {showForm && (
        <form onSubmit={generate} className="bg-white rounded-2xl border border-slate-200 p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Title (optional)</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Auto-generated if empty"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Type</label>
            <select
              value={form.report_type}
              onChange={(e) => setForm({ ...form, report_type: e.target.value })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              {REPORT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Period from</label>
            <input
              type="date"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Period to</label>
            <input
              type="date"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Scope keywords (optional)
            </label>
            <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-xl p-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
              {keywords.map((k) => (
                <label key={k.id} className="flex items-center gap-2 text-xs text-slate-600 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.keyword_ids.includes(k.id)}
                    onChange={() =>
                      setForm({
                        ...form,
                        keyword_ids: form.keyword_ids.includes(k.id)
                          ? form.keyword_ids.filter((id) => id !== k.id)
                          : [...form.keyword_ids, k.id],
                      })
                    }
                  />
                  <span className="truncate">{k.title}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200">
              Cancel
            </button>
            <button type="submit" disabled={generating} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}
              {generating ? 'Computing KPIs & writing…' : 'Generate'}
            </button>
          </div>
        </form>
      )}

      {reports.length === 0 && !showForm ? (
        <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-12 text-center">
          <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No reports yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {reports.map((report) => (
            <div key={report.id} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50/60">
              <button onClick={() => open(report.id)} className="text-left min-w-0 flex-1">
                <div className="font-medium text-slate-800 truncate">{report.title}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {report.report_type}
                  {report.period_start && ` · ${report.period_start} → ${report.period_end}`}
                  {' · '}
                  {new Date(report.created_at).toLocaleString()} ·{' '}
                  {report.profiles?.full_name || report.profiles?.email || ''}
                </div>
              </button>
              <button
                onClick={() => remove(report.id)}
                className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
