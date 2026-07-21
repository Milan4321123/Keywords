'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  ArrowLeft,
  Camera,
  Paperclip,
  StickyNote,
  Loader2,
  Check,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  X,
  ChevronRight,
  Home,
  FolderOpen,
  ClipboardList,
} from 'lucide-react';
import { Keyword, Asset } from '@/types';
import { CaptureFormDef } from '@/lib/capture-types';
import VoiceInput from '@/components/VoiceInput';
import CaptureForm from '@/components/CaptureForm';
import { openAsset } from '@/lib/asset-view';

// Soft tile colors cycled by index so the grid looks lively
const TILE_TONES = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-blue-600',
];

function assetIcon(type: string) {
  if (type === 'image') return <ImageIcon className="w-4 h-4 text-emerald-500" />;
  if (type === 'video') return <Film className="w-4 h-4 text-rose-500" />;
  if (type === 'audio') return <Music className="w-4 h-4 text-violet-500" />;
  return <FileText className="w-4 h-4 text-slate-400" />;
}

export default function WorkPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Keyword | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [captureForms, setCaptureForms] = useState<CaptureFormDef[]>([]);
  // Hierarchical drill-down: which branch of the keyword tree is open
  const [parentId, setParentId] = useState<string | null>(null);

  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/keywords')
      .then((r) => r.json())
      .then(({ data }) => setKeywords((data ?? []).filter((k: Keyword) => k.status !== 'archived')))
      .finally(() => setLoading(false));
  }, []);

  const loadAssets = async (keywordId: string) => {
    setAssetsLoading(true);
    try {
      const response = await fetch(`/api/assets/upload?keyword_id=${keywordId}`);
      const { data } = await response.json();
      setAssets(data ?? []);
    } finally {
      setAssetsLoading(false);
    }
  };

  const openKeyword = (keyword: Keyword) => {
    setSelected(keyword);
    setNote('');
    setAssets([]);
    setCaptureForms([]);
    loadAssets(keyword.id);
    // Structured entry forms derived from datasets linked to this keyword
    fetch(`/api/capture?keyword_id=${keyword.id}`)
      .then((r) => r.json())
      .then(({ data }) => setCaptureForms(data?.forms ?? []))
      .catch(() => setCaptureForms([]));
  };

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const uploadFiles = async (files: FileList | File[], label: string) => {
    if (!selected) return;
    setUploading(label);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('keyword_id', selected.id);
        const response = await fetch('/api/assets/upload', { method: 'POST', body: formData });
        const { data } = await response.json();
        if (data) setAssets((prev) => [data, ...prev]);
      }
      flashSaved();
    } finally {
      setUploading(null);
    }
  };

  const sendNote = async () => {
    if (!selected || !note.trim()) return;
    const safe = selected.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'note';
    const file = new File([note.trim()], `${safe}-notiz-${Date.now()}.txt`, { type: 'text/plain' });
    await uploadFiles([file], 'note');
    setNote('');
  };

  const byId = useMemo(() => new Map(keywords.map((k) => [k.id, k] as const)), [keywords]);

  const childCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of keywords) {
      if (k.parent_id) counts.set(k.parent_id, (counts.get(k.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [keywords]);

  // Searching shows a flat result list; otherwise only the current tree level
  const searching = search.trim().length > 0;
  const filtered = useMemo(() => {
    const list = [...keywords].sort((a, b) => a.title.localeCompare(b.title));
    if (searching) {
      const q = search.trim().toLowerCase();
      return list.filter(
        (k) => k.title.toLowerCase().includes(q) || k.definition?.toLowerCase().includes(q)
      );
    }
    return list.filter((k) => (k.parent_id ?? null) === parentId);
  }, [keywords, search, searching, parentId]);

  // Breadcrumb from root to the currently open branch
  const breadcrumb = useMemo(() => {
    const path: Keyword[] = [];
    let cursor = parentId ? byId.get(parentId) : undefined;
    let guard = 0;
    while (cursor && guard < 20) {
      path.unshift(cursor);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      guard++;
    }
    return path;
  }, [parentId, byId]);

  const currentParent = parentId ? byId.get(parentId) ?? null : null;

  const tapTile = (keyword: Keyword) => {
    if (!searching && (childCount.get(keyword.id) ?? 0) > 0) {
      setParentId(keyword.id);
    } else {
      openKeyword(keyword);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  // ---------- Upload panel for one keyword ----------
  if (selected) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium mb-5"
        >
          <ArrowLeft className="w-5 h-5" /> Zurück · Back
        </button>

        <div className="bg-white rounded-3xl border border-slate-200 p-6 mb-5">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{selected.title}</h1>
          {selected.definition ? (
            <p className="text-slate-600 mt-2 leading-relaxed">{selected.definition}</p>
          ) : (
            <p className="text-slate-400 italic mt-2">Noch keine Beschreibung.</p>
          )}
          {selected.examples && selected.examples.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {selected.examples.slice(0, 6).map((ex, i) => (
                <span key={i} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium">
                  {ex}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Structured data entry (Kasse amounts, temperatures, waste …) */}
        {captureForms.map((form) => (
          <CaptureForm
            key={form.dataset_table_id}
            form={form}
            keywordId={selected.id}
            onSaved={() => {
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 1800);
              // refresh "Meine Einträge"
              fetch(`/api/capture?keyword_id=${selected.id}`)
                .then((r) => r.json())
                .then(({ data }) => setCaptureForms(data?.forms ?? []))
                .catch(() => {});
            }}
          />
        ))}

        {/* Big touch actions */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => photoRef.current?.click()}
            disabled={!!uploading}
            className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl bg-white border-2 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 active:scale-95 transition-all disabled:opacity-50"
          >
            {uploading === 'photo' ? (
              <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
            ) : (
              <Camera className="w-7 h-7 text-emerald-500" />
            )}
            <span className="text-sm font-semibold text-slate-700">Foto · Photo</span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!uploading}
            className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl bg-white border-2 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 active:scale-95 transition-all disabled:opacity-50"
          >
            {uploading === 'file' ? (
              <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
            ) : (
              <Paperclip className="w-7 h-7 text-blue-500" />
            )}
            <span className="text-sm font-semibold text-slate-700">Datei / Video</span>
          </button>
        </div>

        {/* Note with voice */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-amber-500" /> Notiz · Note
            </span>
            <VoiceInput
              targetField="example"
              onTranscript={(t) => setNote((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Schreiben oder sprechen… · Type or speak…"
            className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all resize-none"
          />
          <button
            onClick={sendNote}
            disabled={!note.trim() || uploading === 'note'}
            className="mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 active:scale-95 transition-all"
          >
            {uploading === 'note' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Notiz speichern · Save note
          </button>
        </div>

        {savedFlash && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-full bg-emerald-600 text-white text-sm font-semibold shadow-lg animate-in fade-in slide-in-from-bottom-4">
            <Check className="w-4 h-4" /> Gespeichert · Saved
          </div>
        )}

        {/* Existing uploads */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">
            Hochgeladen · Uploaded {assets.length > 0 && `(${assets.length})`}
          </div>
          {assetsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            </div>
          ) : assets.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Noch nichts hochgeladen.</p>
          ) : (
            <div className="space-y-1.5">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => openAsset(asset)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left transition-colors"
                >
                  {assetIcon(asset.file_type)}
                  <span className="flex-1 text-sm text-slate-700 truncate">{asset.file_name}</span>
                  {asset.processing_status === 'processing' && (
                    <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files, 'photo').then(() => (e.target.value = ''))}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files, 'file').then(() => (e.target.value = ''))}
        />
      </div>
    );
  }

  // ---------- Keyword tile grid ----------
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Arbeitsansicht · Work</h1>
        <p className="text-sm text-slate-500 mt-1">
          Tippe einen Begriff an und lade Foto, Datei oder Notiz hoch. · Tap a topic to upload.
        </p>
      </div>

      <div className="relative mb-6">
        <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen · Search…"
          className="w-full pl-12 pr-10 py-3.5 rounded-2xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Breadcrumb: tap through the hierarchy instead of scrolling everything */}
      {!searching && (parentId || breadcrumb.length > 0) && (
        <div className="flex items-center gap-1 flex-wrap mb-4 bg-white rounded-2xl border border-slate-200 px-3 py-2.5">
          <button
            onClick={() => setParentId(null)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <Home className="w-4 h-4" /> Start
          </button>
          {breadcrumb.map((crumb) => (
            <React.Fragment key={crumb.id}>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              <button
                onClick={() => setParentId(crumb.id)}
                className={`px-2.5 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                  crumb.id === parentId ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {crumb.title}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* The open branch itself: enter data / upload directly for it */}
      {!searching && currentParent && (
        <button
          onClick={() => openKeyword(currentParent)}
          className="w-full flex items-center gap-3 bg-white rounded-2xl border-2 border-blue-200 hover:border-blue-400 px-4 py-3.5 mb-4 text-left active:scale-[0.99] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">
              Hier eintragen · Enter data for “{currentParent.title}”
            </div>
            <div className="text-xs text-slate-500">Foto, Datei, Notiz oder Formular direkt für diesen Begriff</div>
          </div>
          <ChevronRight className="w-5 h-5 text-blue-400 ml-auto shrink-0" />
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 border-dashed p-12 text-center">
          <p className="text-slate-500 font-medium">
            {search ? 'Nichts gefunden · Nothing found' : 'Keine Unterbegriffe · No sub-topics here'}
          </p>
          {!searching && parentId && (
            <button
              onClick={() => setParentId(breadcrumb.at(-2)?.id ?? null)}
              className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              ← Zurück · Back
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filtered.map((keyword, i) => {
            const children = childCount.get(keyword.id) ?? 0;
            const isBranch = !searching && children > 0;
            return (
              <button
                key={keyword.id}
                onClick={() => tapTile(keyword)}
                className="group relative aspect-square rounded-3xl overflow-hidden text-left active:scale-95 transition-transform shadow-sm hover:shadow-lg"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${TILE_TONES[i % TILE_TONES.length]} opacity-90 group-hover:opacity-100 transition-opacity`} />
                <div className="relative h-full flex flex-col justify-between p-4">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-2xl bg-white/25 backdrop-blur flex items-center justify-center text-white font-bold text-lg">
                      {isBranch ? <FolderOpen className="w-5 h-5" /> : keyword.title[0]?.toUpperCase()}
                    </div>
                    {isBranch && (
                      <span className="px-2 py-0.5 rounded-full bg-white/25 backdrop-blur text-white text-[11px] font-bold">
                        {children} ▸
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="text-white font-bold text-base leading-tight line-clamp-2">
                      {keyword.title}
                    </div>
                    {isBranch ? (
                      <div className="text-white/70 text-xs mt-1">
                        Antippen zum Öffnen · Tap to open
                      </div>
                    ) : keyword.definition ? (
                      <div className="text-white/70 text-xs mt-1 line-clamp-2">{keyword.definition}</div>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
