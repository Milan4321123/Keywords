'use client';

import React, { useState, useEffect } from 'react';
import {
  Save,
  Trash2,
  Plus,
  X,
  Languages,
  BookOpen,
  ListChecks,
  Sparkles,
  Loader2,
  Check
} from 'lucide-react';
import { Keyword, KeywordType, KeywordStatus, RelationType } from '@/types';
import VoiceInput from './VoiceInput';

const KEYWORD_TYPE_OPTIONS: { value: KeywordType; label: string }[] = [
  { value: 'concept', label: 'Concept' },
  { value: 'process', label: 'Process' },
  { value: 'metric', label: 'Metric' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'document_type', label: 'Document Type' },
  { value: 'role', label: 'Role' },
  { value: 'task_type', label: 'Task Type' },
  { value: 'workflow_step', label: 'Workflow Step' },
  { value: 'department', label: 'Department' },
  { value: 'entity', label: 'Entity' },
  { value: 'kpi', label: 'KPI' },
  { value: 'report_type', label: 'Report Type' },
  { value: 'risk', label: 'Risk' },
  { value: 'rule', label: 'Rule' },
  { value: 'skill', label: 'Skill' },
];

const KEYWORD_STATUS_OPTIONS: { value: KeywordStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
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

const RELATION_TYPES: { value: RelationType; label: string; description: string }[] = [
  { value: 'is-a', label: 'Is A', description: 'Invoice is-a Document' },
  { value: 'part-of', label: 'Part Of', description: 'Trade is part-of Project' },
  { value: 'requires', label: 'Requires', description: 'Invoice requires Approval' },
  { value: 'causes', label: 'Causes', description: 'Defect causes Rework' },
  { value: 'leads-to', label: 'Leads To', description: 'Issue leads-to Repair' },
  { value: 'owned-by', label: 'Owned By', description: 'Project owned-by Manager' },
  { value: 'depends-on', label: 'Depends On', description: 'Payment depends-on Approval' },
  { value: 'related-to', label: 'Related To', description: 'Generic relation' },
  { value: 'contains', label: 'Contains', description: 'Project contains Invoices' },
  { value: 'approves', label: 'Approves', description: 'Manager approves Invoice' },
];

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

  const [newExample, setNewExample] = useState('');
  const [newSynonym, setNewSynonym] = useState('');
  const [newRule, setNewRule] = useState('');
  const [newLabelLang, setNewLabelLang] = useState('');
  const [newLabelValue, setNewLabelValue] = useState('');
  const [activeTab, setActiveTab] = useState<'basic' | 'examples' | 'relations' | 'advanced'>('basic');
  const [suggestion, setSuggestion] = useState<DefinitionSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

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
      });
    }
  }, [keyword, isNew, parentId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title?.trim()) {
      alert('Please enter a title for the keyword');
      return;
    }
    onSave({
      ...formData,
      id: isNew ? undefined : keyword?.id,
      slug: formData.title?.toLowerCase().replace(/\s+/g, '-'),
    });
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
      setSuggestError(err.message || 'Failed to get suggestion');
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
      setFormData((prev) => ({
        ...prev,
        examples: [...(prev.examples || []), text],
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: text,
      }));
    }
  };

  const addExample = () => {
    if (newExample.trim()) {
      setFormData((prev) => ({
        ...prev,
        examples: [...(prev.examples || []), newExample.trim()],
      }));
      setNewExample('');
    }
  };

  const removeExample = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      examples: prev.examples?.filter((_, i) => i !== index),
    }));
  };

  const addSynonym = () => {
    if (newSynonym.trim()) {
      setFormData((prev) => ({
        ...prev,
        synonyms: [...(prev.synonyms || []), newSynonym.trim()],
      }));
      setNewSynonym('');
    }
  };

  const removeSynonym = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      synonyms: prev.synonyms?.filter((_, i) => i !== index),
    }));
  };

  const addRule = () => {
    if (newRule.trim()) {
      setFormData((prev) => ({
        ...prev,
        rules: [...(prev.rules || []), newRule.trim()],
      }));
      setNewRule('');
    }
  };

  const removeRule = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      rules: prev.rules?.filter((_, i) => i !== index),
    }));
  };

  const addLabel = () => {
    if (newLabelLang.trim() && newLabelValue.trim()) {
      setFormData((prev) => ({
        ...prev,
        labels_json: {
          ...prev.labels_json,
          [newLabelLang.toLowerCase()]: newLabelValue,
        },
      }));
      setNewLabelLang('');
      setNewLabelValue('');
    }
  };

  const removeLabel = (lang: string) => {
    setFormData((prev) => {
      const newLabels = { ...prev.labels_json };
      delete newLabels[lang];
      return { ...prev, labels_json: newLabels };
    });
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            {isNew ? <Plus className="w-5 h-5" /> : <BookOpen className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">
              {isNew ? 'New Concept' : `Edit: ${keyword?.title}`}
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              {isNew ? 'Define a new concept in your ontology' : 'Update concept properties'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && keyword && (
            <button
              onClick={() => onDelete(keyword.id)}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              title="Delete concept"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 px-6 bg-slate-50/50">
        {[
          { id: 'basic', label: 'Basic Info', icon: BookOpen },
          { id: 'examples', label: 'Examples & Rules', icon: ListChecks },
          { id: 'advanced', label: 'Advanced', icon: Languages },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`
              flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 -mb-px transition-colors
              ${activeTab === tab.id
                ? 'border-blue-500 text-blue-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
              }
            `}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8">
        {activeTab === 'basic' && (
          <div className="space-y-8 max-w-3xl">
            {/* Title */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                Concept Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.title || ''}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-3 text-lg font-medium border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
                placeholder="e.g., Invoice, Project, Defect"
                required
              />
            </div>

            {/* Parent */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                Parent Concept
              </label>
              <select
                value={formData.parent_id || ''}
                onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all text-slate-700"
              >
                <option value="">None (Root level)</option>
                {allKeywords
                  .filter((k) => k.id !== keyword?.id)
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.title}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-slate-500 font-medium">Select a broader concept that this concept belongs to.</p>
            </div>

            {/* Type & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700">Type</label>
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
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700">Status</label>
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

            {/* AI suggestion panel */}
            {suggestion && (
              <div className="p-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
                  <Sparkles className="w-4 h-4" />
                  AI suggestion — review before applying
                </div>
                <div className="text-sm text-slate-700">
                  <span className="font-semibold">Definition:</span> {suggestion.definition}
                </div>
                {suggestion.explanation && (
                  <div className="text-sm text-slate-600 leading-relaxed">
                    <span className="font-semibold text-slate-700">Explanation:</span> {suggestion.explanation}
                  </div>
                )}
                {suggestion.examples?.length > 0 && (
                  <ul className="text-sm text-slate-600 list-disc pl-5 space-y-0.5">
                    {suggestion.examples.map((ex, i) => (
                      <li key={i}>{ex}</li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    <Check className="w-4 h-4" /> Apply to form
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestion(null)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    Dismiss
                  </button>
                  <span className="text-xs text-slate-400">Nothing is saved until you press Save.</span>
                </div>
              </div>
            )}
            {suggestError && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {suggestError}
              </div>
            )}

            {/* Definition with Voice */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-slate-700">
                  Short Definition
                </label>
                <div className="flex items-center gap-2">
                  {!isNew && keyword && (
                    <button
                      type="button"
                      onClick={requestSuggestion}
                      disabled={suggesting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 disabled:opacity-60 transition-colors"
                    >
                      {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Suggest with AI
                    </button>
                  )}
                  <VoiceInput
                    targetField="definition"
                    onTranscript={(text) => handleVoiceTranscript(text, 'definition')}
                  />
                </div>
              </div>
              <textarea
                value={formData.definition || ''}
                onChange={(e) => setFormData({ ...formData, definition: e.target.value })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all resize-none"
                rows={3}
                placeholder="A concise 1-2 sentence definition..."
              />
            </div>

            {/* Explanation with Voice */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-slate-700">
                  Detailed Explanation
                </label>
                <VoiceInput
                  targetField="explanation"
                  onTranscript={(text) => handleVoiceTranscript(text, 'explanation')}
                />
              </div>
              <textarea
                value={formData.explanation || ''}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
                rows={6}
                placeholder="Provide a comprehensive explanation of this concept, its context, and how it's used..."
              />
            </div>

            {/* Synonyms */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <label className="block text-sm font-bold text-slate-700">
                Synonyms & Alternative Names
              </label>
              <div className="flex flex-wrap gap-2">
                {formData.synonyms?.map((syn, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-sm font-medium text-slate-700"
                  >
                    {syn}
                    <button
                      type="button"
                      onClick={() => removeSynonym(i)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSynonym}
                  onChange={(e) => setNewSynonym(e.target.value)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
                  placeholder="Add a synonym..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSynonym())}
                />
                <button
                  type="button"
                  onClick={addSynonym}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'examples' && (
          <div className="space-y-8 max-w-3xl">
            {/* Examples */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-bold text-slate-700">
                    Examples
                  </label>
                  <p className="text-xs text-slate-500 font-medium mt-1">Real-world instances of this concept</p>
                </div>
                <VoiceInput
                  targetField="example"
                  onTranscript={(text) => handleVoiceTranscript(text, 'example')}
                />
              </div>
              
              {formData.examples && formData.examples.length > 0 && (
                <div className="space-y-3">
                  {formData.examples.map((ex, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-4 bg-blue-50/50 border border-blue-100 rounded-xl group"
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                        {i + 1}
                      </div>
                      <span className="flex-1 text-sm text-slate-700 leading-relaxed">{ex}</span>
                      <button
                        type="button"
                        onClick={() => removeExample(i)}
                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newExample}
                  onChange={(e) => setNewExample(e.target.value)}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
                  placeholder="Add a new example..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addExample())}
                />
                <button
                  type="button"
                  onClick={addExample}
                  className="px-5 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Rules */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div>
                <label className="block text-sm font-bold text-slate-700">
                  Rules & Constraints
                </label>
                <p className="text-xs text-slate-500 font-medium mt-1">Business logic or conditions that apply to this concept</p>
              </div>
              
              {formData.rules && formData.rules.length > 0 && (
                <div className="space-y-3">
                  {formData.rules.map((rule, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-4 bg-amber-50/50 border border-amber-100 rounded-xl group"
                    >
                      <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                        {i + 1}
                      </div>
                      <span className="flex-1 text-sm text-slate-700 leading-relaxed">{rule}</span>
                      <button
                        type="button"
                        onClick={() => removeRule(i)}
                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
                  placeholder="e.g., An invoice must have date + amount + supplier"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRule())}
                />
                <button
                  type="button"
                  onClick={addRule}
                  className="px-5 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="space-y-8 max-w-3xl">
            {/* Multilingual Labels */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700">
                  Multilingual Labels
                </label>
                <p className="text-xs text-slate-500 font-medium mt-1">Translations for this concept in other languages</p>
              </div>
              
              {Object.keys(formData.labels_json || {}).length > 0 && (
                <div className="space-y-3">
                  {Object.entries(formData.labels_json || {}).map(([lang, value]) => (
                    <div
                      key={lang}
                      className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl group"
                    >
                      <span className="w-10 h-10 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold uppercase">
                        {lang}
                      </span>
                      <span className="flex-1 text-sm font-medium text-slate-700">{value}</span>
                      <button
                        type="button"
                        onClick={() => removeLabel(lang)}
                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabelLang}
                  onChange={(e) => setNewLabelLang(e.target.value)}
                  className="w-24 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all text-center uppercase"
                  placeholder="e.g. DE"
                  maxLength={2}
                />
                <input
                  type="text"
                  value={newLabelValue}
                  onChange={(e) => setNewLabelValue(e.target.value)}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all"
                  placeholder="Translation..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addLabel())}
                />
                <button
                  type="button"
                  onClick={addLabel}
                  className="px-5 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>

            {/* Color */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <label className="block text-sm font-bold text-slate-700">
                UI Color Theme
              </label>
              <div className="flex items-center gap-4">
                <div className="relative w-12 h-12 rounded-xl overflow-hidden border-2 border-slate-200 shadow-sm shrink-0">
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
                  className="flex-1 max-w-[200px] px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-300 bg-slate-50 focus:bg-white transition-all font-mono text-sm"
                  placeholder="#3b82f6"
                />
              </div>
            </div>
          </div>
        )}
      </form>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-sm shadow-blue-600/20 transition-all active:scale-95"
        >
          <Save className="w-4 h-4" />
          {isNew ? 'Create Concept' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default KeywordDetail;
