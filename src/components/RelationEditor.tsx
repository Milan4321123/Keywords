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
        <h3 className="text-sm font-semibold text-gray-700">
          Relations for "{keyword.title}"
        </h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Add Relation
          </button>
        )}
      </div>

      {/* Add New Relation Form */}
      {isAdding && (
        <div className="p-4 bg-blue-50 rounded-xl space-y-4">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{keyword.title}</span>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </div>

          {/* Relation Type */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Relation Type</label>
            <select
              value={newRelation.relation_type}
              onChange={(e) =>
                setNewRelation({ ...newRelation, relation_type: e.target.value as RelationType })
              }
              className="w-full px-3 py-2 border rounded-lg bg-white"
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
            <label className="block text-sm text-gray-600 mb-1">Target Keyword</label>
            <select
              value={newRelation.to_keyword_id}
              onChange={(e) =>
                setNewRelation({ ...newRelation, to_keyword_id: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-lg bg-white"
            >
              <option value="">Select a keyword...</option>
              {availableKeywords.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title}
                </option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Note (optional)</label>
            <input
              type="text"
              value={newRelation.note}
              onChange={(e) => setNewRelation({ ...newRelation, note: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="Why are they related?"
            />
          </div>

          {/* Bidirectional */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newRelation.bidirectional}
              onChange={(e) =>
                setNewRelation({ ...newRelation, bidirectional: e.target.checked })
              }
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-600">Bidirectional (both ways)</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newRelation.to_keyword_id}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              Add Relation
            </button>
          </div>
        </div>
      )}

      {/* Outgoing Relations */}
      {outgoingRelations.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Outgoing Relations
          </h4>
          <div className="space-y-2">
            {outgoingRelations.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-3 p-3 bg-white border rounded-lg group"
              >
                <span className="font-medium text-gray-800">{keyword.title}</span>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getRelationColor(
                    rel.relation_type
                  )}`}
                >
                  {rel.relation_type}
                </span>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-gray-800">
                  {getKeywordTitle(rel.to_keyword_id)}
                </span>
                {rel.note && (
                  <span className="text-sm text-gray-500 italic">({rel.note})</span>
                )}
                {rel.bidirectional && (
                  <span title="Bidirectional">
                    <Link2 className="w-4 h-4 text-gray-400" />
                  </span>
                )}
                <button
                  onClick={() => onRemoveRelation(rel.id)}
                  className="ml-auto p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
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
        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Incoming Relations
          </h4>
          <div className="space-y-2">
            {incomingRelations.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-3 p-3 bg-gray-50 border rounded-lg"
              >
                <span className="font-medium text-gray-600">
                  {getKeywordTitle(rel.from_keyword_id)}
                </span>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getRelationColor(
                    rel.relation_type
                  )}`}
                >
                  {rel.relation_type}
                </span>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-gray-800">{keyword.title}</span>
                {rel.note && (
                  <span className="text-sm text-gray-500 italic">({rel.note})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {outgoingRelations.length === 0 && incomingRelations.length === 0 && !isAdding && (
        <div className="text-center py-8 text-gray-400">
          <Link2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No relations defined yet.</p>
          <button
            onClick={() => setIsAdding(true)}
            className="mt-2 text-blue-500 hover:underline text-sm"
          >
            Add your first relation
          </button>
        </div>
      )}
    </div>
  );
};

export default RelationEditor;
