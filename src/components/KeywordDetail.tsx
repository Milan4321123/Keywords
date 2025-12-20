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
  Link2
} from 'lucide-react';
import { Keyword, RelationType } from '@/types';
import VoiceInput from './VoiceInput';

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h2 className="text-lg font-semibold text-gray-800">
          {isNew ? 'New Keyword' : `Edit: ${keyword?.title}`}
        </h2>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b px-6">
        {[
          { id: 'basic', label: 'Basic', icon: BookOpen },
          { id: 'examples', label: 'Examples & Rules', icon: ListChecks },
          { id: 'advanced', label: 'Advanced', icon: Languages },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`
              flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px
              ${activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
              }
            `}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6">
        {activeTab === 'basic' && (
          <div className="space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                value={formData.title || ''}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Invoice, Project, Defect"
                required
              />
            </div>

            {/* Parent */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Parent Keyword
              </label>
              <select
                value={formData.parent_id || ''}
                onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
            </div>

            {/* Definition with Voice */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Definition (short)
                </label>
                <VoiceInput
                  targetField="definition"
                  onTranscript={(text) => handleVoiceTranscript(text, 'definition')}
                />
              </div>
              <textarea
                value={formData.definition || ''}
                onChange={(e) => setFormData({ ...formData, definition: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={2}
                placeholder="1-2 sentence definition..."
              />
            </div>

            {/* Explanation with Voice */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Explanation (detailed)
                </label>
                <VoiceInput
                  targetField="explanation"
                  onTranscript={(text) => handleVoiceTranscript(text, 'explanation')}
                />
              </div>
              <textarea
                value={formData.explanation || ''}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={5}
                placeholder="Detailed explanation of this concept..."
              />
            </div>

            {/* Synonyms */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Synonyms / Alternative Names
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {formData.synonyms?.map((syn, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                  >
                    {syn}
                    <button
                      type="button"
                      onClick={() => removeSynonym(i)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSynonym}
                  onChange={(e) => setNewSynonym(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg"
                  placeholder="Add synonym..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSynonym())}
                />
                <button
                  type="button"
                  onClick={addSynonym}
                  className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'examples' && (
          <div className="space-y-6">
            {/* Examples */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Examples
                </label>
                <VoiceInput
                  targetField="example"
                  onTranscript={(text) => handleVoiceTranscript(text, 'example')}
                />
              </div>
              <div className="space-y-2 mb-3">
                {formData.examples?.map((ex, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg"
                  >
                    <span className="flex-1 text-sm">{ex}</span>
                    <button
                      type="button"
                      onClick={() => removeExample(i)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newExample}
                  onChange={(e) => setNewExample(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg"
                  placeholder="Add example..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addExample())}
                />
                <button
                  type="button"
                  onClick={addExample}
                  className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Rules */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rules / Constraints
              </label>
              <div className="space-y-2 mb-3">
                {formData.rules?.map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg"
                  >
                    <span className="flex-1 text-sm">{rule}</span>
                    <button
                      type="button"
                      onClick={() => removeRule(i)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg"
                  placeholder="e.g., An invoice must have date + amount + supplier"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRule())}
                />
                <button
                  type="button"
                  onClick={addRule}
                  className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="space-y-6">
            {/* Multilingual Labels */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Multilingual Labels
              </label>
              <div className="space-y-2 mb-3">
                {Object.entries(formData.labels_json || {}).map(([lang, value]) => (
                  <div
                    key={lang}
                    className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg"
                  >
                    <span className="w-12 text-sm font-medium text-gray-500 uppercase">
                      {lang}
                    </span>
                    <span className="flex-1 text-sm">{value}</span>
                    <button
                      type="button"
                      onClick={() => removeLabel(lang)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabelLang}
                  onChange={(e) => setNewLabelLang(e.target.value)}
                  className="w-20 px-3 py-2 border rounded-lg"
                  placeholder="de"
                />
                <input
                  type="text"
                  value={newLabelValue}
                  onChange={(e) => setNewLabelValue(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg"
                  placeholder="German translation..."
                />
                <button
                  type="button"
                  onClick={addLabel}
                  className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Color (for UI)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={formData.color || '#3b82f6'}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-10 h-10 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.color || ''}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="flex-1 px-3 py-2 border rounded-lg"
                  placeholder="#3b82f6"
                />
              </div>
            </div>
          </div>
        )}
      </form>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
        {!isNew && (
          <button
            type="button"
            onClick={() => keyword && onDelete(keyword.id)}
            className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        )}
        <div className="flex items-center gap-3 ml-auto">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            <Save className="w-4 h-4" />
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeywordDetail;
