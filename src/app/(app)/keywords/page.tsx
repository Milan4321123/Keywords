'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Database, 
  Settings, 
  Search,
  PanelLeftClose,
  PanelLeft,
  FileUp,
  Link2,
  MessageSquare
} from 'lucide-react';
import { Keyword, Asset, KeywordRelation } from '@/types';
import KeywordTree from '@/components/KeywordTree';
import KeywordDetail from '@/components/KeywordDetail';
import FileUpload from '@/components/FileUpload';
import RelationEditor from '@/components/RelationEditor';
import AIAssistant from '@/components/AIAssistant';

type ViewMode = 'edit' | 'upload' | 'relations' | 'chat';

export default function Home() {
  // State
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [selectedKeyword, setSelectedKeyword] = useState<Keyword | null>(null);
  const [relations, setRelations] = useState<KeywordRelation[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isNewKeyword, setIsNewKeyword] = useState(false);
  const [newKeywordParentId, setNewKeywordParentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch keywords on mount
  useEffect(() => {
    fetchKeywords();
  }, []);

  // Fetch keyword details when selected
  useEffect(() => {
    if (selectedKeyword && !isNewKeyword) {
      fetchKeywordDetails(selectedKeyword.id);
    }
  }, [selectedKeyword?.id, isNewKeyword]);

  const fetchKeywords = async () => {
    try {
      const response = await fetch('/api/keywords');
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setKeywords(data || []);
    } catch (error) {
      console.error('Failed to fetch keywords:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchKeywordDetails = async (id: string) => {
    try {
      const response = await fetch(`/api/keywords/${id}`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      
      setSelectedKeyword(data);
      setRelations(data.relations || []);
      setAssets(data.assets || []);
    } catch (error) {
      console.error('Failed to fetch keyword details:', error);
    }
  };

  const handleSelectKeyword = useCallback((keyword: Keyword) => {
    setSelectedKeyword(keyword);
    setIsNewKeyword(false);
    setViewMode('edit');
  }, []);

  const handleAddChild = useCallback((parentId: string | null) => {
    setSelectedKeyword(null);
    setIsNewKeyword(true);
    setNewKeywordParentId(parentId);
    setViewMode('edit');
  }, []);

  const handleSaveKeyword = async (keywordData: Partial<Keyword>) => {
    try {
      const url = isNewKeyword ? '/api/keywords' : `/api/keywords/${selectedKeyword?.id}`;
      const method = isNewKeyword ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...keywordData,
          parent_id: isNewKeyword ? newKeywordParentId : keywordData.parent_id,
        }),
      });

      const { data, error } = await response.json();
      if (error) throw new Error(error);

      // Refresh keywords list
      await fetchKeywords();
      
      // Select the new/updated keyword
      setSelectedKeyword(data);
      setIsNewKeyword(false);
    } catch (error) {
      console.error('Failed to save keyword:', error);
    }
  };

  const handleDeleteKeyword = async (id: string) => {
    if (!confirm('Are you sure you want to delete this keyword?')) return;

    try {
      const response = await fetch(`/api/keywords/${id}`, {
        method: 'DELETE',
      });

      const { error } = await response.json();
      if (error) throw new Error(error);

      // Refresh and clear selection
      await fetchKeywords();
      setSelectedKeyword(null);
    } catch (error) {
      console.error('Failed to delete keyword:', error);
    }
  };

  const handleCloseDetail = useCallback(() => {
    setSelectedKeyword(null);
    setIsNewKeyword(false);
  }, []);

  const handleUploadFiles = async (files: File[]) => {
    if (!selectedKeyword) return;

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('keyword_id', selectedKeyword.id);

      try {
        const response = await fetch('/api/assets/upload', {
          method: 'POST',
          body: formData,
        });

        const { data, error } = await response.json();
        if (error) throw new Error(error);

        setAssets((prev) => [...prev, data]);
      } catch (error) {
        console.error('Failed to upload file:', error);
      }
    }
  };

  const handleRemoveAsset = async (assetId: string) => {
    // In a real app, implement asset removal
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
  };

  const handleAddRelation = async (relation: Omit<KeywordRelation, 'id' | 'created_at'>) => {
    try {
      const response = await fetch('/api/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relation),
      });

      const { data, error } = await response.json();
      if (error) throw new Error(error);

      setRelations((prev) => [...prev, data]);
    } catch (error) {
      console.error('Failed to add relation:', error);
    }
  };

  const handleRemoveRelation = async (relationId: string) => {
    try {
      const response = await fetch(`/api/relations?id=${relationId}`, {
        method: 'DELETE',
      });

      const { error } = await response.json();
      if (error) throw new Error(error);

      setRelations((prev) => prev.filter((r) => r.id !== relationId));
    } catch (error) {
      console.error('Failed to remove relation:', error);
    }
  };

  // Filter keywords by search
  const filteredKeywords = searchQuery
    ? keywords.filter((k) =>
        k.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        k.definition?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : keywords;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`
          flex flex-col bg-white border-r transition-all duration-300
          ${sidebarOpen ? 'w-72' : 'w-0 overflow-hidden'}
        `}
      >
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 px-4 py-4 border-b">
          <div className="p-2 bg-blue-500 rounded-lg">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-800">Knowledge Base</h1>
            <p className="text-xs text-gray-500">Company Ontology</p>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keywords..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Keyword Tree */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <KeywordTree
              keywords={filteredKeywords}
              selectedId={selectedKeyword?.id || null}
              onSelect={handleSelectKeyword}
              onAddChild={handleAddChild}
              onDelete={(kw) => handleDeleteKeyword(kw.id)}
            />
          )}
        </div>

        {/* Settings */}
        <div className="p-3 border-t">
          <button className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 bg-white border-b">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-5 h-5 text-gray-500" />
              ) : (
                <PanelLeft className="w-5 h-5 text-gray-500" />
              )}
            </button>
            <h2 className="font-semibold text-gray-800">
              {isNewKeyword
                ? 'New Keyword'
                : selectedKeyword?.title || 'Select a keyword'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Tabs */}
            {(selectedKeyword || isNewKeyword) && (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('edit')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                    viewMode === 'edit'
                      ? 'bg-white shadow text-gray-800'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Edit
                </button>
                {!isNewKeyword && (
                  <>
                    <button
                      onClick={() => setViewMode('upload')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                        viewMode === 'upload'
                          ? 'bg-white shadow text-gray-800'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      <FileUp className="w-4 h-4" />
                      Files
                    </button>
                    <button
                      onClick={() => setViewMode('relations')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                        viewMode === 'relations'
                          ? 'bg-white shadow text-gray-800'
                          : 'text-gray-600 hover:text-gray-800'
                      }`}
                    >
                      <Link2 className="w-4 h-4" />
                      Relations
                    </button>
                  </>
                )}
                <button
                  onClick={() => setViewMode('chat')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                    viewMode === 'chat'
                      ? 'bg-white shadow text-gray-800'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  Ask AI
                </button>
              </div>
            )}

            <Link
              href="/analytics"
              className="px-3 py-1.5 rounded-lg text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            >
              Analytics
            </Link>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          {!selectedKeyword && !isNewKeyword ? (
            // Empty state
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="p-4 bg-blue-50 rounded-full mb-4">
                <Database className="w-12 h-12 text-blue-500" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">
                Welcome to your Knowledge Base
              </h3>
              <p className="text-gray-500 max-w-md mb-6">
                Select a keyword from the tree to view or edit its details,
                or create a new one to start building your company ontology.
              </p>
              <button
                onClick={() => handleAddChild(null)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Create Your First Keyword
              </button>
            </div>
          ) : viewMode === 'edit' ? (
            // Edit Mode
            <div className="max-w-3xl mx-auto">
              <KeywordDetail
                keyword={isNewKeyword ? null : selectedKeyword}
                allKeywords={keywords}
                onSave={handleSaveKeyword}
                onDelete={handleDeleteKeyword}
                onClose={handleCloseDetail}
                isNew={isNewKeyword}
                parentId={newKeywordParentId}
              />
            </div>
          ) : viewMode === 'upload' && selectedKeyword ? (
            // Upload Mode
            <div className="max-w-2xl mx-auto">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Evidence & Documents
              </h3>
              <p className="text-gray-500 mb-6">
                Upload files to link as evidence to "{selectedKeyword.title}".
                These will be used by the AI for answering questions.
              </p>
              <FileUpload
                keywordId={selectedKeyword.id}
                existingAssets={assets}
                onUpload={handleUploadFiles}
                onRemove={handleRemoveAsset}
                onViewAsset={(asset) => window.open(asset.file_url, '_blank')}
              />
            </div>
          ) : viewMode === 'relations' && selectedKeyword ? (
            // Relations Mode
            <div className="max-w-3xl mx-auto">
              <RelationEditor
                keyword={selectedKeyword}
                allKeywords={keywords}
                relations={relations}
                onAddRelation={handleAddRelation}
                onRemoveRelation={handleRemoveRelation}
              />
            </div>
          ) : viewMode === 'chat' ? (
            // AI Chat Mode
            <div className="max-w-3xl mx-auto h-[calc(100vh-200px)]">
              <AIAssistant
                keywords={keywords}
                selectedKeywordIds={selectedKeyword ? [selectedKeyword.id] : []}
                onSelectKeyword={(id) => {
                  const kw = keywords.find((k) => k.id === id);
                  if (kw) handleSelectKeyword(kw);
                }}
                onKeywordsCreated={fetchKeywords}
              />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
