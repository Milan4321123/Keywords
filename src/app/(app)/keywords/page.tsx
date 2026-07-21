'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Loader2,
  Pencil,
  Paperclip,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Keyword } from '@/types';
import { CaptureFormDef } from '@/lib/capture-types';
import KeywordDetail from '@/components/KeywordDetail';
import AIAssistant from '@/components/AIAssistant';
import ImportExportMenu from '@/components/ImportExportMenu';
import CaptureForm from '@/components/CaptureForm';

function completenessDot(score: number | undefined): string {
  const s = score ?? 0;
  if (s >= 70) return 'bg-emerald-500';
  if (s >= 40) return 'bg-amber-400';
  return 'bg-slate-300';
}

export default function KeywordsPage() {
  const router = useRouter();

  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Drill-down navigation: which keyword we are "inside" (null = top level)
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');

  const [searchQuery, setSearchQuery] = useState('');

  // Quick add (inline, Reminders-style)
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const quickAddRef = useRef<HTMLInputElement | null>(null);

  // Edit sheet
  const [editing, setEditing] = useState<Keyword | null>(null);

  // Lightweight toast for errors
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  // Chat scoping: which keywords the AI should focus on (follows navigation).
  const [chatScopeIds, setChatScopeIds] = useState<string[]>([]);

  // Structured entry forms for the keyword we are inside (Eingabe im Drill-down)
  const [captureForms, setCaptureForms] = useState<CaptureFormDef[]>([]);
  useEffect(() => {
    if (!currentId) {
      setCaptureForms([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/capture?keyword_id=${currentId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (!cancelled) setCaptureForms(data?.forms ?? []);
      })
      .catch(() => {
        if (!cancelled) setCaptureForms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const refreshCaptureForms = useCallback(() => {
    if (!currentId) return;
    fetch(`/api/capture?keyword_id=${currentId}`)
      .then((r) => r.json())
      .then(({ data }) => setCaptureForms(data?.forms ?? []))
      .catch(() => {});
  }, [currentId]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchKeywords = useCallback(async () => {
    try {
      const response = await fetch('/api/keywords');
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setKeywords(data || []);
    } catch (error) {
      console.error('Failed to fetch keywords:', error);
      showToast('Begriffe konnten nicht geladen werden · Could not load keywords');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  // Lock body scroll while the edit sheet is open
  useEffect(() => {
    document.body.style.overflow = editing ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const byId = useMemo(() => new Map(keywords.map((k) => [k.id, k] as const)), [keywords]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Keyword[]>();
    const sorted = [...keywords].sort(
      (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)
    );
    for (const keyword of sorted) {
      const key = keyword.parent_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(keyword);
      map.set(key, arr);
    }
    return map;
  }, [keywords]);

  const current = currentId ? byId.get(currentId) ?? null : null;
  const list = childrenByParent.get(current?.id ?? null) ?? [];

  // Chain from root down to the current keyword (for AI context + search subtitles)
  const pathOf = useCallback(
    (id: string): Keyword[] => {
      const path: Keyword[] = [];
      let cursor = byId.get(id);
      let guard = 0;
      while (cursor && guard < 100) {
        path.unshift(cursor);
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
        guard += 1;
      }
      return path;
    },
    [byId]
  );

  const currentPath = useMemo(() => (currentId ? pathOf(currentId) : []), [currentId, pathOf]);

  useEffect(() => {
    setChatScopeIds(currentPath.map((k) => k.id));
  }, [currentPath]);

  const openKeyword = useCallback((keyword: Keyword) => {
    setDirection('fwd');
    setCurrentId(keyword.id);
    setSearchQuery('');
  }, []);

  const goBack = useCallback(() => {
    setDirection('back');
    setCurrentId(current?.parent_id ?? null);
  }, [current?.parent_id]);

  const handleQuickAdd = async () => {
    const title = draft.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const response = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, parent_id: current?.id ?? null }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setKeywords((prev) => [...prev, data]);
      setDraft('');
    } catch (error) {
      console.error('Failed to create keyword:', error);
      showToast('Konnte nicht erstellt werden · Could not create');
    } finally {
      setCreating(false);
      quickAddRef.current?.focus();
    }
  };

  const handleSaveKeyword = async (keywordData: Partial<Keyword>) => {
    if (!editing) return;
    try {
      const response = await fetch(`/api/keywords/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keywordData),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setKeywords((prev) => prev.map((k) => (k.id === data.id ? { ...k, ...data } : k)));
      setEditing(null);
    } catch (error) {
      console.error('Failed to save keyword:', error);
      showToast('Speichern fehlgeschlagen · Could not save');
    }
  };

  const handleDeleteKeyword = async (id: string) => {
    if (!confirm('Diesen Begriff wirklich löschen? · Delete this keyword?')) return;
    try {
      const response = await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
      const { error } = await response.json();
      if (error) throw new Error(error);
      const deleted = byId.get(id);
      setKeywords((prev) => prev.filter((k) => k.id !== id));
      setEditing(null);
      if (currentId === id) {
        setDirection('back');
        setCurrentId(deleted?.parent_id ?? null);
      }
    } catch (error) {
      console.error('Failed to delete keyword:', error);
      showToast('Löschen fehlgeschlagen · Could not delete');
    }
  };

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as Keyword[];
    return keywords
      .filter(
        (k) =>
          k.title.toLowerCase().includes(q) ||
          k.definition?.toLowerCase().includes(q) ||
          k.synonyms?.some((s) => s.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [searchQuery, keywords]);

  const searching = searchQuery.trim().length > 0;
  const parentTitle = current?.parent_id
    ? byId.get(current.parent_id)?.title ?? 'Zurück'
    : 'Begriffe';

  /** One list row — big tap target, title + optional definition snippet, child count, chevron. */
  const renderRow = (kw: Keyword, subtitle?: string) => {
    const childCount = childrenByParent.get(kw.id)?.length ?? 0;
    return (
      <button
        key={kw.id}
        onClick={() => openKeyword(kw)}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-100 hover:bg-slate-50 ${
          kw.status === 'archived' ? 'opacity-50' : ''
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${completenessDot(kw.completeness_score)}`}
          aria-hidden
        />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-medium text-slate-900 truncate">{kw.title}</span>
          {(subtitle ?? kw.definition) && (
            <span className="block text-[13px] text-slate-400 truncate mt-0.5">
              {subtitle ?? kw.definition}
            </span>
          )}
        </span>
        {childCount > 0 && (
          <span className="text-[13px] text-slate-400 tabular-nums shrink-0">{childCount}</span>
        )}
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </button>
    );
  };

  return (
    <div className="text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-32">
        {/* Header */}
        <header className="mb-5">
          {current ? (
            <button
              onClick={goBack}
              className="flex items-center gap-0.5 -ml-2 mb-1 px-1 py-1 text-[15px] font-medium text-blue-600 rounded-lg active:opacity-50 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5" />
              {parentTitle}
            </button>
          ) : null}
          <div className="flex items-end justify-between gap-3">
            <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-tight">
              {current ? current.title : 'Begriffe'}
            </h1>
            {!current && <ImportExportMenu onImported={fetchKeywords} />}
          </div>
          {!current && (
            <p className="text-[15px] text-slate-500 mt-1">
              Das gemeinsame Wörterbuch eurer Firma · Your company&apos;s shared dictionary
            </p>
          )}
        </header>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Suchen · Search"
            className="w-full pl-10 pr-10 py-2.5 text-[15px] rounded-xl bg-slate-200/60 border-none placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 rounded-full"
              aria-label="Suche löschen"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mb-3" />
            <p className="text-sm">Wird geladen…</p>
          </div>
        ) : searching ? (
          /* ——— Search results ——— */
          <section className="anim-fade-up">
            {searchResults.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-[15px] font-medium text-slate-500">
                  Nichts gefunden für „{searchQuery}“
                </p>
                <p className="text-[13px] text-slate-400 mt-1">No results · Try another word</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden">
                {searchResults.map((kw) => {
                  const crumbs = pathOf(kw.id)
                    .slice(0, -1)
                    .map((p) => p.title)
                    .join(' › ');
                  return renderRow(kw, crumbs || kw.definition || undefined);
                })}
              </div>
            )}
          </section>
        ) : (
          /* ——— Drill-down list ——— */
          <section key={current?.id ?? 'root'} className={direction === 'fwd' ? 'anim-page-fwd' : 'anim-page-back'}>
            {/* Current keyword: definition + details, one grouped card */}
            {current && (
              <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden mb-6">
                <button
                  onClick={() => setEditing(current)}
                  className="w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-100 hover:bg-slate-50"
                >
                  <span className="flex-1 min-w-0">
                    {current.definition ? (
                      <span className="block text-[15px] text-slate-700 leading-relaxed">
                        {current.definition}
                      </span>
                    ) : (
                      <span className="block text-[15px] text-blue-600 font-medium">
                        Definition hinzufügen · Add definition
                      </span>
                    )}
                  </span>
                  <Pencil className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                </button>
                <button
                  onClick={() => router.push(`/keywords/${current.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-100 hover:bg-slate-50"
                >
                  <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="flex-1 text-[15px] text-slate-700">
                    Dateien & Details
                    <span className="text-slate-400 ml-1.5 text-[13px]">Files &amp; details</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              </div>
            )}

            {/* Eingabe: structured entry directly at this branch */}
            {current &&
              captureForms.map((form) => (
                <CaptureForm
                  key={form.dataset_table_id}
                  form={form}
                  keywordId={current.id}
                  onSaved={refreshCaptureForms}
                />
              ))}

            {/* Section label */}
            <p className="px-4 mb-2 text-[12px] font-semibold text-slate-400 uppercase tracking-wide">
              {current ? 'Unterbegriffe · Sub-topics' : 'Alle Begriffe · All keywords'}
            </p>

            {/* Children + quick add, one grouped card */}
            <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden">
              {list.map((kw) => renderRow(kw))}

              {list.length === 0 && !current && (
                <div className="px-4 py-14 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-50 text-blue-500 mb-3">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <p className="text-[15px] font-medium text-slate-700">Noch keine Begriffe</p>
                  <p className="text-[13px] text-slate-400 mt-1">
                    Tippe unten einen Namen ein und drücke Enter.
                    <br />
                    Type a name below and press Enter.
                  </p>
                </div>
              )}

              {/* Quick add — always there, creates on Enter */}
              <div className="flex items-center gap-3 px-4 py-3">
                {creating ? (
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
                ) : (
                  <Plus className="w-5 h-5 text-blue-600 shrink-0" />
                )}
                <input
                  ref={quickAddRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleQuickAdd();
                    }
                  }}
                  placeholder={current ? 'Neuer Unterbegriff… · New sub-topic' : 'Neuer Begriff… · New keyword'}
                  className="flex-1 min-w-0 text-[15px] bg-transparent border-none outline-none focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
                />
                {draft.trim() && (
                  <button
                    onClick={handleQuickAdd}
                    disabled={creating}
                    className="text-[15px] font-semibold text-blue-600 active:opacity-50 disabled:opacity-40 shrink-0"
                  >
                    Hinzufügen
                  </button>
                )}
              </div>
            </div>

            {current && list.length === 0 && (
              <p className="px-4 mt-3 text-[13px] text-slate-400">
                Tipp: Enter drücken, um mehrere nacheinander anzulegen. · Press Enter to add several in a row.
              </p>
            )}
          </section>
        )}
      </main>

      {/* Edit sheet */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/30 anim-fade" onClick={() => setEditing(null)} />
          <div className="relative w-full sm:w-[min(680px,92vw)] h-[90dvh] sm:h-[min(85vh,780px)] bg-white rounded-t-[28px] sm:rounded-[28px] shadow-2xl overflow-hidden flex flex-col anim-sheet">
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden>
              <div className="w-10 h-1 rounded-full bg-slate-200" />
            </div>
            <KeywordDetail
              keyword={editing}
              allKeywords={keywords}
              onSave={handleSaveKeyword}
              onDelete={handleDeleteKeyword}
              onClose={() => setEditing(null)}
              isNew={false}
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-full bg-slate-900 text-white text-sm shadow-lg anim-fade-up">
          {toast}
        </div>
      )}

      {/* AI assistant (hidden while the edit sheet is open) */}
      <div className={`fixed right-5 bottom-5 z-40 flex flex-col items-end gap-3 ${editing ? 'hidden' : ''}`}>
        {aiOpen && (
          <div className="w-[min(420px,calc(100vw-2.5rem))] h-[min(65vh,600px)] rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col anim-fade-up">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Assistent</h3>
              </div>
              <button
                onClick={() => setAiOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Assistent schließen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AIAssistant
                keywords={keywords}
                selectedKeywordIds={chatScopeIds}
                onSelectedKeywordIdsChange={setChatScopeIds}
                onSelectKeyword={(id) => {
                  const found = byId.get(id);
                  if (found) openKeyword(found);
                }}
                onKeywordsCreated={fetchKeywords}
              />
            </div>
          </div>
        )}
        <button
          onClick={() => setAiOpen((prev) => !prev)}
          className={`flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-all duration-200 active:scale-95 ${
            aiOpen ? 'bg-slate-800 text-white' : 'bg-blue-600 text-white shadow-blue-600/30'
          }`}
          aria-label="KI-Assistent öffnen/schließen"
        >
          {aiOpen ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
