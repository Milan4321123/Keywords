'use client';

import React, { useState } from 'react';
import { Sparkles, Loader2, Check, X, Wand2, Table2, AlertTriangle } from 'lucide-react';

interface MetricSpec {
  name: string;
  description: string | null;
  formula: string;
  source_table_id: string;
  aggregation: string;
  value_column: string | null;
  date_column: string | null;
  filters: Array<Record<string, unknown>>;
  time_grain: string;
  caveats: string | null;
}

interface Proposal {
  spec: MetricSpec;
  test: { value: number | null; matched_rows: number; missing: string[] };
}

interface DesignResult {
  proposals: Proposal[];
  note: string | null;
  rejected: string[];
  tables: Array<{ id: string; label: string }>;
}

export default function AiMetricDesigner({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<'design' | 'suggest' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const design = async (suggest: boolean) => {
    setBusy(suggest ? 'suggest' : 'design');
    setError(null);
    setResult(null);
    setAccepted(new Set());
    try {
      const response = await fetch('/api/ai/design-metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suggest ? { suggest: true } : { description }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Fehlgeschlagen · Failed');
    } finally {
      setBusy(null);
    }
  };

  const accept = async (proposal: Proposal) => {
    setBusy(proposal.spec.name);
    setError(null);
    try {
      const response = await fetch('/api/ai/design-metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, spec: proposal.spec }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setAccepted((prev) => new Set(prev).add(proposal.spec.name));
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Speichern fehlgeschlagen · Save failed');
    } finally {
      setBusy(null);
    }
  };

  const tableLabel = (id: string) =>
    result?.tables.find((t) => t.id === id)?.label ?? id.slice(0, 8);

  const formatValue = (v: number | null) =>
    v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="bg-gradient-to-br from-indigo-50/80 to-white rounded-2xl border border-indigo-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-bold text-indigo-800">
          <Wand2 className="w-4 h-4" />
          Die Mathematik des Geschäfts mit KI definieren · Define your business math with AI
        </span>
        <span className="text-xs font-medium text-indigo-400">{open ? 'schließen' : 'öffnen'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            Beschreibe die Rechnung in eigenen Worten — die KI schreibt die Formel gegen deine echten
            Tabellen und rechnet sie sofort zur Probe. · Describe the calculation in plain words — the AI
            writes the formula against your real tables and test-computes it immediately.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={'z. B. "Gesamteinnahmen pro Tag aus der Kasse" oder "Wie viel Verlust durch abgelaufene Ware pro Woche"'}
              className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
            />
            <div className="flex sm:flex-col gap-2">
              <button
                onClick={() => design(false)}
                disabled={!description.trim() || busy != null}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-all"
              >
                {busy === 'design' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Formel schreiben
              </button>
              <button
                onClick={() => design(true)}
                disabled={busy != null}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-all"
                title="KI schlägt sinnvolle Kennzahlen aus deinen Daten vor"
              >
                {busy === 'suggest' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Vorschläge
              </button>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {result.note && <p className="text-xs text-slate-600 italic">{result.note}</p>}

              {result.proposals.map((proposal) => {
                const isAccepted = accepted.has(proposal.spec.name);
                return (
                  <div key={proposal.spec.name} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm">{proposal.spec.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{proposal.spec.formula}</div>
                        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-400">
                          <Table2 className="w-3 h-3" />
                          {tableLabel(proposal.spec.source_table_id)}
                          <span className="font-mono">
                            · {proposal.spec.aggregation}({proposal.spec.value_column ?? 'rows'})
                            {proposal.spec.date_column ? ` / ${proposal.spec.time_grain}` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-bold text-emerald-600 uppercase">Probe-Rechnung</div>
                        <div className="text-xl font-bold text-slate-900">{formatValue(proposal.test.value)}</div>
                        <div className="text-[10px] text-slate-400">{proposal.test.matched_rows} Zeilen · rows</div>
                      </div>
                    </div>

                    {proposal.spec.caveats && (
                      <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                        {proposal.spec.caveats}
                      </p>
                    )}
                    {proposal.test.missing.length > 0 && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {proposal.test.missing.join(' ')}
                      </p>
                    )}

                    <div className="mt-3 flex gap-2">
                      {isAccepted ? (
                        <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Check className="w-3.5 h-3.5" /> Im Katalog gespeichert · Saved
                        </span>
                      ) : (
                        <button
                          onClick={() => accept(proposal)}
                          disabled={busy != null}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-all"
                        >
                          {busy === proposal.spec.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Übernehmen · Accept
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {result.rejected.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Verworfen (ungültige Spalten) · Rejected: {result.rejected.join('; ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
