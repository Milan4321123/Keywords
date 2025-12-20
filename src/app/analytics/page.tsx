'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dataset, DatasetRow, DatasetTable, AnalyticsAskResponse } from '@/types';

type TableOption = { dataset: Dataset; table: DatasetTable };

export default function AnalyticsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string>('');
  const [toolResults, setToolResults] = useState<AnalyticsAskResponse['tool_results']>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>('');
  const [evidenceRowsByKey, setEvidenceRowsByKey] = useState<Record<string, DatasetRow[]>>({});

  const tableOptions: TableOption[] = useMemo(() => {
    const out: TableOption[] = [];
    for (const d of datasets) {
      for (const t of d.tables ?? []) out.push({ dataset: d, table: t });
    }
    return out;
  }, [datasets]);

  const selected = useMemo(() => tableOptions.find((t) => t.table.id === selectedTableId) ?? null, [tableOptions, selectedTableId]);

  const loadDatasets = async () => {
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/datasets');
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load datasets');
      setDatasets(json.data ?? []);
      if (!selectedTableId && (json.data?.[0]?.tables?.[0]?.id ?? null)) {
        setSelectedTableId(json.data[0].tables[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load datasets');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDatasets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/datasets/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Upload failed');
      await loadDatasets();
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateDemo = async () => {
    setError('');
    setSeeding(true);
    try {
      const res = await fetch('/api/datasets/demo', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to create demo dataset');
      await loadDatasets();
      if (json.data?.table_id) setSelectedTableId(json.data.table_id);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create demo dataset');
    } finally {
      setSeeding(false);
    }
  };

  const handleAsk = async () => {
    if (!selectedTableId || !question.trim() || asking) return;
    setError('');
    setAsking(true);
    setAnswer('');
    setToolResults([]);
    setEvidenceRowsByKey({});
    try {
      const res = await fetch('/api/analytics/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_table_id: selectedTableId, question }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Ask failed');
      setAnswer(json.answer ?? '');
      setToolResults(json.tool_results ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Ask failed');
    } finally {
      setAsking(false);
    }
  };

  const fetchEvidenceRows = async (key: string, rowIds: string[]) => {
    if (evidenceRowsByKey[key]) return;
    try {
      const res = await fetch('/api/datasets/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: rowIds }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to fetch evidence rows');
      setEvidenceRowsByKey((prev) => ({ ...prev, [key]: json.data ?? [] }));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to fetch evidence rows');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-500">Grounded answers computed from your uploaded tables</p>
          </div>
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
            ← Back to Knowledge Base
          </Link>
        </div>
      </header>

      {error && (
        <div className="max-w-6xl mx-auto px-6 pt-4">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
            {error.includes('Missing analytics tables') ? (
              <span>
                {error} (run <span className="font-mono">supabase/analytics.sql</span> or the DATASETS section in{' '}
                <span className="font-mono">supabase/schema.sql</span>)
              </span>
            ) : (
              error
            )}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1 space-y-6">
          <div className="bg-white border rounded-xl p-4">
            <h2 className="font-medium text-gray-800 mb-2">Upload Dataset</h2>
            <p className="text-sm text-gray-500 mb-3">Upload an Excel/CSV file to create queryable tables.</p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.currentTarget.value = '';
              }}
              className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
            />
            {uploading && <p className="text-xs text-gray-500 mt-2">Uploading…</p>}
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-gray-700 mb-2">No file handy?</p>
              <button
                onClick={handleCreateDemo}
                disabled={seeding}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-900 text-white disabled:opacity-50"
              >
                {seeding ? 'Creating demo…' : 'Create demo dataset'}
              </button>
              <p className="text-xs text-gray-500 mt-2">Creates 2 projects and multiple trades to test filters.</p>
            </div>
          </div>

          <div className="bg-white border rounded-xl p-4">
            <h2 className="font-medium text-gray-800 mb-2">Select Table</h2>
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : tableOptions.length === 0 ? (
                <p className="text-sm text-gray-500">No datasets yet. Upload an Excel/CSV file.</p>
            ) : (
              <>
                <select
                  value={selectedTableId}
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  {tableOptions.map((opt) => (
                    <option key={opt.table.id} value={opt.table.id}>
                      {opt.dataset.title} — {opt.table.name}
                    </option>
                  ))}
                </select>
                {selected && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500">
                      Rows: {selected.table.row_count} • Columns: {selected.table.column_count}
                    </p>
                    <div className="mt-2 max-h-48 overflow-auto border rounded-lg p-2">
                      {(selected.table.columns ?? []).map((c) => (
                        <div key={c.id} className="text-xs text-gray-700">
                          <span className="font-mono">{c.normalized_name}</span>{' '}
                          <span className="text-gray-400">({c.data_type})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="lg:col-span-2 space-y-4">
          <div className="bg-white border rounded-xl p-4">
            <h2 className="font-medium text-gray-800 mb-2">Ask (Computed)</h2>
            <p className="text-sm text-gray-500 mb-3">
              Examples: “Total amount by trade for project Riverside Tower in 2025-11”, “Avg approval_time_hours by supplier”, “Unpaid total by project”.
            </p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              className="w-full border rounded-lg p-3 text-sm"
              placeholder="Ask a question grounded in this table…"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleAsk}
                disabled={asking || !selectedTableId || !question.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {asking ? 'Computing…' : 'Ask'}
              </button>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>

          {(answer || (toolResults?.length ?? 0) > 0) && (
            <div className="bg-white border rounded-xl p-4">
              <h2 className="font-medium text-gray-800 mb-3">Answer</h2>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">{answer}</div>
              {(toolResults?.length ?? 0) > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gray-600">Evidence / tool trace</summary>
                  <div className="mt-2 space-y-3">
                    {toolResults!.map((tr, idx) => (
                      <div key={idx} className="border rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-2">
                          Tool: <span className="font-mono">{tr.tool}</span>
                        </div>
                        {tr.tool === 'table_query' && tr.output?.result?.evidence?.used_row_ids?.length > 0 && (
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-xs text-gray-600">
                              Evidence rows: <span className="font-mono">{tr.output.result.evidence.used_row_ids.length}</span>
                            </div>
                            <button
                              onClick={() =>
                                fetchEvidenceRows(`tool_${idx}`, (tr.output.result.evidence.used_row_ids as string[]).slice(0, 50))
                              }
                              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                            >
                              Load rows
                            </button>
                          </div>
                        )}
                        <div className="text-xs text-gray-700">
                          <div className="font-medium mb-1">Input</div>
                          <pre className="bg-gray-50 rounded p-2 overflow-auto">{JSON.stringify(tr.input, null, 2)}</pre>
                          <div className="font-medium mt-2 mb-1">Output (includes row IDs)</div>
                          <pre className="bg-gray-50 rounded p-2 overflow-auto">{JSON.stringify(tr.output, null, 2)}</pre>
                        </div>
                        {evidenceRowsByKey[`tool_${idx}`]?.length > 0 && (
                          <div className="mt-3">
                            <div className="text-xs font-medium text-gray-700 mb-1">Rows (first 50)</div>
                            <pre className="bg-gray-50 rounded p-2 overflow-auto text-xs">
                              {JSON.stringify(evidenceRowsByKey[`tool_${idx}`], null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
