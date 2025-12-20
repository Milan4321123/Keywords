'use client';

import React, { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Plus, MoreHorizontal, Folder, FileText, Tag } from 'lucide-react';
import { Keyword } from '@/types';

interface KeywordTreeProps {
  keywords: Keyword[];
  selectedId: string | null;
  onSelect: (keyword: Keyword) => void;
  onAddChild: (parentId: string | null) => void;
  onDelete?: (keyword: Keyword) => void;
}

interface TreeNodeProps {
  keyword: Keyword;
  level: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (keyword: Keyword) => void;
  onAddChild: (parentId: string) => void;
  onContextMenu: (e: React.MouseEvent, keyword: Keyword) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  keyword,
  level,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  onAddChild,
  onContextMenu,
}) => {
  const hasChildren = keyword.children && keyword.children.length > 0;
  const isExpanded = expandedIds.has(keyword.id);
  const isSelected = selectedId === keyword.id;

  const getIcon = () => {
    if (hasChildren) {
      return <Folder className="w-4 h-4 text-blue-500" />;
    }
    return <Tag className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="select-none">
      <div
        className={`
          flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer
          hover:bg-gray-100 transition-colors group
          ${isSelected ? 'bg-blue-50 text-blue-700' : ''}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(keyword)}
        onContextMenu={(e) => onContextMenu(e, keyword)}
      >
        {/* Expand/collapse button */}
        <button
          className={`p-0.5 rounded hover:bg-gray-200 ${!hasChildren ? 'invisible' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(keyword.id);
          }}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {/* Icon */}
        {getIcon()}

        {/* Title */}
        <span className="flex-1 text-sm font-medium truncate">
          {keyword.title}
        </span>

        {/* Color indicator */}
        {keyword.color && (
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: keyword.color }}
          />
        )}

        {/* Action buttons (visible on hover) */}
        <div className="hidden group-hover:flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-gray-200"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild(keyword.id);
            }}
            title="Add sub-keyword"
          >
            <Plus className="w-3 h-3 text-gray-500" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-200"
            onClick={(e) => onContextMenu(e, keyword)}
            title="More options"
          >
            <MoreHorizontal className="w-3 h-3 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="tree-children">
          {keyword.children!.map((child) => (
            <TreeNode
              key={child.id}
              keyword={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const KeywordTree: React.FC<KeywordTreeProps> = ({
  keywords,
  selectedId,
  onSelect,
  onAddChild,
  onDelete,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    keyword: Keyword;
  } | null>(null);

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, keyword: Keyword) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, keyword });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Build tree structure from flat list
  const buildTree = (items: Keyword[], parentId: string | null = null): Keyword[] => {
    return items
      .filter((item) => item.parent_id === parentId)
      .map((item) => ({
        ...item,
        children: buildTree(items, item.id),
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  };

  const treeData = buildTree(keywords);

  // Expand all ancestors of selected item
  React.useEffect(() => {
    if (selectedId) {
      const findAncestors = (id: string, items: Keyword[]): string[] => {
        const item = items.find((k) => k.id === id);
        if (!item || !item.parent_id) return [];
        return [item.parent_id, ...findAncestors(item.parent_id, items)];
      };
      const ancestors = findAncestors(selectedId, keywords);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [selectedId, keywords]);

  return (
    <div className="relative" onClick={closeContextMenu}>
      {/* Header with add button */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold text-gray-600">Keywords</span>
        <button
          className="p-1 rounded hover:bg-gray-100"
          onClick={() => onAddChild(null)}
          title="Add root keyword"
        >
          <Plus className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Tree */}
      <div className="py-2 overflow-auto max-h-[calc(100vh-200px)]">
        {treeData.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            No keywords yet.
            <br />
            <button
              className="mt-2 text-blue-500 hover:underline"
              onClick={() => onAddChild(null)}
            >
              Add your first keyword
            </button>
          </div>
        ) : (
          treeData.map((keyword) => (
            <TreeNode
              key={keyword.id}
              keyword={keyword}
              level={0}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border rounded-lg shadow-lg py-1 z-50 min-w-[150px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
            onClick={() => {
              onAddChild(contextMenu.keyword.id);
              closeContextMenu();
            }}
          >
            Add sub-keyword
          </button>
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
            onClick={() => {
              onSelect(contextMenu.keyword);
              closeContextMenu();
            }}
          >
            Edit keyword
          </button>
          {onDelete && (
            <button
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                onDelete(contextMenu.keyword);
                closeContextMenu();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default KeywordTree;
