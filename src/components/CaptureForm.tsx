'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Camera, Check, Loader2, X, History, Plus, Pencil, Trash2 } from 'lucide-react';
import { CaptureField, CaptureFormDef, OwnRecord } from '@/lib/capture-types';

interface CaptureFormProps {
  form: CaptureFormDef;
  keywordId: string;
  onSaved: () => void;
}

const MULTI_SEP = ' | ';

function todayISO(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function nowLocalISO(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16); // datetime-local format
}

function initialValues(fields: CaptureField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.auto === 'today') values[field.field] = todayISO();
    else if (field.auto === 'now') values[field.field] = nowLocalISO();
    else values[field.field] = '';
  }
  return values;
}

/** Fields the worker actually types; server-computed autos stay hidden. */
function visibleFields(fields: CaptureField[]): CaptureField[] {
  return fields.filter((f) => f.auto !== 'user' && f.auto !== 'weekday' && f.auto !== 'evidence');
}

export default function CaptureForm({ form, keywordId, onSaved }: CaptureFormProps) {
  const fields = useMemo(() => visibleFields(form.fields), [form.fields]);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(form.fields));
  const [evidence, setEvidence] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<'photo' | 'save' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [editingRow, setEditingRow] = useState<OwnRecord | null>(null);
  // Freshly added dropdown options (persisted server-side, mirrored locally)
  const [localOptions, setLocalOptions] = useState<Record<string, string[]>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [optionDraft, setOptionDraft] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  const setValue = (field: string, value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  // "person" columns pick WHICH employee the record is about
  const hasPersonField = useMemo(
    () => form.fields.some((f) => f.semantic === 'person'),
    [form.fields]
  );
  useEffect(() => {
    if (!hasPersonField) return;
    fetch('/api/orgs/members')
      .then((r) => r.json())
      .then(({ data }) => {
        const names = (data?.members ?? [])
          .map((m: any) => m.profiles?.full_name || m.profiles?.email)
          .filter(Boolean);
        setMemberNames(Array.from(new Set(names)));
      })
      .catch(() => setMemberNames([]));
  }, [hasPersonField]);

  const effectiveOptions = (field: CaptureField): string[] => {
    const base = field.semantic === 'person' ? memberNames : field.options ?? [];
    const extra = localOptions[field.field] ?? [];
    return Array.from(new Set([...base, ...extra]));
  };

  // ---- multi-select helpers (stored joined with " | ") ----
  const multiValues = (field: string): string[] =>
    (values[field] ?? '').split(MULTI_SEP).map((v) => v.trim()).filter(Boolean);

  const toggleMulti = (field: string, option: string) => {
    const current = multiValues(field);
    const next = current.includes(option)
      ? current.filter((v) => v !== option)
      : [...current, option];
    setValue(field, next.join(MULTI_SEP));
  };

  // ---- reusable dropdown list: "+ Neu" persists the option on the column ----
  const addOption = async (field: CaptureField) => {
    const option = optionDraft.trim();
    if (!option || !field.column_id) return;
    setBusy(`opt-${field.field}`);
    setError(null);
    try {
      const response = await fetch('/api/datasets/columns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column_id: field.column_id, add_option: option }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setLocalOptions((prev) => ({
        ...prev,
        [field.field]: [...(prev[field.field] ?? []), option],
      }));
      if (field.multiple) toggleMulti(field.field, option);
      else setValue(field.field, option);
      setOptionDraft('');
      setAddingFor(null);
    } catch (err: any) {
      setError(err.message || 'Option konnte nicht gespeichert werden');
    } finally {
      setBusy(null);
    }
  };

  const attachPhoto = async (file: File) => {
    setBusy('photo');
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('keyword_id', keywordId);
      const response = await fetch('/api/assets/upload', { method: 'POST', body: formData });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setEvidence({ id: data.id, name: data.file_name });
    } catch (err: any) {
      setError(err.message || 'Foto-Upload fehlgeschlagen · Photo upload failed');
    } finally {
      setBusy(null);
    }
  };

  // ---- edit an existing own record in this same form ----
  const startEdit = (record: OwnRecord) => {
    const next = initialValues(form.fields);
    for (const field of fields) {
      const raw = record.data[field.field];
      if (raw == null) continue;
      let text = String(raw);
      if (field.data_type === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(text)) {
        text = field.auto === 'now' || (field.semantic && /timestamp/.test(field.semantic))
          ? text.slice(0, 16)
          : text.slice(0, 10);
      }
      next[field.field] = text;
    }
    setValues(next);
    setEditingRow(record);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingRow(null);
    setValues(initialValues(form.fields));
  };

  const deleteRecord = async (record: OwnRecord) => {
    if (!confirm('Eintrag löschen? · Delete this record?')) return;
    setBusy(`del-${record.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/datasets/rows?row_id=${record.id}`, { method: 'DELETE' });
      const { error } = await response.json();
      if (error) throw new Error(error);
      if (editingRow?.id === record.id) cancelEdit();
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Löschen fehlgeschlagen · Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy('save');
    setError(null);
    try {
      let response: Response;
      if (editingRow) {
        response = await fetch('/api/datasets/rows', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row_id: editingRow.id, values }),
        });
      } else {
        response = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_table_id: form.dataset_table_id,
            values,
            evidence_asset_id: evidence?.id ?? null,
          }),
        });
      }
      const { error } = await response.json();
      if (error) throw new Error(error);

      if (editingRow) {
        cancelEdit();
      } else {
        // Keep the date, clear the measured values for fast repeated entry
        setValues((prev) => {
          const next = initialValues(form.fields);
          for (const field of form.fields) {
            if (field.auto === 'today' || field.auto === 'now') next[field.field] = prev[field.field];
          }
          return next;
        });
        setEvidence(null);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Speichern fehlgeschlagen · Save failed');
    } finally {
      setBusy(null);
    }
  };

  const renderAddOption = (field: CaptureField) => {
    if (addingFor !== field.field) {
      return (
        <button
          type="button"
          onClick={() => {
            setAddingFor(field.field);
            setOptionDraft('');
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
        >
          <Plus className="w-3 h-3" /> Neu
        </button>
      );
    }
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={optionDraft}
          onChange={(e) => setOptionDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption(field);
            }
            if (e.key === 'Escape') setAddingFor(null);
          }}
          placeholder="Neue Option…"
          className="w-32 px-2 py-1.5 text-xs rounded-lg border border-blue-300 bg-white focus:ring-1 focus:ring-blue-400"
        />
        <button
          type="button"
          onClick={() => addOption(field)}
          disabled={busy === `opt-${field.field}`}
          className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50"
        >
          {busy === `opt-${field.field}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </button>
      </span>
    );
  };

  const renderField = (field: CaptureField) => {
    const value = values[field.field] ?? '';
    const base =
      'w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all';

    if (field.data_type === 'boolean') {
      return (
        <label className="flex items-center gap-2 py-2">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => setValue(field.field, e.target.checked ? 'true' : '')}
            className="rounded border-slate-300 w-5 h-5"
          />
          <span className="text-sm text-slate-600">Ja · Yes</span>
        </label>
      );
    }
    if (field.data_type === 'number') {
      return (
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(field.field, e.target.value)}
          placeholder={field.semantic?.includes('amount') || field.semantic?.includes('revenue') || field.semantic?.includes('cost') ? 'z. B. 1234,56' : '0'}
          className={base}
        />
      );
    }
    if (field.data_type === 'date') {
      const isTimestamp = field.auto === 'now' || (field.semantic ? /timestamp/.test(field.semantic) : false);
      return (
        <input
          type={isTimestamp ? 'datetime-local' : 'date'}
          value={value}
          onChange={(e) => setValue(field.field, e.target.value)}
          className={base}
        />
      );
    }

    const options = effectiveOptions(field);

    // Multi-select: tap chips to toggle, several per record (e.g. subtasks done)
    if (field.multiple && (options.length > 0 || field.curated)) {
      const picked = multiValues(field.field);
      return (
        <div className="flex flex-wrap items-center gap-1.5 min-h-[3rem] px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
          {options.map((option) => {
            const active = picked.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleMulti(field.field, option)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'
                }`}
              >
                {active && <Check className="w-3 h-3 inline mr-1 -mt-0.5" />}
                {option}
              </button>
            );
          })}
          {field.column_id && renderAddOption(field)}
          {picked.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-400">{picked.length} gewählt</span>
          )}
        </div>
      );
    }

    if (field.semantic === 'person' && options.length > 0) {
      return (
        <select value={value} onChange={(e) => setValue(field.field, e.target.value)} className={base}>
          <option value="">Mitarbeiter wählen · Choose worker…</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    if (options.length > 0) {
      return (
        <div className="flex items-center gap-1.5">
          <select
            value={value}
            onChange={(e) => setValue(field.field, e.target.value)}
            className={`${base} flex-1`}
          >
            <option value="">Auswählen · Select…</option>
            {options.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          {field.curated && field.column_id && renderAddOption(field)}
        </div>
      );
    }
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(field.field, e.target.value)}
        placeholder={field.description ?? ''}
        className={base}
      />
    );
  };

  return (
    <div className={`bg-white rounded-2xl border-2 p-4 mb-5 ${editingRow ? 'border-amber-200' : 'border-blue-100'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
          {editingRow ? (
            <>
              <Pencil className="w-4 h-4 text-amber-500" />
              Eintrag #{editingRow.row_index} bearbeiten · Edit record
            </>
          ) : (
            <>
              <ClipboardList className="w-4 h-4 text-blue-500" />
              Daten erfassen · Record data
            </>
          )}
        </span>
        <span className="text-[10px] text-slate-400 font-medium">{form.table_name}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => (
          <div
            key={field.field}
            className={
              field.multiple || (field.data_type === 'text' && !field.options && field.semantic !== 'person')
                ? 'sm:col-span-2'
                : ''
            }
          >
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {field.label}
              {field.required && field.auto == null && <span className="text-red-400"> *</span>}
              {(field.auto === 'today' || field.auto === 'now') && (
                <span className="ml-1.5 text-[10px] font-medium text-emerald-600">auto</span>
              )}
              {field.multiple && (
                <span className="ml-1.5 text-[10px] font-medium text-blue-500">Mehrfachauswahl · multi</span>
              )}
            </label>
            {renderField(field)}
          </div>
        ))}
      </div>

      {/* Evidence photo (only for new records) */}
      {!editingRow && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            disabled={busy === 'photo'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            {busy === 'photo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            Foto als Beleg · Photo evidence
          </button>
          {evidence && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100 text-xs font-medium text-emerald-700">
              {evidence.name.length > 24 ? `${evidence.name.slice(0, 23)}…` : evidence.name}
              <button onClick={() => setEvidence(null)} className="opacity-60 hover:opacity-100">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) attachPhoto(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {error && (
        <div className="mt-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {editingRow && (
          <button
            onClick={cancelEdit}
            className="px-4 py-3 rounded-xl text-sm font-semibold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
          >
            Abbrechen
          </button>
        )}
        <button
          onClick={submit}
          disabled={busy != null}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition-all ${
            editingRow ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saved
            ? 'Gespeichert · Saved ✓'
            : editingRow
              ? 'Eintrag aktualisieren · Update record'
              : 'Eintrag speichern · Save record'}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-400 text-center">
        Datum, Uhrzeit & Nutzer werden automatisch ergänzt · Date, time & user are added automatically
      </p>

      {/* Personal history: only this member's records, editable */}
      {(form.recent_own?.length ?? 0) > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-2">
            <History className="w-3.5 h-3.5 text-slate-400" />
            Meine letzten Einträge · My recent records
          </div>
          <div className="space-y-1">
            {form.recent_own!.map((record) => {
              const parts = fields
                .map((f) => {
                  const value = record.data[f.field];
                  if (value == null || value === '') return null;
                  const text =
                    f.data_type === 'number' && typeof value === 'number'
                      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : String(value).length > 22
                        ? `${String(value).slice(0, 21)}…`
                        : String(value);
                  return text;
                })
                .filter(Boolean)
                .slice(0, 4);
              return (
                <div
                  key={record.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 ${
                    editingRow?.id === record.id ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50'
                  }`}
                >
                  <span className="text-slate-400 tabular-nums shrink-0">#{record.row_index}</span>
                  <span className="truncate flex-1">{parts.join(' · ')}</span>
                  <button
                    onClick={() => startEdit(record)}
                    title="Bearbeiten · Edit"
                    className="p-1 rounded text-slate-300 hover:text-amber-600 hover:bg-amber-50 shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteRecord(record)}
                    disabled={busy === `del-${record.id}`}
                    title="Löschen · Delete"
                    className="p-1 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 shrink-0"
                  >
                    {busy === `del-${record.id}` ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
