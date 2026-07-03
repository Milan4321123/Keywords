'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Gauge,
  Plus,
  Loader2,
  Trash2,
  Play,
  TrendingUp,
  LineChart,
  AlertTriangle,
} from 'lucide-react';
import { Keyword } from '@/types';

interface ColumnInfo {
  normalized_name: string;
  name: string;
  data_type: string;
  semantic_name?: string | null;
}

interface TableOption {
  id: string;
  label: string;
  columns: ColumnInfo[];
}

interface Metric {
  id: string;
  name: string;
  description: string | null;
  formula: string | null;
  aggregation: string;
  value_column: string | null;
  date_column: string | null;
  time_grain: string;
  caveats: string | null;
  keyword?: { id: string; title: string } | null;
  source_table?: { id: string; name: string; dataset?: { title: string } } | null;
}

interface Computation {
  mode: string;
  value: number | null;
  series: Array<{ period: string; value: number | null; anomaly?: boolean }>;
  matched_rows: number;
  missing: string[];
}

interface ForecastData {
  ok: boolean;
  reason?: string;
  model: string;
  forecasts: Array<{ period: string; value: number; lower: number; upper: number }>;
  assumptions: string[];
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Computation>>({});
  const [forecasts, setForecasts] = useState<Record<string, ForecastData>>({});

  const [form, setForm] = useState({
    name: '',
    keyword_id: '',
    source_table_id: '',
    aggregation: 'sum',
    value_column: '',
    date_column: '',
    time_grain: 'month',
    formula: '',
    caveats: '',
  });

  const load = async () => {
    const [metricsRes, keywordsRes, datasetsRes] = await Promise.all([
      fetch('/api/metrics').then((r) => r.json()),
      fetch('/api/keywords').then((r) => r.json()),
      fetch('/api/datasets').then((r) => r.json()),
    ]);
    setMetrics(metricsRes.data ?? []);
    setKeywords(keywordsRes.data ?? []);
    const options: TableOption[] = [];
    for (const dataset of datasetsRes.data ?? []) {
      for (const table of dataset.tables ?? []) {
        options.push({
          id: table.id,
          label: `${dataset.title} — ${table.name}`,
          columns: table.columns ?? [],
        });
      }
    }
    setTables(options);
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === form.source_table_id) ?? null,
    [tables, form.source_table_id]
  );

  const createMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          keyword_id: form.keyword_id || null,
          source_table_id: form.source_table_id || null,
          value_column: form.value_column || null,
          date_column: form.date_column || null,
        }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setShowForm(false);
      setForm({ ...form, name: '', formula: '', caveats: '' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create metric');
    } finally {
      setSaving(false);
    }
  };

  const compute = async (metric: Metric, mode: 'value' | 'series') => {
    setBusy(`${metric.id}-${mode}`);
    try {
      const response = await fetch(`/api/metrics/${metric.id}/compute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setResults((prev) => ({ ...prev, [metric.id]: data }));
    } catch (err: any) {
      setError(err.message || 'Compute failed');
    } finally {
      setBusy(null);
    }
  };

  const runForecast = async (metric: Metric) => {
    setBusy(`${metric.id}-forecast`);
    try {
      const response = await fetch('/api/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric_id: metric.id, horizon: 3 }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setForecasts((prev) => ({ ...prev, [metric.id]: data }));
    } catch (err: any) {
      setError(err.message || 'Forecast failed');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (metric: Metric) => {
    if (!confirm(`Delete metric "${metric.name}"?`)) return;
    await fetch(`/api/metrics/${metric.id}`, { method: 'DELETE' });
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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Gauge className="w-6 h-6 text-slate-400" />
            Metric Catalog
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Defined once, computed consistently — the AI uses these instead of guessing.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition-all"
        >
          <Plus className="w-4 h-4" /> New metric
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={createMetric} className="bg-white rounded-2xl border border-slate-200 p-5 grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Total Income"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Source table</label>
            <select
              value={form.source_table_id}
              onChange={(e) => setForm({ ...form, source_table_id: e.target.value, value_column: '', date_column: '' })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              <option value="">Select…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Linked keyword</label>
            <select
              value={form.keyword_id}
              onChange={(e) => setForm({ ...form, keyword_id: e.target.value })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              <option value="">None</option>
              {keywords.map((k) => (
                <option key={k.id} value={k.id}>{k.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Aggregation</label>
            <select
              value={form.aggregation}
              onChange={(e) => setForm({ ...form, aggregation: e.target.value })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              {['sum', 'count', 'avg', 'min', 'max'].map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Value column</label>
            <select
              value={form.value_column}
              onChange={(e) => setForm({ ...form, value_column: e.target.value })}
              disabled={!selectedTable}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              <option value="">{form.aggregation === 'count' ? 'Not needed for count' : 'Select…'}</option>
              {(selectedTable?.columns ?? [])
                .filter((c) => c.data_type === 'number')
                .map((c) => (
                  <option key={c.normalized_name} value={c.normalized_name}>
                    {c.name}{c.semantic_name ? ` [${c.semantic_name}]` : ''}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Date column</label>
            <select
              value={form.date_column}
              onChange={(e) => setForm({ ...form, date_column: e.target.value })}
              disabled={!selectedTable}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              <option value="">None</option>
              {(selectedTable?.columns ?? []).map((c) => (
                <option key={c.normalized_name} value={c.normalized_name}>
                  {c.name} ({c.data_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Time grain</label>
            <select
              value={form.time_grain}
              onChange={(e) => setForm({ ...form, time_grain: e.target.value })}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            >
              {['day', 'month', 'quarter', 'year'].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Business formula (human readable)</label>
            <input
              value={form.formula}
              onChange={(e) => setForm({ ...form, formula: e.target.value })}
              placeholder="Sum of all invoice amounts with status = paid"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create metric
            </button>
          </div>
        </form>
      )}

      {metrics.length === 0 && !showForm ? (
        <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-12 text-center">
          <Gauge className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No metrics defined yet.</p>
          <p className="text-sm text-slate-400 mt-1">
            Define "Total Income" once and the AI will always compute it the same way.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {metrics.map((metric) => {
            const result = results[metric.id];
            const forecast = forecasts[metric.id];
            return (
              <div key={metric.id} className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-bold text-slate-900">{metric.name}</h2>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-mono">
                        {metric.aggregation}({metric.value_column ?? 'rows'})
                        {metric.date_column ? ` / ${metric.time_grain}` : ''}
                      </span>
                      {metric.keyword && (
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-medium">
                          {metric.keyword.title}
                        </span>
                      )}
                    </div>
                    {metric.formula && <p className="text-sm text-slate-500 mt-1">{metric.formula}</p>}
                    {metric.source_table && (
                      <p className="text-xs text-slate-400 mt-1">
                        Source: {metric.source_table.dataset?.title} — {metric.source_table.name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => compute(metric, 'value')}
                      disabled={busy === `${metric.id}-value`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {busy === `${metric.id}-value` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      Compute
                    </button>
                    <button
                      onClick={() => compute(metric, 'series')}
                      disabled={busy === `${metric.id}-series` || !metric.date_column}
                      title={metric.date_column ? 'Time series' : 'Needs a date column'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <LineChart className="w-3.5 h-3.5" /> Trend
                    </button>
                    <button
                      onClick={() => runForecast(metric)}
                      disabled={busy === `${metric.id}-forecast` || !metric.date_column}
                      title={metric.date_column ? 'Forecast 3 periods ahead' : 'Needs a date column'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                    >
                      {busy === `${metric.id}-forecast` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
                      Forecast
                    </button>
                    <button
                      onClick={() => remove(metric)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {result && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {result.mode === 'value' ? (
                      <div className="flex items-baseline gap-3">
                        <span className="text-3xl font-bold text-slate-900">{formatValue(result.value)}</span>
                        <span className="text-xs text-slate-400">computed from {result.matched_rows} rows</span>
                      </div>
                    ) : (
                      <div className="flex items-end gap-1 overflow-x-auto pb-1">
                        {result.series.map((point) => {
                          const max = Math.max(...result.series.map((p) => p.value ?? 0), 1);
                          const height = Math.max(4, ((point.value ?? 0) / max) * 80);
                          return (
                            <div key={point.period} className="flex flex-col items-center gap-1 min-w-[52px]">
                              <span className="text-[10px] font-semibold text-slate-600">{formatValue(point.value)}</span>
                              <div
                                className={`w-8 rounded-t ${point.anomaly ? 'bg-red-400' : 'bg-blue-400'}`}
                                style={{ height }}
                                title={point.anomaly ? 'Anomaly: >2σ from mean' : undefined}
                              />
                              <span className="text-[9px] text-slate-400">{point.period}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {result.missing.length > 0 && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {result.missing.join(' ')}
                      </div>
                    )}
                  </div>
                )}

                {forecast && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {!forecast.ok ? (
                      <div className="flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {forecast.reason}
                      </div>
                    ) : (
                      <>
                        <div className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">
                          Forecast (projection, not fact)
                        </div>
                        <div className="flex gap-3 flex-wrap">
                          {forecast.forecasts.map((point) => (
                            <div key={point.period} className="px-3 py-2 rounded-xl bg-indigo-50/60 border border-indigo-100">
                              <div className="text-[10px] text-indigo-500 font-semibold">{point.period}</div>
                              <div className="text-lg font-bold text-slate-900">{formatValue(point.value)}</div>
                              <div className="text-[10px] text-slate-500">
                                {formatValue(point.lower)} – {formatValue(point.upper)} (95%)
                              </div>
                            </div>
                          ))}
                        </div>
                        <ul className="mt-2 space-y-0.5">
                          {forecast.assumptions.map((assumption, i) => (
                            <li key={i} className="text-[11px] text-slate-400">• {assumption}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
