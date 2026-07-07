'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Save,
  Trash2,
  Plus,
  X,
  BookOpen,
  Sparkles,
  Loader2,
  Check,
  ChevronDown,
  Globe,
} from 'lucide-react';
import { Keyword, KeywordType, KeywordStatus, KeywordAccessLevel } from '@/types';
import VoiceInput from './VoiceInput';
import ChipInput from './ChipInput';

const KEYWORD_TYPE_OPTIONS: { value: KeywordType; label: string }[] = [
  { value: 'concept', label: 'Konzept · Concept' },
  { value: 'process', label: 'Prozess · Process' },
  { value: 'metric', label: 'Kennzahl · Metric' },
  { value: 'dataset', label: 'Datensatz · Dataset' },
  { value: 'document_type', label: 'Dokumenttyp · Document Type' },
  { value: 'role', label: 'Rolle · Role' },
  { value: 'task_type', label: 'Aufgabentyp · Task Type' },
  { value: 'workflow_step', label: 'Workflow-Schritt · Workflow Step' },
  { value: 'department', label: 'Abteilung · Department' },
  { value: 'entity', label: 'Entität · Entity' },
  { value: 'kpi', label: 'KPI' },
  { value: 'report_type', label: 'Berichtstyp · Report Type' },
  { value: 'risk', label: 'Risiko · Risk' },
  { value: 'rule', label: 'Regel · Rule' },
  { value: 'skill', label: 'Fähigkeit · Skill' },
];

const KEYWORD_STATUS_OPTIONS: { value: KeywordStatus; label: string }[] = [
  { value: 'draft', label: 'Entwurf · Draft' },
  { value: 'active', label: 'Aktiv · Active' },
  { value: 'archived', label: 'Archiviert · Archived' },
];

const ACCESS_LEVEL_OPTIONS: { value: KeywordAccessLevel; label: string; hint: string }[] = [
  { value: 'worker', label: 'Arbeiter · Worker', hint: 'Für alle sichtbar · Everyone can see' },
  { value: 'manager', label: 'Bauleiter · Manager', hint: 'Bauleiter & Admin' },
  { value: 'admin', label: 'Admin', hint: 'Nur Admin · Admin only' },
];

interface DefinitionSuggestion {
  definition: string;
  explanation: string;
  examples: string[];
}

interface KeywordDetailProps {
  keyword: Keyword | null;
  allKeywords: Keyword[];
  onSave: (keyword: Partial<Keyword>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  isNew?: boolean;
  parentId?: string | null;
}

/** Small bilingual field label: German primary, English hint. */
function FieldLabel({ de, en, required }: { de: string; en: string; required?: boolean }) {
  return (
    <label className="block mb-1.5">
      <span className="text-sm font-bold text-slate-700">{de}</span>
      {required && <span className="text-red-500"> *</span>}
      <span className="text-xs font-medium text-slate-400 ml-1.5">{en}</span>
    </label>
  );
}

export const KeywordDetail: React.FC<KeywordDetailProps> = ({
  keyword,
  allKeywords,
  onSave,
  onDelete,
  onClose,
  isNew = false,
  parentId = null,
}) => {
  const [formData, setFormData] = useState<Partial<Keyword>>({
    title: '',
    definition: '',
    explanation: '',
    examples: [],
    synonyms: [],
    rules: [],
    labels_json: {},
    parent_id: parentId,
  });

  const [newLabelLang, setNewLabelLang] = useState('');
  const [newLabelValue, setNewLabelValue] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [suggestion, setSuggestion] = useState<DefinitionSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (keyword && !isNew) {
      setFormData({
        title: keyword.title,
        definition: keyword.definition || '',
        explanation: keyword.explanation || '',
        examples: keyword.examples || [],
        synonyms: keyword.synonyms || [],
        rules: keyword.rules || [],
        labels_json: keyword.labels_json || {},
        parent_id: keyword.parent_id,
        color: keyword.color || '',
        icon: keyword.icon || '',
        keyword_type: keyword.keyword_type || 'concept',
        status: keyword.status || 'active',
        access_level: keyword.access_level || 'worker',
      });
    } else {
      setFormData({
        title: '',
        definition: '',
        explanation: '',
        examples: [],
        synonyms: [],
        rules: [],
        labels_json: {},
        parent_id: parentId,
        keyword_type: 'concept',
        status: 'active',
        access_level: 'worker',
      });
    }
    setShowAdvanced(false);
    setSuggestion(null);
    setSuggestError(null);
  }, [keyword, isNew, parentId]);

  // Focus the title on open so the user can start typing immediately
  useEffect(() => {
    const timer = setTimeout(() => titleRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [isNew, keyword?.id]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!formData.title?.trim()) {
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...formData,
        id: isNew ? undefined : keyword?.id,
        slug: formData.title?.toLowerCase().replace(/\s+/g, '-'),
      });
    } finally {
      setSaving(false);
    }
  };

  const requestSuggestion = async () => {
    if (!keyword) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const response = await fetch(`/api/keywords/${keyword.id}/suggest-definition`, { method: 'POST' });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setSuggestion(data);
    } catch (err: any) {
      setSuggestError(err.message || 'Vorschlag fehlgeschlagen · Suggestion failed');
    } finally {
      setSuggesting(false);
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setFormData((prev) => ({
      ...prev,
      definition: suggestion.definition || prev.definition,
      explanation: suggestion.explanation || prev.explanation,
      examples: suggestion.examples?.length
        ? Array.from(new Set([...(prev.examples || []), ...suggestion.examples]))
        : prev.examples,
    }));
    setSuggestion(null);
  };

  const handleVoiceTranscript = (text: string, field: 'definition' | 'explanation' | 'example') => {
    if (field === 'example') {
      setFormData((prev) => ({ ...prev, examples: [...(prev.examples || []), text] }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: text }));
    }
  };

  const addLabel = () => {
    if (newLabelLang.trim() && newLabelValue.trim()) {
      setFormData((prev) => ({
        ...prev,
        labels_json: { ...prev.labels_json, [newLabelLang.toLowerCase()]: newLabelValue },
      }));
      setNewLabelLang('');
      setNewLabelValue('');
    }
  };

  const removeLabel = (lang: string) => {
    setFormData((prev) => {
      const next = { ...prev.labels_json };
      delete next[lang];
      return { ...prev, labels_json: next };
    });
  };

  const canSave = Boolean(formData.title?.trim());

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            {isNew ? <Plus className="w-5 h-5" /> : <BookOpen className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">
              {isNew ? 'Neuer Begriff' : formData.title || keyword?.title}
              <span className="text-sm font-medium text-slate-400 ml-2">
                {isNew ? 'New concept' : 'Edit concept'}
              </span>
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              Begriff definieren · Define a business concept
            </p>
          </div>
        </div>
        {!isNew && keyword && (
          <button
            onClick={() => onDelete(keyword.id)}
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            title="Löschen · Delete"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Form body — single scroll, no tabs */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-6 sm:p-8 space-y-6 max-w-3xl">
          {/* Title */}
          <div>
            <FieldLabel de="Titel" en="Title" required />
            <input
              ref={titleRef}
              type="text"
              value={formData.title || ''}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
              className="w-full px-4 py-3 text-lg font-medium border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
              placeholder="z. B. Rechnung, Projekt, Mangel"
              required
            />
          </div>

          {/* Parent */}
          <div>
            <FieldLabel de="Übergeordneter Begriff" en="Parent concept" />
            <select
              value={formData.parent_id || ''}
              onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all text-slate-700"
            >
              <option value="">Keiner (oberste Ebene) · None (root)</option>
              {allKeywords
                .filter((k) => k.id !== keyword?.id)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.title}
                  </option>
                ))}
            </select>
          </div>

          {/* AI suggestion preview */}
          {suggestion && (
            <div className="p-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
                <Sparkles className="w-4 h-4" />
                KI-Vorschlag — vor dem Übernehmen prüfen · AI suggestion, review before applying
              </div>
              <div className="text-sm text-slate-700">
                <span className="font-semibold">Definition:</span> {suggestion.definition}
              </div>
              {suggestion.explanation && (
                <div className="text-sm text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-700">Erklärung:</span> {suggestion.explanation}
                </div>
              )}
              {suggestion.examples?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestion.examples.map((ex, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-white border border-indigo-100 text-xs text-slate-600">
                      {ex}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={applySuggestion}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  <Check className="w-4 h-4" /> Übernehmen · Apply
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestion(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  Verwerfen · Dismiss
                </button>
                <span className="text-xs text-slate-400">Nichts wird gespeichert, bis du auf „Speichern“ klickst.</span>
              </div>
            </div>
          )}
          {suggestError && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {suggestError}
            </div>
          )}

          {/* Definition */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel de="Kurze Definition" en="Short definition (meaning)" />
              <div className="flex items-center gap-2">
                {!isNew && keyword && (
                  <button
                    type="button"
                    onClick={requestSuggestion}
                    disabled={suggesting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 disabled:opacity-60 transition-colors"
                  >
                    {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Mit KI ausfüllen
                  </button>
                )}
                <VoiceInput targetField="definition" onTranscript={(t) => handleVoiceTranscript(t, 'definition')} />
              </div>
            </div>
            <textarea
              value={formData.definition || ''}
              onChange={(e) => setFormData({ ...formData, definition: e.target.value })}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all resize-none"
              rows={2}
              placeholder="Ein bis zwei Sätze, die den Begriff erklären…"
            />
          </div>

          {/* Explanation */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel de="Ausführliche Erklärung" en="Detailed explanation" />
              <VoiceInput targetField="explanation" onTranscript={(t) => handleVoiceTranscript(t, 'explanation')} />
            </div>
            <textarea
              value={formData.explanation || ''}
              onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
              rows={4}
              placeholder="Kontext, Verwendung, Besonderheiten in eurem Unternehmen…"
            />
          </div>

          {/* Examples (chips) */}
          <div>
            <FieldLabel de="Beispiele" en="Examples — Enter zum Hinzufügen" />
            <ChipInput
              values={formData.examples || []}
              onChange={(examples) => setFormData({ ...formData, examples })}
              placeholder="Beispiel eingeben und Enter drücken…"
              tone="blue"
              action={
                <VoiceInput targetField="example" onTranscript={(t) => handleVoiceTranscript(t, 'example')} />
              }
            />
          </div>

          {/* Synonyms (chips) */}
          <div>
            <FieldLabel de="Synonyme & andere Namen" en="Synonyms & alternative names" />
            <ChipInput
              values={formData.synonyms || []}
              onChange={(synonyms) => setFormData({ ...formData, synonyms })}
              placeholder="Synonym eingeben und Enter drücken…"
              tone="slate"
            />
          </div>

          {/* Rules (chips) */}
          <div>
            <FieldLabel de="Regeln & Bedingungen" en="Business rules & constraints" />
            <ChipInput
              values={formData.rules || []}
              onChange={(rules) => setFormData({ ...formData, rules })}
              placeholder="z. B. Rechnung braucht Datum + Betrag + Lieferant"
              tone="amber"
            />
          </div>

          {/* Advanced (collapsible) */}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              Mehr Optionen · More options (Typ, Status, Sprachen)
            </button>

            {showAdvanced && (
              <div className="mt-5 space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel de="Typ" en="Type" />
                    <select
                      value={formData.keyword_type || 'concept'}
                      onChange={(e) => setFormData({ ...formData, keyword_type: e.target.value as KeywordType })}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all text-slate-700"
                    >
                      {KEYWORD_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel de="Status" en="Status" />
                    <select
                      value={formData.status || 'active'}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as KeywordStatus })}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all text-slate-700"
                    >
                      {KEYWORD_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Access level — who may see this keyword */}
                <div>
                  <FieldLabel de="Zugriffsebene" en="Who can see this keyword" />
                  <div className="grid grid-cols-3 gap-2">
                    {ACCESS_LEVEL_OPTIONS.map((opt) => {
                      const active = (formData.access_level || 'worker') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormData({ ...formData, access_level: opt.value })}
                          className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                            active
                              ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                              : 'border-slate-200 bg-slate-50 hover:bg-white'
                          }`}
                        >
                          <div className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-slate-700'}`}>
                            {opt.label}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{opt.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Arbeiter sehen nur „Worker“-Begriffe. · Workers only see worker-level keywords.
                  </p>
                </div>

                {/* Multilingual labels */}
                <div>
                  <FieldLabel de="Sprachlabels" en="Translations" />
                  {Object.keys(formData.labels_json || {}).length > 0 && (
                    <div className="space-y-2 mb-3">
                      {Object.entries(formData.labels_json || {}).map(([lang, value]) => (
                        <div key={lang} className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl group">
                          <span className="w-9 h-9 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold uppercase">
                            {lang}
                          </span>
                          <span className="flex-1 text-sm font-medium text-slate-700">{value}</span>
                          <button
                            type="button"
                            onClick={() => removeLabel(lang)}
                            className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1.5"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <div className="relative">
                      <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={newLabelLang}
                        onChange={(e) => setNewLabelLang(e.target.value)}
                        className="w-24 pl-9 pr-2 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-slate-50 focus:bg-white transition-all text-center uppercase text-sm"
                        placeholder="DE"
                        maxLength={5}
                      />
                    </div>
                    <input
                      type="text"
                      value={newLabelValue}
                      onChange={(e) => setNewLabelValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLabel())}
                      className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-slate-50 focus:bg-white transition-all text-sm"
                      placeholder="Übersetzung…"
                    />
                    <button
                      type="button"
                      onClick={addLabel}
                      className="px-4 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Color */}
                <div>
                  <FieldLabel de="Farbe" en="Color" />
                  <div className="flex items-center gap-3">
                    <div className="relative w-11 h-11 rounded-xl overflow-hidden border-2 border-slate-200 shadow-sm shrink-0">
                      <input
                        type="color"
                        value={formData.color || '#3b82f6'}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        className="absolute -inset-2 w-16 h-16 cursor-pointer"
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.color || ''}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="flex-1 max-w-[180px] px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-slate-50 focus:bg-white transition-all font-mono text-sm"
                      placeholder="#3b82f6"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0">
        <span className="text-xs text-slate-400 hidden sm:block">
          {canSave ? 'Bereit zum Speichern · Ready to save' : 'Titel eingeben, um zu starten · Enter a title to start'}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-colors"
          >
            Abbrechen · Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={!canSave || saving}
            className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-sm shadow-blue-600/20 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isNew ? 'Begriff erstellen · Create' : 'Speichern · Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeywordDetail;
