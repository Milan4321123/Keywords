'use client';

import React, { useState } from 'react';
import { Table2, Plus, Trash2, Loader2, Check, Settings2, X } from 'lucide-react';
import { Keyword } from '@/types';

/**
 * Friendly field types: one dropdown choice sets data_type + semantic +
 * validation in the background — no schema knowledge needed.
 */
export const FIELD_TYPES: Array<{
  id: string;
  label: string;
  data_type: 'text' | 'number' | 'date' | 'boolean';
  semantic?: string;
  min?: number;
  needsOptions?: boolean;
  multiple?: boolean;
}> = [
  { id: 'text', label: 'Text', data_type: 'text' },
  { id: 'number', label: 'Zahl · Number', data_type: 'number' },
  { id: 'amount', label: 'Betrag € · Amount', data_type: 'number', semantic: 'amount', min: 0 },
  { id: 'date', label: 'Datum · Date (auto: heute)', data_type: 'date', semantic: 'business_date' },
  { id: 'datetime', label: 'Zeitpunkt · Time (auto: jetzt)', data_type: 'date', semantic: 'event_timestamp' },
  { id: 'boolean', label: 'Ja/Nein · Yes/No', data_type: 'boolean' },
  { id: 'select', label: 'Dropdown (Auswahl)', data_type: 'text', needsOptions: true },
  { id: 'multiselect', label: 'Mehrfachauswahl · Multi-select', data_type: 'text', needsOptions: true, multiple: true },
  { id: 'status', label: 'Status (Dropdown)', data_type: 'text', semantic: 'status', needsOptions: true },
  { id: 'person', label: 'Mitarbeiter · Worker', data_type: 'text', semantic: 'person' },
];

interface DraftColumn {
  name: string;
  typeId: string;
  options: string;
  required: boolean;
}

function emptyColumn(): DraftColumn {
  return { name: '', typeId: 'text', options: '', required: false };
}

function draftToSpecColumn(draft: DraftColumn) {
  const fieldType = FIELD_TYPES.find((t) => t.id === draft.typeId) ?? FIELD_TYPES[0];
  const rules: Record<string, unknown> = {};
  if (fieldType.min != null) rules.min = fieldType.min;
  if (fieldType.needsOptions) {
    const options = draft.options.split(',').map((o) => o.trim()).filter(Boolean).slice(0, 50);
    if (options.length > 0) rules.options = options;
  }
  if (fieldType.multiple) rules.multiple = true;
  return {
    name: draft.name.trim(),
    normalized_name: '',
    data_type: fieldType.data_type,
    semantic_name: fieldType.semantic ?? null,
    is_required: draft.required,
    validation_rules: rules,
    description: null,
  };
}

function ColumnDraftRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: DraftColumn;
  onChange: (next: DraftColumn) => void;
  onRemove?: () => void;
}) {
  const fieldType = FIELD_TYPES.find((t) => t.id === draft.typeId);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Spaltenname · Column name"
          className="flex-1 min-w-0 px-2.5 py-2 text-sm rounded-lg border border-slate-200 bg-white"
        />
        <select
          value={draft.typeId}
          onChange={(e) => onChange({ ...draft, typeId: e.target.value })}
          className="px-2 py-2 text-xs rounded-lg border border-slate-200 bg-white max-w-[150px]"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0" title="Pflichtfeld · Required">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => onChange({ ...draft, required: e.target.checked })}
          />
          *
        </label>
        {onRemove && (
          <button onClick={onRemove} className="p-1.5 rounded text-slate-300 hover:text-red-500 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {fieldType?.needsOptions && (
        <input
          value={draft.options}
          onChange={(e) => onChange({ ...draft, options: e.target.value })}
          placeholder="Optionen, mit Komma getrennt · z. B. Fliesen, Putz, Elektrik"
          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-slate-300 bg-slate-50"
        />
      )}
    </div>
  );
}

// =====================================================
// Manual table builder — no AI required
// =====================================================
export function TableBuilder({
  keywords,
  onCreated,
}: {
  keywords: Keyword[];
  onCreated: (created?: { table_id: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const [keywordId, setKeywordId] = useState('');
  const [columns, setColumns] = useState<DraftColumn[]>([emptyColumn()]);
  const [addAutos, setAddAutos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const create = async () => {
    const named = columns.filter((c) => c.name.trim());
    if (!tableName.trim() || named.length === 0) {
      setError('Tabellenname und mindestens eine Spalte angeben');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const specColumns = named.map(draftToSpecColumn);
      if (addAutos) {
        const hasDate = specColumns.some(
          (c) => c.semantic_name === 'business_date' || c.semantic_name === 'event_timestamp'
        );
        if (!hasDate) {
          specColumns.unshift({
            name: 'Datum', normalized_name: 'datum', data_type: 'date',
            semantic_name: 'business_date', is_required: true, validation_rules: {}, description: null,
          });
        }
        specColumns.push(
          {
            name: 'Erfasst von', normalized_name: 'erfasst_von', data_type: 'text',
            semantic_name: 'employee_id', is_required: false, validation_rules: {}, description: null,
          },
          {
            name: 'Beleg', normalized_name: 'beleg', data_type: 'text',
            semantic_name: 'evidence_reference', is_required: false, validation_rules: {}, description: null,
          }
        );
      }

      const response = await fetch('/api/ai/design-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          keyword_id: keywordId || null,
          spec: {
            dataset_title: tableName.trim(),
            table_name: tableName.trim(),
            description: null,
            keyword_id: keywordId || null,
            columns: specColumns,
          },
        }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setCreated(true);
      setTimeout(() => {
        setCreated(false);
        setOpen(false);
        setTableName('');
        setColumns([emptyColumn()]);
      }, 1500);
      onCreated(data);
    } catch (err: any) {
      setError(err.message || 'Anlegen fehlgeschlagen · Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Table2 className="w-4 h-4 text-slate-400" />
          Tabelle manuell anlegen · Build a table
        </span>
        <span className="text-xs font-medium text-slate-400">{open ? 'schließen' : 'öffnen'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="Tabellenname · z. B. Trinkgeld-Erfassung"
            className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <select
            value={keywordId}
            onChange={(e) => setKeywordId(e.target.value)}
            className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white"
          >
            <option value="">Kein Begriff verknüpft · No keyword</option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>Verknüpfen mit · Link to: {k.title}</option>
            ))}
          </select>

          <div className="space-y-2.5">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Spalten · Columns</div>
            {columns.map((draft, index) => (
              <ColumnDraftRow
                key={index}
                draft={draft}
                onChange={(next) => setColumns((prev) => prev.map((c, i) => (i === index ? next : c)))}
                onRemove={columns.length > 1 ? () => setColumns((prev) => prev.filter((_, i) => i !== index)) : undefined}
              />
            ))}
            <button
              onClick={() => setColumns((prev) => [...prev, emptyColumn()])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Spalte hinzufügen
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={addAutos} onChange={(e) => setAddAutos(e.target.checked)} />
            Automatik-Spalten ergänzen (Datum, Erfasst-von, Foto-Beleg)
          </label>

          {error && (
            <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}

          <button
            onClick={create}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : created ? <Check className="w-4 h-4" /> : <Table2 className="w-4 h-4" />}
            {created ? 'Angelegt · Created ✓' : 'Tabelle anlegen · Create table'}
          </button>
        </div>
      )}
    </div>
  );
}

// =====================================================
// Column manager for an existing table (add / delete)
// =====================================================
export function ColumnManager({
  tableId,
  columns,
  onChanged,
}: {
  tableId: string;
  columns: Array<{ id: string; name: string; data_type: string; semantic_name?: string | null; validation_rules?: any }>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftColumn>(emptyColumn());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addColumn = async () => {
    if (!draft.name.trim()) return;
    setBusy('add');
    setError(null);
    try {
      const spec = draftToSpecColumn(draft);
      const response = await fetch('/api/datasets/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_table_id: tableId,
          name: spec.name,
          data_type: spec.data_type,
          semantic_name: spec.semantic_name,
          is_required: spec.is_required,
          options: (spec.validation_rules as any).options,
          multiple: (spec.validation_rules as any).multiple === true,
          min: (spec.validation_rules as any).min,
        }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setDraft(emptyColumn());
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Hinzufügen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  };

  const removeColumn = async (column: { id: string; name: string }) => {
    if (!confirm(`Spalte „${column.name}" entfernen? Bestehende Werte bleiben in den Zeilen erhalten.`)) return;
    setBusy(column.id);
    setError(null);
    try {
      const response = await fetch(`/api/datasets/columns?column_id=${column.id}`, { method: 'DELETE' });
      const { error } = await response.json();
      if (error) throw new Error(error);
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Entfernen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
      >
        <Settings2 className="w-3.5 h-3.5" />
        Spalten bearbeiten · Edit columns {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {columns.map((column) => (
              <div key={column.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{column.name}</span>
                <span className="text-[10px] text-slate-400">{column.data_type}</span>
                {column.semantic_name && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium">
                    {column.semantic_name}
                  </span>
                )}
                {Array.isArray(column.validation_rules?.options) && (
                  <span className="text-[10px] text-slate-400">
                    {column.validation_rules.options.length} Optionen
                    {column.validation_rules?.multiple ? ' · mehrfach' : ''}
                  </span>
                )}
                <span className="flex-1" />
                <button
                  onClick={() => removeColumn(column)}
                  disabled={busy === column.id}
                  className="p-1 rounded text-slate-300 hover:text-red-500 disabled:opacity-50"
                  title="Spalte entfernen"
                >
                  {busy === column.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-dashed border-slate-200 p-2.5 space-y-2">
            <ColumnDraftRow draft={draft} onChange={setDraft} />
            <button
              onClick={addColumn}
              disabled={!draft.name.trim() || busy === 'add'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Spalte hinzufügen · Add column
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
