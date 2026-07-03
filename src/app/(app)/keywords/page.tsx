'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database, 
  Search,
  ChevronRight,
  Plus,
  FileUp,
  Link2,
  MessageSquare,
  Edit3,
  X,
  ImagePlus,
  Paperclip,
  SendHorizontal,
  FolderTree,
  Trash2,
  Sparkles
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Keyword, Asset, KeywordRelation } from '@/types';
import KeywordDetail from '@/components/KeywordDetail';
import FileUpload from '@/components/FileUpload';
import RelationEditor from '@/components/RelationEditor';
import AIAssistant from '@/components/AIAssistant';
import VoiceInput from '@/components/VoiceInput';
import ImportExportMenu from '@/components/ImportExportMenu';
import { openAsset } from '@/lib/asset-view';

function completenessDot(score: number | undefined): string {
  const s = score ?? 0;
  if (s >= 70) return 'bg-emerald-500';
  if (s >= 40) return 'bg-amber-500';
  return 'bg-red-400';
}

type ViewMode = 'edit' | 'upload' | 'relations' | 'chat';

export default function Home() {
  const router = useRouter();
  // State
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<Keyword | null>(null);
  const [relations, setRelations] = useState<KeywordRelation[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewKeyword, setIsNewKeyword] = useState(false);
  const [newKeywordParentId, setNewKeywordParentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [searchQuery, setSearchQuery] = useState('');
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const detailRequestSeqRef = useRef(0);
  const keywordDetailCacheRef = useRef<Map<string, Keyword>>(new Map());
  const quickFileInputRef = useRef<HTMLInputElement | null>(null);
  const quickImageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadNote, setUploadNote] = useState('');
  const [aiOpen, setAiOpen] = useState(false);

  // Chat scoping: which keywords the AI should focus on.
  const [chatScopeKeywordIds, setChatScopeKeywordIds] = useState<string[]>([]);

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
    const cached = keywordDetailCacheRef.current.get(id);
    if (cached) {
      setSelectedKeyword((prev) => (prev?.id === id ? cached : prev));
      setRelations((cached.relations || []) as KeywordRelation[]);
      setAssets((cached.assets || []) as Asset[]);
      return;
    }

    const seq = ++detailRequestSeqRef.current;

    try {
      const response = await fetch(`/api/keywords/${id}`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);

      if (seq !== detailRequestSeqRef.current) return;

      keywordDetailCacheRef.current.set(id, data);
      setSelectedKeyword((prev) => (prev?.id === id ? data : prev));
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

    const cached = keywordDetailCacheRef.current.get(keyword.id);
    if (cached) {
      setRelations((cached.relations || []) as KeywordRelation[]);
      setAssets((cached.assets || []) as Asset[]);
    } else {
      setRelations([]);
      setAssets([]);
    }
  }, []);

  const handleSelectKeywordById = useCallback(
    (id: string) => {
      const found = keywords.find((k) => k.id === id);
      if (found) handleSelectKeyword(found);
    },
    [keywords, handleSelectKeyword]
  );

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
      keywordDetailCacheRef.current.set(data.id, data);
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
      keywordDetailCacheRef.current.delete(id);
      setSelectedKeyword(null);
    } catch (error) {
      console.error('Failed to delete keyword:', error);
    }
  };

  const handleCloseDetail = useCallback(() => {
    setSelectedKeyword(null);
    setIsNewKeyword(false);
    setUploadNote('');
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

  const sortedKeywords = React.useMemo(
    () => [...keywords].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)),
    [keywords]
  );

  const childrenByParent = React.useMemo(() => {
    const map = new Map<string | null, Keyword[]>();
    for (const keyword of sortedKeywords) {
      const key = keyword.parent_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(keyword);
      map.set(key, arr);
    }
    return map;
  }, [sortedKeywords]);

  const roots = React.useMemo(() => childrenByParent.get(null) ?? [], [childrenByParent]);

  const selectedPath = React.useMemo(() => {
    if (!selectedKeyword) return [] as Keyword[];
    const byId = new Map(sortedKeywords.map((k) => [k.id, k] as const));
    const path: Keyword[] = [];
    let cursor: Keyword | undefined = byId.get(selectedKeyword.id);
    let guard = 0;
    while (cursor && guard < 100) {
      path.unshift(cursor);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      guard += 1;
    }
    return path;
  }, [selectedKeyword, sortedKeywords]);

  useEffect(() => {
    const pathIds = selectedPath.map((k) => k.id);
    setChatScopeKeywordIds(pathIds);
  }, [selectedPath]);

  const flowColumns = React.useMemo(() => {
    const columns: Array<{ title: string; items: Keyword[]; activeId: string | null }> = [];
    columns.push({ title: 'Root', items: roots, activeId: selectedPath[0]?.id ?? null });

    for (let i = 0; i < selectedPath.length; i += 1) {
      const parent = selectedPath[i];
      const kids = childrenByParent.get(parent.id) ?? [];
      if (kids.length > 0) {
        columns.push({
          title: i === 0 ? `${parent.title} branches` : `Level ${i + 1}`,
          items: kids,
          activeId: selectedPath[i + 1]?.id ?? null,
        });
      }
    }

    return columns;
  }, [childrenByParent, roots, selectedPath]);

  const searchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as Keyword[];
    return sortedKeywords
      .filter((k) => k.title.toLowerCase().includes(q) || k.definition?.toLowerCase().includes(q))
      .slice(0, 30);
  }, [searchQuery, sortedKeywords]);

  const selectedChildren = React.useMemo(
    () => (selectedKeyword ? childrenByParent.get(selectedKeyword.id) ?? [] : []),
    [selectedKeyword, childrenByParent]
  );

  const overlayOpen = Boolean(isNewKeyword || (selectedKeyword && selectedChildren.length === 0));

  const handleQuickAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await handleUploadFiles(Array.from(files));
  };

  const handleSendUploadNote = async () => {
    if (!selectedKeyword || !uploadNote.trim()) return;
    const safeTitle = selectedKeyword.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'keyword';
    const file = new File([uploadNote.trim()], `${safeTitle}-note-${Date.now()}.txt`, { type: 'text/plain' });
    await handleUploadFiles([file]);
    setUploadNote('');
  };

  useEffect(() => {
    if (!(selectedKeyword || isNewKeyword)) return;
    workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedKeyword?.id, isNewKeyword, viewMode]);

  return (
    <div className="text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Keyword Map</h1>
            <p className="text-sm text-slate-500 mt-1">
              Your company ontology — concepts, definitions, and evidence.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-100/80 px-3 py-1.5 rounded-full border border-slate-200/50">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {keywords.length} keywords indexed
            </div>
            <ImportExportMenu onImported={fetchKeywords} />
          </div>
        </div>
        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-2 rounded-2xl shadow-sm border border-slate-200/60">
          <div className="relative w-full sm:max-w-md group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keywords, definitions..."
              className="w-full pl-10 pr-4 py-3 text-sm bg-transparent border-none focus:ring-0 text-slate-900 placeholder-slate-400 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto px-2 sm:px-0 pb-2 sm:pb-0">
            <button
              onClick={() => setShowMissingOnly((v) => !v)}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                showMissingOnly
                  ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Show keywords without a definition"
            >
              <span className={`w-2 h-2 rounded-full ${showMissingOnly ? 'bg-amber-500' : 'bg-red-400'}`} />
              Missing definitions
            </button>
            <div className="h-8 w-px bg-slate-200 hidden sm:block mx-2"></div>
            <button
              onClick={() => handleAddChild(null)}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 hover:shadow-md hover:shadow-slate-900/10 active:scale-[0.98] transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              New Root
            </button>
            {selectedKeyword && (
              <button
                onClick={() => handleAddChild(selectedKeyword.id)}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all duration-200"
              >
                <Plus className="w-4 h-4" />
                Add Branch
              </button>
            )}
          </div>
        </div>

        {showMissingOnly ? (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-sm font-semibold text-slate-700">Keywords without a definition</h2>
              <span className="text-xs text-slate-500">
                {sortedKeywords.filter((k) => !k.definition?.trim()).length} found
              </span>
            </div>
            {sortedKeywords.filter((k) => !k.definition?.trim()).length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 border-dashed">
                <p className="text-slate-500 font-medium">Every keyword has a definition. 🎉</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sortedKeywords
                  .filter((k) => !k.definition?.trim())
                  .map((kw) => (
                    <button
                      key={kw.id}
                      onClick={() => router.push(`/keywords/${kw.id}`)}
                      className="group text-left p-5 rounded-2xl bg-white border border-amber-200 hover:border-amber-400 hover:shadow-lg transition-all duration-300"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${completenessDot(kw.completeness_score)}`} />
                        <span className="font-semibold text-slate-900 group-hover:text-amber-700 transition-colors">
                          {kw.title}
                        </span>
                      </div>
                      <div className="text-xs text-amber-600 font-medium mt-2">Add a definition →</div>
                    </button>
                  ))}
              </div>
            )}
          </section>
        ) : searchQuery.trim() ? (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                Search Results
              </h2>
              <span className="text-xs text-slate-500">{searchResults.length} found</span>
            </div>
            {searchResults.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 border-dashed">
                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Search className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-500 font-medium">No keywords found matching "{searchQuery}"</p>
                <p className="text-sm text-slate-400 mt-1">Try adjusting your search terms</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {searchResults.map((kw) => (
                  <button
                    key={kw.id}
                    onClick={() => {
                      handleSelectKeyword(kw);
                      setSearchQuery('');
                    }}
                    className="group text-left p-5 rounded-2xl bg-white border border-slate-200 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-300 flex flex-col h-full"
                  >
                    <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">{kw.title}</div>
                    <div className="text-sm text-slate-500 mt-2 line-clamp-2 flex-grow">{kw.definition || 'No definition provided.'}</div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-400 font-medium">
                      <span className="flex items-center gap-1"><Link2 className="w-3 h-3" /> {kw.relations?.length || 0}</span>
                      <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" /> {kw.assets?.length || 0}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="relative">
            <div className="flex items-center gap-2 mb-4 px-1 text-sm text-slate-500 font-medium">
              <FolderTree className="w-4 h-4 text-slate-400" />
              <span>Ontology Explorer</span>
            </div>
            
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 bg-white rounded-3xl border border-slate-200 border-dashed">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm text-slate-500 font-medium animate-pulse">Loading knowledge graph...</p>
              </div>
            ) : (
              <div className="relative bg-slate-50/50 rounded-3xl p-2 border border-slate-200/60">
                <div className="overflow-x-auto pb-4 pt-2 px-2 snap-x snap-mandatory hide-scrollbar">
                  <div className="flex gap-4 min-w-max items-start">
                    {flowColumns.map((col, idx) => (
                      <div 
                        key={`${col.title}-${idx}`} 
                        className="w-80 shrink-0 snap-start flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-300"
                        style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                      >
                        <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{col.title}</span>
                          <span className="text-xs font-medium text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">{col.items.length}</span>
                        </div>
                        <div className="p-2 space-y-1 max-h-[450px] overflow-y-auto custom-scrollbar">
                          {col.items.map((kw) => {
                            const active = col.activeId === kw.id;
                            const isSelected = selectedKeyword?.id === kw.id;
                            return (
                              <button
                                key={kw.id}
                                onClick={() => handleSelectKeyword(kw)}
                                className={`w-full text-left rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 group flex items-center justify-between ${
                                  active || isSelected
                                    ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200/50'
                                    : 'bg-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                                } ${kw.status === 'archived' ? 'opacity-50' : ''}`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${completenessDot(kw.completeness_score)}`}
                                    title={`Completeness: ${kw.completeness_score ?? 0}%`}
                                  />
                                  <span className="truncate pr-1">{kw.title}</span>
                                  {kw.status === 'draft' && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold uppercase shrink-0">
                                      draft
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-1 shrink-0">
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(`/keywords/${kw.id}`);
                                    }}
                                    className="p-1 rounded-md text-slate-300 opacity-0 group-hover:opacity-100 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                    title="Open full page"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </span>
                                  {(active || isSelected) && <ChevronRight className="w-4 h-4 text-blue-500" />}
                                </span>
                              </button>
                            );
                          })}
                          {col.items.length === 0 && (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center">
                              <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center mb-2">
                                <Database className="w-4 h-4 text-slate-300" />
                              </div>
                              <p className="text-xs text-slate-400 font-medium">Empty branch</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Fade edges for scroll indication */}
                <div className="absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-slate-50/50 to-transparent pointer-events-none rounded-r-3xl"></div>
              </div>
            )}
          </section>
        )}

        {!selectedKeyword && !isNewKeyword ? (
          <div
            ref={workspaceRef}
            className="mt-8 bg-white rounded-3xl p-8 md:p-16 border border-slate-200 shadow-sm text-center max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-500"
          >
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-blue-50 text-blue-500 mb-6 shadow-inner">
              <Database className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">
              Build Your Knowledge Graph
            </h3>
            <p className="text-slate-500 text-lg mb-8 max-w-lg mx-auto leading-relaxed">
              Select a node from the explorer above to view its details, or create a new root concept to expand your ontology.
            </p>
            <button
              onClick={() => handleAddChild(null)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/20 active:scale-95 transition-all duration-200"
            >
              <Plus className="w-5 h-5" />
              Create Root Concept
            </button>
          </div>
        ) : null}

        {selectedKeyword && !isNewKeyword && selectedChildren.length > 0 && !overlayOpen && (
          <section className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-slate-400" />
                  Sub-concepts of "{selectedKeyword.title}"
                </h3>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedChildren.map((child) => (
                <button
                  key={child.id}
                  onClick={() => handleSelectKeyword(child)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-blue-300 hover:text-blue-600 hover:shadow-sm text-sm font-medium text-slate-700 transition-all duration-200"
                >
                  {child.title}
                  <ChevronRight className="w-3 h-3 opacity-50" />
                </button>
              ))}
            </div>
          </section>
        )}

        {overlayOpen && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={handleCloseDetail} />
            <div className="absolute left-1/2 top-1/2 w-[min(1100px,92vw)] h-[min(85vh,850px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shadow-sm">
                    {isNewKeyword ? <Plus className="w-5 h-5" /> : <Database className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 tracking-tight">
                      {isNewKeyword ? 'Create New Concept' : selectedKeyword?.title || 'Concept Details'}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">Manage properties, files, and relationships</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {selectedKeyword && !isNewKeyword && (
                    <button
                      onClick={() => router.push(`/keywords/${selectedKeyword.id}`)}
                      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 hover:border-blue-300 transition-colors font-medium"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span className="hidden sm:inline">Full page</span>
                    </button>
                  )}
                  {selectedKeyword && !isNewKeyword && (
                    <button
                      onClick={() => handleDeleteKeyword(selectedKeyword.id)}
                      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-colors font-medium"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  )}
                  <div className="w-px h-6 bg-slate-200 mx-1"></div>
                  <button 
                    onClick={handleCloseDetail} 
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-3 border-b border-slate-100 bg-white shrink-0">
                <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                  {[
                    { id: 'edit', label: 'Properties', icon: Edit3 },
                    { id: 'upload', label: 'Files & Media', icon: FileUp },
                    { id: 'relations', label: 'Relationships', icon: Link2 },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setViewMode(tab.id as ViewMode)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                        viewMode === tab.id
                          ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div ref={workspaceRef} className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/30">
                {viewMode === 'edit' ? (
                  <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
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
                  <div className="max-w-4xl mx-auto space-y-6">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sticky top-0 z-10">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={uploadNote}
                            onChange={(e) => setUploadNote(e.target.value)}
                            placeholder="Type a note to attach..."
                            className="w-full pl-4 pr-12 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all"
                          />
                          <button
                            onClick={handleSendUploadNote}
                            disabled={!uploadNote.trim()}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
                          >
                            <SendHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => quickImageInputRef.current?.click()}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
                          >
                            <ImagePlus className="w-4 h-4 text-blue-500" /> 
                            <span className="hidden sm:inline">Photo</span>
                          </button>
                          <button
                            onClick={() => quickFileInputRef.current?.click()}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
                          >
                            <Paperclip className="w-4 h-4 text-indigo-500" /> 
                            <span className="hidden sm:inline">File</span>
                          </button>
                          <div className="flex-none">
                            <VoiceInput
                              targetField="example"
                              onTranscript={(text) => setUploadNote((prev) => (prev ? `${prev} ${text}` : text))}
                            />
                          </div>
                        </div>
                      </div>
                      <input
                        ref={quickImageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => handleQuickAttach(e.target.files)}
                      />
                      <input
                        ref={quickFileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleQuickAttach(e.target.files)}
                      />
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                      <FileUpload
                        keywordId={selectedKeyword.id}
                        existingAssets={assets}
                        onUpload={handleUploadFiles}
                        onRemove={handleRemoveAsset}
                        onViewAsset={(asset) => openAsset(asset)}
                      />
                    </div>
                  </div>
                ) : viewMode === 'relations' && selectedKeyword ? (
                  <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <RelationEditor
                      keyword={selectedKeyword}
                      allKeywords={keywords}
                      relations={relations}
                      onAddRelation={handleAddRelation}
                      onRemoveRelation={handleRemoveRelation}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Floating AI Button & Panel */}
        <div className="fixed right-6 bottom-6 z-[60] flex flex-col items-end gap-4">
          {aiOpen && (
            <div className="w-[min(450px,90vw)] h-[min(70vh,650px)] rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-8 duration-300 origin-bottom-right">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-sm">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Ontology AI</h3>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {chatScopeKeywordIds.length > 0 ? `${chatScopeKeywordIds.length} concepts in context` : 'Global context'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAiOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden bg-slate-50/30">
                <AIAssistant
                  keywords={keywords}
                  selectedKeywordIds={chatScopeKeywordIds}
                  onSelectedKeywordIdsChange={setChatScopeKeywordIds}
                  onSelectKeyword={handleSelectKeywordById}
                  onKeywordsCreated={fetchKeywords}
                />
              </div>
            </div>
          )}

          <button
            onClick={() => setAiOpen((prev) => !prev)}
            className={`group relative flex items-center justify-center w-14 h-14 rounded-2xl shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 ${
              aiOpen 
                ? 'bg-slate-800 text-white shadow-slate-800/20' 
                : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-indigo-500/30'
            }`}
            aria-label="Toggle AI assistant"
          >
            {aiOpen ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
            {!aiOpen && (
              <span className="absolute -top-2 -right-2 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-purple-500 border-2 border-white"></span>
              </span>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
