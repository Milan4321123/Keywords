'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Columns3, Database, Loader2, RefreshCw, Save, Search, Table2 } from 'lucide-react';
import AiTableDesigner from './AiTableDesigner';
import CaptureForm from './CaptureForm';
import { CaptureField, CaptureFormDef } from '@/lib/capture-types';
import { DatasetRow } from '@/types';

interface Metric {
  id: string;
  name: string;
  formula: string | null;
  aggregation: string;
  value_column: string | null;
  keyword?: { id: string; title: string } | null;
  source_table?: { id: string; name: string } | null;
}

interface MetricResult {
  value: number | null;
  matched_rows: number;
  missing: string[];
}

function inputValue(value: unknown, field: CaptureField): string {
  if (value == null) return '';
  if (field.data_type === 'date' && /timestamp/.test(field.semantic ?? '')) {
    return String(value).slice(0, 16);
  }
  return String(value);
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  return String(value);
}

function isServerManaged(field: CaptureField): boolean {
  return field.auto === 'user' || field.auto === 'weekday' || field.auto === 'evidence';
}

function rowMatches(row: DatasetRow, draft: Record<string, unknown> | undefined, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = Object.values(draft ?? row.data)
    .filter((value) => value != null)
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(query.trim().toLocaleLowerCase());
}

export default function KeywordDataWorkspace({
  keywordId,
  keywordTitle,
}: {
  keywordId: string;
  keywordTitle: string;
}) {
  const [forms, setForms] = useState<CaptureFormDef[]>([]);
  const [rows, setRows] = useState<Record<string, DatasetRow[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [metricResults, setMetricResults] = useState<Record<string, MetricResult>>({});
  const [loading, setLoading] = useState(true);
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [compact, setCompact] = useState(true);
  const [searchByTable, setSearchByTable] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshRows = useCallback(async (tableId: string) => {
    const response = await fetch(`/api/datasets/rows?table_id=${encodeURIComponent(tableId)}&limit=250`);
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(json.error || 'Failed to load rows');
    const tableRows = (json.data ?? []) as DatasetRow[];
    setRows((previous) => ({ ...previous, [tableId]: tableRows }));
    setDrafts((previous) => {
      const next = { ...previous };
      for (const row of tableRows) next[row.id] = { ...row.data };
      return next;
    });
  }, []);

  const calculateMetrics = useCallback(async (items: Metric[]) => {
    setCalculating(true);
    try {
      const computed = await Promise.all(
        items.map(async (metric) => {
          const response = await fetch(`/api/metrics/${metric.id}/compute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'value' }),
          });
          const json = await response.json();
          if (!response.ok || json.error) throw new Error(json.error || `Failed to calculate ${metric.name}`);
          return [metric.id, json.data as MetricResult] as const;
        })
      );
      setMetricResults(Object.fromEntries(computed));
    } finally {
      setCalculating(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formsResponse, metricsResponse] = await Promise.all([
        fetch(`/api/capture?keyword_id=${encodeURIComponent(keywordId)}`),
        fetch('/api/metrics'),
      ]);
      const [formsJson, metricsJson] = await Promise.all([formsResponse.json(), metricsResponse.json()]);
      if (!formsResponse.ok || formsJson.error) throw new Error(formsJson.error || 'Failed to load tables');
      if (!metricsResponse.ok || metricsJson.error) throw new Error(metricsJson.error || 'Failed to load metrics');

      const nextForms = (formsJson.data?.forms ?? []) as CaptureFormDef[];
      const tableIds = new Set(nextForms.map((form) => form.dataset_table_id));
      const linkedMetrics = ((metricsJson.data ?? []) as Metric[]).filter(
        (metric) => metric.keyword?.id === keywordId || Boolean(metric.source_table?.id && tableIds.has(metric.source_table.id))
      );
      setForms(nextForms);
      setMetrics(linkedMetrics);
      setDirty(new Set());

      await Promise.all(nextForms.map((form) => refreshRows(form.dataset_table_id)));
      if (linkedMetrics.length > 0) await calculateMetrics(linkedMetrics);
      else setMetricResults({});
    } catch (err: any) {
      setError(err.message || 'Daten konnten nicht geladen werden · Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [calculateMetrics, keywordId, refreshRows]);

  useEffect(() => {
    load();
  }, [load]);

  const fieldsByTable = useMemo(
    () => new Map(forms.map((form) => [form.dataset_table_id, form.fields] as const)),
    [forms]
  );

  const changeCell = (rowId: string, field: string, value: unknown) => {
    setDrafts((previous) => ({
      ...previous,
      [rowId]: { ...(previous[rowId] ?? {}), [field]: value },
    }));
    setDirty((previous) => new Set(previous).add(rowId));
  };

  const valuesForRow = (tableId: string, row: DatasetRow) => {
    const fields = fieldsByTable.get(tableId) ?? [];
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      if (!isServerManaged(field)) values[field.field] = drafts[row.id]?.[field.field] ?? '';
    }
    return values;
  };

  const persistRow = async (tableId: string, row: DatasetRow): Promise<DatasetRow> => {
    const response = await fetch('/api/datasets/rows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_id: row.id, values: valuesForRow(tableId, row) }),
    });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(json.error || 'Failed to save row');
    return json.data as DatasetRow;
  };

  const applySavedRow = (tableId: string, saved: DatasetRow) => {
    setRows((previous) => ({
      ...previous,
      [tableId]: (previous[tableId] ?? []).map((item) => item.id === saved.id ? saved : item),
    }));
    setDrafts((previous) => ({ ...previous, [saved.id]: { ...saved.data } }));
    setDirty((previous) => {
      const next = new Set(previous);
      next.delete(saved.id);
      return next;
    });
  };

  const saveRow = async (tableId: string, row: DatasetRow) => {
    setSavingRow(row.id);
    setError(null);
    try {
      applySavedRow(tableId, await persistRow(tableId, row));
      await calculateMetrics(metrics);
    } catch (err: any) {
      setError(err.message || 'Zeile konnte nicht gespeichert werden · Failed to save row');
    } finally {
      setSavingRow(null);
    }
  };

  const saveAll = async (tableId: string) => {
    const pending = (rows[tableId] ?? []).filter((row) => dirty.has(row.id));
    if (pending.length === 0) return;
    setSavingAll(true);
    setError(null);
    try {
      for (const row of pending) applySavedRow(tableId, await persistRow(tableId, row));
      await calculateMetrics(metrics);
    } catch (err: any) {
      setError(err.message || 'Änderungen konnten nicht gespeichert werden · Failed to save changes');
    } finally {
      setSavingAll(false);
    }
  };

  const renderCell = (tableId: string, row: DatasetRow, field: CaptureField) => {
    const value = drafts[row.id]?.[field.field] ?? row.data[field.field];
    if (isServerManaged(field)) {
      return <span className="block px-2 py-2 text-xs text-slate-400 min-w-28">{displayValue(value)}</span>;
    }

    const cellClass = `w-full ${compact ? 'min-w-28 px-2 py-1 text-[11px]' : 'min-w-36 px-2.5 py-2 text-xs'} bg-transparent border border-transparent rounded-md hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-200`;
    if (field.data_type === 'boolean') {
      return (
        <div className="min-w-20 px-2 py-2 text-center">
          <input
            type="checkbox"
            checked={value === true || value === 'true'}
            onChange={(event) => changeCell(row.id, field.field, event.target.checked)}
            className="w-4 h-4 rounded border-slate-300"
          />
        </div>
      );
    }
    if (field.options?.length) {
      return (
        <select
          value={inputValue(value, field)}
          onChange={(event) => changeCell(row.id, field.field, event.target.value)}
          className={cellClass}
        >
          <option value="">—</option>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }
    const timestamp = field.data_type === 'date' && /timestamp/.test(field.semantic ?? '');
    return (
      <input
        type={field.data_type === 'date' ? (timestamp ? 'datetime-local' : 'date') : 'text'}
        inputMode={field.data_type === 'number' ? 'decimal' : undefined}
        value={inputValue(value, field)}
        onChange={(event) => changeCell(row.id, field.field, event.target.value)}
        className={`${cellClass} ${field.data_type === 'number' ? 'text-right font-mono' : ''}`}
        title={field.description ?? field.label}
      />
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="p-5 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-500" />
            Daten von {keywordTitle} · Data
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Werte direkt eingeben oder bestehende Tabellenzellen bearbeiten. Berechnungen aktualisieren sich nach dem Speichern.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Aktualisieren · Refresh
        </button>
      </div>

      {error && <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      <details className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-600 hover:text-blue-700">
          + Neue Tabelle mit KI entwerfen · Design another table
        </summary>
        <div className="p-4 pt-0">
          <AiTableDesigner onCreated={load} defaultKeywordId={keywordId} />
        </div>
      </details>

      {metrics.length > 0 && (
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
              <Calculator className="w-4 h-4" /> Verknüpfte Berechnungen · Linked calculations
            </h3>
            {calculating && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {metrics.map((metric) => {
              const result = metricResults[metric.id];
              return (
                <div key={metric.id} className="rounded-xl bg-white border border-indigo-100 p-3">
                  <div className="text-xs font-semibold text-slate-600">{metric.name}</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {result?.value == null ? '—' : result.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 truncate" title={metric.formula ?? ''}>
                    {metric.formula || `${metric.aggregation}(${metric.value_column ?? 'rows'})`}
                    {result ? ` · ${result.matched_rows} rows` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {forms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-12 px-6 text-center">
          <Table2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">Noch keine Tabelle verknüpft · No linked table yet</p>
          <p className="text-xs text-slate-400 mt-1">Erstelle oben eine Tabelle; dieser Begriff ist bereits vorausgewählt.</p>
        </div>
      ) : (
        forms.map((form) => {
          const tableRows = rows[form.dataset_table_id] ?? [];
          const visibleRows = tableRows.filter((row) => rowMatches(row, drafts[row.id], searchByTable[form.dataset_table_id] ?? ''));
          const dirtyCount = tableRows.filter((row) => dirty.has(row.id)).length;
          return (
          <section key={form.dataset_table_id} className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-800">{form.dataset_title}</h3>
                  <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-500">
                    {form.fields.length} columns
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-500">
                    {visibleRows.length}{visibleRows.length !== tableRows.length ? ` / ${tableRows.length}` : ''} rows
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{form.table_name}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="relative min-w-52 flex-1 lg:flex-none">
                  <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    value={searchByTable[form.dataset_table_id] ?? ''}
                    onChange={(event) => setSearchByTable((previous) => ({ ...previous, [form.dataset_table_id]: event.target.value }))}
                    placeholder="Zeilen durchsuchen…"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <button
                  onClick={() => setCompact((value) => !value)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  title="Row density"
                >
                  <Columns3 className="w-3.5 h-3.5" /> {compact ? 'Compact' : 'Comfortable'}
                </button>
                <button
                  onClick={() => saveAll(form.dataset_table_id)}
                  disabled={dirtyCount === 0 || savingAll || savingRow != null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {savingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {dirtyCount > 0 ? `Save all (${dirtyCount})` : 'All saved'}
                </button>
              </div>
            </div>

            <details className="border-b border-slate-100">
              <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-blue-700 hover:bg-blue-50/50">
                + Neuer Eintrag · Add row
              </summary>
              <div className="px-4 pb-4">
                <CaptureForm
                  form={form}
                  keywordId={keywordId}
                  onSaved={async () => {
                    await refreshRows(form.dataset_table_id);
                    await calculateMetrics(metrics);
                  }}
                />
              </div>
            </details>

            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-20 shadow-sm">
                  <tr className="bg-slate-50/70">
                    <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-400 border-r border-slate-200">#</th>
                    {form.fields.map((field) => (
                      <th key={field.field} title={field.description ?? field.field} className="bg-slate-50 px-2 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap border-r border-slate-100">
                        {field.label}
                        <span className="ml-1 normal-case font-normal text-slate-300">{isServerManaged(field) ? 'auto' : field.data_type}</span>
                      </th>
                    ))}
                    <th className="sticky right-0 z-30 bg-slate-50 px-3 py-2 text-right text-[10px] uppercase tracking-wide text-slate-400">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((row) => (
                    <tr key={row.id} className={dirty.has(row.id) ? 'bg-amber-50/50' : 'bg-white hover:bg-slate-50/40'}>
                      <td className={`sticky left-0 z-10 bg-inherit px-3 ${compact ? 'py-1' : 'py-2'} text-[11px] font-mono text-slate-400 border-r border-slate-200`}>{row.row_index}</td>
                      {form.fields.map((field) => (
                        <td key={field.field} className={`${compact ? 'p-0.5' : 'p-1'} border-r border-slate-100 align-middle`}>
                          {renderCell(form.dataset_table_id, row, field)}
                        </td>
                      ))}
                      <td className="sticky right-0 bg-inherit px-2 py-1 text-right border-l border-slate-100">
                        <button
                          onClick={() => saveRow(form.dataset_table_id, row)}
                          disabled={!dirty.has(row.id) || savingRow != null || savingAll}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-blue-600 text-white disabled:bg-slate-100 disabled:text-slate-300"
                        >
                          {savingRow === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Speichern
                        </button>
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={form.fields.length + 2} className="py-10 text-center text-sm text-slate-400">Keine passenden Zeilen · No matching rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          );
        })
      )}
    </div>
  );
}
