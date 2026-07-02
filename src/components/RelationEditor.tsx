'use client';

import React, { useState, useEffect } from 'react';
import { Plus, X, ArrowRight, Link2, Trash2 } from 'lucide-react';
import { Keyword, KeywordRelation, RelationType } from '@/types';

interface RelationEditorProps {
  keyword: Keyword;
  allKeywords: Keyword[];
  relations: KeywordRelation[];
  onAddRelation: (relation: Omit<KeywordRelation, 'id' | 'created_at'>) => void;
  onRemoveRelation: (relationId: string) => void;
}

const RELATION_TYPES: { value: RelationType; label: string; icon: string }[] = [
  { value: 'is-a', label: 'Is A', icon: '⊂' },
  { value: 'part-of', label: 'Part Of', icon: '∈' },
  { value: 'requires', label: 'Requires', icon: '→' },
  { value: 'causes', label: 'Causes', icon: '⇒' },
  { value: 'leads-to', label: 'Leads To', icon: '↝' },
  { value: 'owned-by', label: 'Owned By', icon: '◇' },
  { value: 'depends-on', label: 'Depends On', icon: '⤳' },
  { value: 'related-to', label: 'Related To', icon: '↔' },
  { value: 'contains', label: 'Contains', icon: '⊃' },
  { value: 'approves', label: 'Approves', icon: '✓' },
  { value: 'triggers', label: 'Triggers', icon: '⚡' },
  { value: 'blocks', label: 'Blocks', icon: '⊗' },
  { value: 'succeeds', label: 'Succeeds', icon: '»' },
  { value: 'precedes', label: 'Precedes', icon: '«' },
];

const getRelationColor = (type: RelationType): string => {
  const colors: Record<string, string> = {
    'is-a': 'bg-purple-100 text-purple-700 border-purple-300',
    'part-of': 'bg-blue-100 text-blue-700 border-blue-300',
    'requires': 'bg-amber-100 text-amber-700 border-amber-300',
    'causes': 'bg-red-100 text-red-700 border-red-300',
    'leads-to': 'bg-orange-100 text-orange-700 border-orange-300',
    'owned-by': 'bg-green-100 text-green-700 border-green-300',
    'depends-on': 'bg-pink-100 text-pink-700 border-pink-300',
    'related-to': 'bg-gray-100 text-gray-700 border-gray-300',
    'contains': 'bg-indigo-100 text-indigo-700 border-indigo-300',
    'approves': 'bg-emerald-100 text-emerald-700 border-emerald-300',
    'triggers': 'bg-yellow-100 text-yellow-700 border-yellow-300',
    'blocks': 'bg-red-100 text-red-700 border-red-300',
    'succeeds': 'bg-cyan-100 text-cyan-700 border-cyan-300',
    'precedes': 'bg-teal-100 text-teal-700 border-teal-300',
  };
  return colors[type] || colors['related-to'];
};

export const RelationEditor: React.FC<RelationEditorProps> = ({
  keyword,
  allKeywords,
  relations,
  onAddRelation,
  onRemoveRelation,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newRelation, setNewRelation] = useState({
    relation_type: 'related-to' as RelationType,
    to_keyword_id: '',
    note: '',
    bidirectional: false,
  });

  // Filter out self and already related keywords
  const relatedKeywordIds = new Set(relations.map((r) => r.to_keyword_id));
  const availableKeywords = allKeywords.filter(
    (k) => k.id !== keyword.id && !relatedKeywordIds.has(k.id)
  );

  // Group relations by type
  const outgoingRelations = relations.filter((r) => r.from_keyword_id === keyword.id);
  const incomingRelations = relations.filter((r) => r.to_keyword_id === keyword.id);

  const handleAdd = () => {
    if (!newRelation.to_keyword_id) return;

    onAddRelation({
      from_keyword_id: keyword.id,
      relation_type: newRelation.relation_type,
      to_keyword_id: newRelation.to_keyword_id,
      note: newRelation.note || null,
      strength: 5,
      bidirectional: newRelation.bidirectional,
    });

    setNewRelation({
      relation_type: 'related-to',
      to_keyword_id: '',
      note: '',
      bidirectional: false,
    });
    setIsAdding(false);
  };

  const getKeywordTitle = (id: string) => {
    return allKeywords.find((k) => k.id === id)?.title || 'Unknown';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-slate-400" />
          Relations for "{keyword.title}"
        </h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Relation
          </button>
        )}
      </div>

      {/* Add New Relation Form */}
      {isAdding && (
        <div className="p-5 bg-slate-50/50 border border-slate-200 rounded-2xl space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 shadow-sm">
              {keyword.title}
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Relation Type */}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Relation Type</label>
              <select
                value={newRelation.relation_type}
                onChange={(e) =>
                  setNewRelation({ ...newRelation, relation_type: e.target.value as RelationType })
                }
                className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all text-slate-700"
              >
                {RELATION_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.icon} {rt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Keyword */}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Target Keyword</label>
              <select
                value={newRelation.to_keyword_id}
                onChange={(e) =>
                  setNewRelation({ ...newRelation, to_keyword_id: e.target.value })
                }
                className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all text-slate-700"
              >
                <option value="">Select a keyword...</option>
                {availableKeywords.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Note (optional)</label>
            <input
              type="text"
              value={newRelation.note}
              onChange={(e) => setNewRelation({ ...newRelation, note: e.target.value })}
              className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all text-slate-700 placeholder-slate-400"
              placeholder="Why are they related?"
            />
          </div>

          {/* Bidirectional */}
          <label className="flex items-center gap-2.5 cursor-pointer group w-fit">
            <div className="relative flex items-center justify-center">
              <input
                type="checkbox"
                checked={newRelation.bidirectional}
                onChange={(e) =>
                  setNewRelation({ ...newRelation, bidirectional: e.target.checked })
                }
                className="peer w-5 h-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500/20 transition-all cursor-pointer"
              />
            </div>
            <span className="text-sm font-medium text-slate-600 group-hover:text-slate-800 transition-colors">Bidirectional (both ways)</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newRelation.to_keyword_id}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-600/20 transition-all active:scale-[0.98]"
            >
              Add Relation
            </button>
          </div>
        </div>
      )}

      {/* Outgoing Relations */}
      {outgoingRelations.length > 0 && (
        <div className="animate-in fade-in duration-300">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Outgoing Relations
          </h4>
          <div className="space-y-2">
            {outgoingRelations.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl group hover:border-blue-300 hover:shadow-sm transition-all duration-200"
              >
                <span className="text-sm font-bold text-slate-700">{keyword.title}</span>
                <span
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border ${getRelationColor(
                    rel.relation_type
                  )}`}
                >
                  {rel.relation_type}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-300" />
                <span className="text-sm font-bold text-slate-700">
                  {getKeywordTitle(rel.to_keyword_id)}
                </span>
                {rel.note && (
                  <span className="text-xs font-medium text-slate-500 italic bg-slate-50 px-2 py-0.5 rounded-md">({rel.note})</span>
                )}
                {rel.bidirectional && (
                  <span title="Bidirectional" className="bg-slate-50 p-1 rounded-md">
                    <Link2 className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                )}
                <button
                  onClick={() => onRemoveRelation(rel.id)}
                  className="ml-auto p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove relation"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incoming Relations */}
      {incomingRelations.length > 0 && (
        <div className="animate-in fade-in duration-300">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Incoming Relations
          </h4>
          <div className="space-y-2">
            {incomingRelations.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-3 p-3 bg-slate-50/50 border border-slate-200 rounded-xl"
              >
                <span className="text-sm font-bold text-slate-600">
                  {getKeywordTitle(rel.from_keyword_id)}
                </span>
                <span
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border ${getRelationColor(
                    rel.relation_type
                  )}`}
                >
                  {rel.relation_type}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-300" />
                <span className="text-sm font-bold text-slate-800">{keyword.title}</span>
                {rel.note && (
                  <span className="text-xs font-medium text-slate-500 italic bg-white border border-slate-100 px-2 py-0.5 rounded-md">({rel.note})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {outgoingRelations.length === 0 && incomingRelations.length === 0 && !isAdding && (
        <div className="text-center py-12 bg-slate-50/50 border border-slate-200 border-dashed rounded-2xl">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center mx-auto mb-3">
            <Link2 className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-500 mb-2">No relations defined yet.</p>
          <button
            onClick={() => setIsAdding(true)}
            className="text-sm font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
          >
            Add your first relation
          </button>
        </div>
      )}
    </div>
  );
};

export default RelationEditor;
