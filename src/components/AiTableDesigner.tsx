'use client';

import React, { useState } from 'react';
import { Sparkles, Loader2, Check, Table2, HardHat, CalendarDays, Hash, Type, ToggleLeft } from 'lucide-react';

interface ColumnSpec {
  name: string;
  normalized_name: string;
  data_type: string;
  semantic_name: string | null;
  is_required: boolean;
  validation_rules: Record<string, unknown>;
  description: string | null;
}

interface TableSpec {
  dataset_title: string;
  table_name: string;
  description: string | null;
  keyword_id: string | null;
  columns: ColumnSpec[];
}

interface DesignResult {
  spec: TableSpec;
  note: string | null;
  keywords: Array<{ id: string; title: string }>;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  date: CalendarDays,
  number: Hash,
  text: Type,
  boolean: ToggleLeft,
};

const AUTO_SEMANTICS = new Set(['business_date', 'event_timestamp', 'weekday', 'employee_id', 'evidence_reference']);

export default function AiTableDesigner({
  onCreated,
  defaultKeywordId = '',
}: {
  onCreated: (created?: { dataset_id: string; table_id: string; keyword_id: string | null }) => void;
  defaultKeywordId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<'design' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [keywordId, setKeywordId] = useState('');
  const [created, setCreated] = useState(false);

  const design = async () => {
    setBusy('design');
    setError(null);
    setResult(null);
    setCreated(false);
    try {
      const response = await fetch('/api/ai/design-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, keyword_id: defaultKeywordId || null }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setResult(data);
      setKeywordId(defaultKeywordId || data.spec.keyword_id || '');
    } catch (err: any) {
      setError(err.message || 'Fehlgeschlagen · Failed');
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!result) return;
    setBusy('create');
    setError(null);
    try {
      const response = await fetch('/api/ai/design-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, spec: result.spec, keyword_id: keywordId || null }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setCreated(true);
      onCreated(data);
    } catch (err: any) {
      setError(err.message || 'Anlegen fehlgeschlagen · Create failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-gradient-to-br from-emerald-50/70 to-white rounded-xl border border-emerald-200 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-emerald-800">
          <Table2 className="w-4 h-4" />
          Neue Tabelle mit KI anlegen · Design a data table with AI
        </span>
        <span className="text-xs font-medium text-emerald-400">{open ? 'schließen' : 'öffnen'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Beschreibe, was du täglich erfassen willst — die KI baut die Tabelle mit Datum, Beträgen und
            Typen. Danach erscheint sie automatisch als Eingabeformular in der Arbeitsansicht. ·
            Describe what to track daily — the AI designs the table; it instantly becomes a capture form in the Work view.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={'z. B. "Tägliche Kasse: Bareinnahmen, Karteneinnahmen, Trinkgeld, Notiz" oder "Reinigungsprotokoll für die Küche"'}
              className="flex-1 px-3 py-2.5 text-sm rounded-xl border bg-white focus:ring-2 focus:ring-emerald-500 transition-all resize-none"
            />
            <button
              onClick={design}
              disabled={!description.trim() || busy != null}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shrink-0"
            >
              {busy === 'design' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Entwerfen
            </button>
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}

          {result && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <div>
                <div className="font-bold text-gray-900 text-sm">{result.spec.dataset_title}</div>
                <div className="text-xs text-gray-400 font-mono">{result.spec.table_name}</div>
                {result.note && <p className="text-xs text-gray-500 italic mt-1">{result.note}</p>}
              </div>

              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {result.spec.columns.map((col) => {
                  const Icon = TYPE_ICONS[col.data_type] ?? Type;
                  const isAuto = col.semantic_name ? AUTO_SEMANTICS.has(col.semantic_name) : false;
                  return (
                    <div key={col.normalized_name} className="flex items-center gap-2.5 px-3 py-2">
                      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-sm text-gray-800 font-medium">{col.name}</span>
                      <span className="text-[10px] text-gray-400">{col.data_type}</span>
                      {col.semantic_name && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium">
                          {col.semantic_name}
                        </span>
                      )}
                      {isAuto && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] font-semibold">
                          auto
                        </span>
                      )}
                      {col.is_required && !isAuto && <span className="text-red-400 text-xs">*</span>}
                      <span className="flex-1" />
                      {'min' in col.validation_rules && (
                        <span className="text-[10px] text-gray-300">≥ {String(col.validation_rules.min)}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <select
                  value={keywordId}
                  onChange={(e) => setKeywordId(e.target.value)}
                  className="px-3 py-2 text-sm rounded-xl border bg-white flex-1"
                >
                  <option value="">Kein Begriff verknüpft · No keyword linked</option>
                  {result.keywords.map((k) => (
                    <option key={k.id} value={k.id}>Verknüpfen mit · Link to: {k.title}</option>
                  ))}
                </select>
                {created ? (
                  <span className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Check className="w-4 h-4" /> Angelegt · Created
                  </span>
                ) : (
                  <button
                    onClick={create}
                    disabled={busy != null}
                    className="flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-all"
                  >
                    {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Tabelle anlegen
                  </button>
                )}
              </div>

              {created && keywordId && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                  <HardHat className="w-3.5 h-3.5" />
                  Ab sofort in der Arbeitsansicht als Eingabeformular verfügbar · Now available as a capture form in the Work view.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
