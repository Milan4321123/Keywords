'use client';

import React, { useMemo, useRef, useState } from 'react';
import { ClipboardList, Camera, Check, Loader2, X } from 'lucide-react';
import { CaptureField, CaptureFormDef } from '@/lib/capture-types';

interface CaptureFormProps {
  form: CaptureFormDef;
  keywordId: string;
  onSaved: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const setValue = (field: string, value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));

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

  const submit = async () => {
    setBusy('save');
    setError(null);
    try {
      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_table_id: form.dataset_table_id,
          values,
          evidence_asset_id: evidence?.id ?? null,
        }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);

      // Keep the date, clear the measured values for fast repeated entry
      setValues((prev) => {
        const next = initialValues(form.fields);
        for (const field of form.fields) {
          if (field.auto === 'today' || field.auto === 'now') next[field.field] = prev[field.field];
        }
        return next;
      });
      setEvidence(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Speichern fehlgeschlagen · Save failed');
    } finally {
      setBusy(null);
    }
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
    if (field.options && field.options.length > 0) {
      return (
        <select value={value} onChange={(e) => setValue(field.field, e.target.value)} className={base}>
          <option value="">Auswählen · Select…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
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
    <div className="bg-white rounded-2xl border-2 border-blue-100 p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-blue-500" />
          Daten erfassen · Record data
        </span>
        <span className="text-[10px] text-slate-400 font-medium">{form.table_name}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.field} className={field.data_type === 'text' && !field.options ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {field.label}
              {field.required && field.auto == null && <span className="text-red-400"> *</span>}
              {(field.auto === 'today' || field.auto === 'now') && (
                <span className="ml-1.5 text-[10px] font-medium text-emerald-600">auto</span>
              )}
            </label>
            {renderField(field)}
          </div>
        ))}
      </div>

      {/* Evidence photo */}
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

      {error && (
        <div className="mt-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy != null}
        className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-all"
      >
        {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {saved ? 'Gespeichert · Saved ✓' : 'Eintrag speichern · Save record'}
      </button>
      <p className="mt-1.5 text-[10px] text-slate-400 text-center">
        Datum, Uhrzeit & Nutzer werden automatisch ergänzt · Date, time & user are added automatically
      </p>
    </div>
  );
}
