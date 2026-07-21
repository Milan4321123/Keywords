'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Check } from 'lucide-react';
import { DatasetColumn, DatasetRow } from '@/types';

interface DataGridProps {
  tableId: string;
  columns: DatasetColumn[];
  /** bump to force a reload (e.g. after external inserts) */
  refreshToken?: number;
}

/**
 * Editable spreadsheet view for one dataset table.
 * Click a cell to edit; Enter/blur saves the row via PATCH /api/datasets/rows.
 */
export default function DataGrid({ tableId, columns, refreshToken = 0 }: DataGridProps) {
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; field: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [savedRow, setSavedRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/datasets/rows?table_id=${encodeURIComponent(tableId)}&limit=200`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setRows(data ?? []);
    } catch (err: any) {
      setError(err.message || 'Laden fehlgeschlagen · Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const startEdit = (row: DatasetRow, field: string) => {
    const value = row.data[field];
    setEditing({ rowId: row.id, field });
    setDraft(value == null ? '' : String(value));
  };

  const commitEdit = async () => {
    if (!editing) return;
    const row = rows.find((r) => r.id === editing.rowId);
    if (!row) {
      setEditing(null);
      return;
    }
    const current = row.data[editing.field];
    const unchanged = (current == null ? '' : String(current)) === draft;
    setEditing(null);
    if (unchanged) return;

    setSavingRow(row.id);
    setError(null);
    try {
      const response = await fetch('/api/datasets/rows', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row_id: row.id,
          values: { ...row.data, [editing.field]: draft === '' ? null : draft },
        }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setRows((prev) => prev.map((r) => (r.id === row.id ? (data as DatasetRow) : r)));
      setSavedRow(row.id);
      setTimeout(() => setSavedRow(null), 1500);
    } catch (err: any) {
      setError(err.message || 'Speichern fehlgeschlagen · Save failed');
    } finally {
      setSavingRow(null);
    }
  };

  const formatCell = (value: unknown, type: string): string => {
    if (value == null || value === '') return '';
    if (type === 'number' && typeof value === 'number') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    if (type === 'date') {
      const raw = String(value);
      return /^\d{4}-\d{2}-\d{2}T/.test(raw) ? raw.slice(0, 16).replace('T', ' ') : raw;
    }
    return String(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="text-xs text-slate-400">
          {rows.length} Zeilen (neueste zuerst) · Zelle anklicken zum Bearbeiten · Click a cell to edit
        </p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Aktualisieren
        </button>
      </div>

      {error && (
        <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}

      {rows.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
          Noch keine Zeilen · No rows yet — erfasse Daten in der Arbeitsansicht oder lade eine Datei hoch.
        </div>
      ) : (
        <div className="overflow-auto max-h-[520px] rounded-xl border border-slate-200">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-400 border-b border-slate-200 w-10">#</th>
                {columns.map((col) => (
                  <th key={col.id} className="px-3 py-2 border-b border-slate-200 whitespace-nowrap">
                    <div className="text-xs font-semibold text-slate-700">{col.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-slate-400">{col.data_type}</span>
                      {(col as any).semantic_name && (
                        <span className="px-1 py-px rounded bg-blue-50 text-blue-600 text-[9px] font-medium">
                          {(col as any).semantic_name}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-2 border-b border-slate-200 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 text-[11px] text-slate-300 tabular-nums">{row.row_index}</td>
                  {columns.map((col) => {
                    const field = col.normalized_name;
                    const isEditing = editing?.rowId === row.id && editing.field === field;
                    const isNumber = col.data_type === 'number';
                    return (
                      <td
                        key={col.id}
                        onClick={() => !isEditing && startEdit(row, field)}
                        className={`px-3 py-1.5 cursor-text whitespace-nowrap max-w-[240px] overflow-hidden text-ellipsis ${
                          isNumber ? 'text-right tabular-nums' : 'text-left'
                        } ${isEditing ? 'p-0' : ''}`}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit();
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            className={`w-full min-w-[110px] px-3 py-1.5 text-sm border-2 border-blue-400 rounded-md bg-white focus:outline-none ${
                              isNumber ? 'text-right' : ''
                            }`}
                          />
                        ) : (
                          <span className="text-slate-700">{formatCell(row.data[field], col.data_type)}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2">
                    {savingRow === row.id && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
                    {savedRow === row.id && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
