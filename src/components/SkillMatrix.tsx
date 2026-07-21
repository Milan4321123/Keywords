'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Users, Loader2, RefreshCw } from 'lucide-react';

interface ColumnInfo {
  id: string;
  name: string;
  normalized_name: string;
  data_type: string;
  semantic_name?: string | null;
}

interface RowData {
  id: string;
  data: Record<string, unknown>;
}

const MULTI_SEP = /\s*\|\s*/;
const DONE_HINTS = ['done', 'erledigt', 'fertig', 'ok', 'abgeschlossen', 'completed'];

/**
 * Team skill matrix: person × skill (e.g. subtask) with counts computed from
 * the recorded rows — "who has done what, how often, and what is still open".
 * Multi-select values ("a | b | c") are split and counted individually.
 */
export default function SkillMatrix({
  tableId,
  columns,
}: {
  tableId: string;
  columns: ColumnInfo[];
}) {
  const textColumns = useMemo(
    () =>
      columns.filter(
        (c) =>
          c.data_type === 'text' &&
          !['employee_id', 'evidence_reference', 'weekday'].includes(c.semantic_name ?? '')
      ),
    [columns]
  );

  const personColumn = useMemo(
    () =>
      textColumns.find((c) => c.semantic_name === 'person') ??
      columns.find((c) => c.semantic_name === 'employee_id') ??
      null,
    [textColumns, columns]
  );

  const defaultSkill = useMemo(() => {
    const byName = textColumns.find((c) => /task|aufgabe|subtask|tätigkeit|skill/i.test(c.normalized_name));
    const byDimension = textColumns.find(
      (c) => c.semantic_name === 'dimension' && c.id !== personColumn?.id
    );
    return (byName ?? byDimension ?? textColumns.find((c) => c.id !== personColumn?.id))?.normalized_name ?? '';
  }, [textColumns, personColumn]);

  const statusColumn = useMemo(
    () =>
      textColumns.find(
        (c) => c.semantic_name === 'status' || c.semantic_name === 'control_status' || /status/i.test(c.normalized_name)
      ) ?? null,
    [textColumns]
  );

  const [skillField, setSkillField] = useState(defaultSkill);
  const [doneValue, setDoneValue] = useState('');
  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => setSkillField(defaultSkill), [defaultSkill, tableId]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/datasets/rows?table_id=${tableId}&limit=250`);
      const { data } = await response.json();
      setRows(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    load();
  }, [load]);

  // Distinct status values + auto-pick a "done" value
  const statusValues = useMemo(() => {
    if (!statusColumn) return [] as string[];
    const set = new Set<string>();
    for (const row of rows) {
      const value = row.data[statusColumn.normalized_name];
      if (value != null && String(value).trim()) set.add(String(value).trim());
    }
    return Array.from(set).sort();
  }, [rows, statusColumn]);

  useEffect(() => {
    if (doneValue || statusValues.length === 0) return;
    const hint = statusValues.find((v) => DONE_HINTS.includes(v.toLowerCase()));
    if (hint) setDoneValue(hint);
  }, [statusValues, doneValue]);

  const matrix = useMemo(() => {
    if (!personColumn || !skillField) return null;
    const personField = personColumn.normalized_name;

    const skillTotals = new Map<string, number>();
    const persons = new Map<
      string,
      { total: number; done: number; skills: Map<string, { total: number; done: number }> }
    >();

    for (const row of rows) {
      const person = String(row.data[personField] ?? '').trim();
      if (!person) continue;
      const rawSkill = row.data[skillField];
      const skills = String(rawSkill ?? '')
        .split(MULTI_SEP)
        .map((s) => s.trim())
        .filter(Boolean);
      if (skills.length === 0) continue;

      const isDone =
        !statusColumn || !doneValue
          ? true
          : String(row.data[statusColumn.normalized_name] ?? '').trim().toLowerCase() ===
            doneValue.toLowerCase();

      if (!persons.has(person)) persons.set(person, { total: 0, done: 0, skills: new Map() });
      const entry = persons.get(person)!;
      for (const skill of skills) {
        skillTotals.set(skill, (skillTotals.get(skill) ?? 0) + 1);
        if (!entry.skills.has(skill)) entry.skills.set(skill, { total: 0, done: 0 });
        const cell = entry.skills.get(skill)!;
        cell.total++;
        entry.total++;
        if (isDone) {
          cell.done++;
          entry.done++;
        }
      }
    }

    const topSkills = Array.from(skillTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([skill]) => skill);
    const sortedPersons = Array.from(persons.entries()).sort((a, b) => b[1].total - a[1].total);

    return { topSkills, persons: sortedPersons, hasStatus: Boolean(statusColumn && doneValue) };
  }, [rows, personColumn, skillField, statusColumn, doneValue]);

  if (!personColumn) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-10 text-center">
        <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 font-medium">Keine Personen-Spalte in dieser Tabelle</p>
        <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
          Für die Team-Übersicht braucht die Tabelle eine Spalte „person“ (wer hat die Arbeit gemacht).
          Der KI-Tabellendesigner fügt sie bei Arbeits-/Zeiterfassung automatisch hinzu.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          Team-Skills · Wer kann was, wie oft gemacht
        </h3>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Aktualisieren
        </button>
      </div>

      <div className="flex gap-2 flex-wrap items-center text-xs">
        <label className="text-slate-500 font-semibold">Fähigkeit aus Spalte:</label>
        <select
          value={skillField}
          onChange={(e) => setSkillField(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
        >
          {textColumns
            .filter((c) => c.id !== personColumn.id)
            .map((c) => (
              <option key={c.id} value={c.normalized_name}>{c.name}</option>
            ))}
        </select>
        {statusColumn && statusValues.length > 0 && (
          <>
            <label className="text-slate-500 font-semibold ml-2">„Erledigt“ =</label>
            <select
              value={doneValue}
              onChange={(e) => setDoneValue(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
            >
              <option value="">— alle zählen —</option>
              {statusValues.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : !matrix || matrix.persons.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          Noch keine Einträge mit Person + Fähigkeit · No records yet.
        </p>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 border-b border-slate-200 sticky left-0 bg-slate-50">
                  Mitarbeiter
                </th>
                {matrix.topSkills.map((skill) => (
                  <th key={skill} className="px-3 py-2.5 text-xs font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap">
                    {skill}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 border-b border-slate-200 text-right">
                  Gesamt {matrix.hasStatus && '· offen'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matrix.persons.map(([person, entry]) => {
                const open = entry.total - entry.done;
                return (
                  <tr key={person} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap sticky left-0 bg-white">
                      {person}
                    </td>
                    {matrix.topSkills.map((skill) => {
                      const cell = entry.skills.get(skill);
                      if (!cell) {
                        return <td key={skill} className="px-3 py-2 text-slate-200">—</td>;
                      }
                      const strong = cell.total >= 3;
                      return (
                        <td key={skill} className="px-3 py-2 tabular-nums">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${
                              strong
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                            title={matrix.hasStatus ? `${cell.done} erledigt von ${cell.total}` : `${cell.total}×`}
                          >
                            {matrix.hasStatus ? `${cell.done}/${cell.total}` : `${cell.total}×`}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      <span className="font-bold text-slate-800">{entry.total}</span>
                      {matrix.hasStatus && open > 0 && (
                        <span className="ml-1.5 text-amber-600 font-semibold">· {open} offen</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-400">
        Zählt echte Einträge aus dieser Tabelle (letzte 250). Mehrfachauswahl-Werte werden einzeln gezählt.
        ≥3× = <span className="text-emerald-600 font-semibold">erfahren</span>.
      </p>
    </div>
  );
}
