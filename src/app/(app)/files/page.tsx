'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FolderOpen,
  Search,
  X,
  Loader2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Table2,
  File as FileIcon,
  Trash2,
  ExternalLink,
  User,
  Calendar,
  FolderTree,
  HardDrive,
} from 'lucide-react';
import { Keyword } from '@/types';

interface LibraryAsset {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string | null;
  file_size: number | null;
  description: string | null;
  processing_status: string | null;
  created_at: string;
  created_by: string | null;
  language: string | null;
  uploader: string | null;
  keywords: Array<{ id: string; title: string }>;
}

const TYPE_CHIPS: Array<{ id: string; label: string }> = [
  { id: '', label: 'Alle · All' },
  { id: 'image', label: 'Bilder · Photos' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'pdf', label: 'PDF' },
  { id: 'excel', label: 'Tabellen · Sheets' },
  { id: 'text', label: 'Notizen · Notes' },
];

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
  word: FileText,
  excel: Table2,
  text: FileText,
  other: FileIcon,
};

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lazily fetches a signed URL once and renders the image thumbnail. */
function AssetThumb({ assetId, alt }: { assetId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assets/${assetId}/url`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (!cancelled && data?.url) setUrl(data.url);
        else if (!cancelled) setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100">
        <ImageIcon className="w-8 h-8 text-slate-300" />
      </div>
    );
  }
  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100">
        <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="w-full h-full object-cover" onError={() => setFailed(true)} />;
}

/** Media preview inside the detail modal. */
function AssetPreview({ asset }: { asset: LibraryAsset }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assets/${asset.id}/url`)
      .then((r) => r.json())
      .then(({ data }) => !cancelled && setUrl(data?.url ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  if (!url) {
    return (
      <div className="h-48 flex items-center justify-center bg-slate-100 rounded-xl">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }
  if (asset.file_type === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={asset.file_name} className="w-full max-h-[420px] object-contain rounded-xl bg-slate-900/5" />;
  }
  if (asset.file_type === 'video') {
    return <video src={url} controls className="w-full max-h-[420px] rounded-xl bg-black" />;
  }
  if (asset.file_type === 'audio') {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <div className="p-6 bg-slate-50 rounded-xl text-center">
      <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
      >
        <ExternalLink className="w-4 h-4" /> Datei öffnen · Open file
      </a>
    </div>
  );
}

export default function FilesPage() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [keywordId, setKeywordId] = useState('');
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const LIMIT = 60;

  const buildQuery = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (type) params.set('type', type);
      if (keywordId) params.set('keyword_id', keywordId);
      if (mine) params.set('mine', '1');
      params.set('limit', String(LIMIT));
      params.set('offset', String(offset));
      return params.toString();
    },
    [q, type, keywordId, mine]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/assets?${buildQuery(0)}`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setAssets(data.assets ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err.message || 'Laden fehlgeschlagen · Failed to load');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  useEffect(() => {
    fetch('/api/keywords')
      .then((r) => r.json())
      .then(({ data }) => setKeywords(data ?? []))
      .catch(() => {});
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/assets?${buildQuery(assets.length)}`);
      const { data } = await response.json();
      setAssets((prev) => [...prev, ...(data?.assets ?? [])]);
    } finally {
      setLoadingMore(false);
    }
  };

  const removeAsset = async (asset: LibraryAsset) => {
    if (!confirm(`„${asset.file_name}" löschen? · Delete this file?`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setSelected(null);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err: any) {
      setError(err.message || 'Löschen fehlgeschlagen · Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const sortedKeywords = useMemo(
    () => [...keywords].sort((a, b) => a.title.localeCompare(b.title)),
    [keywords]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <FolderOpen className="w-6 h-6 text-slate-400" />
          Dateien · Files
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Alle hochgeladenen Fotos, Videos, Notizen und Dokumente — durchsuchbar und mit Kontext.
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-3 mb-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Dateiname oder Beschreibung suchen…"
              className="w-full pl-10 pr-9 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 transition-all"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <select
            value={keywordId}
            onChange={(e) => setKeywordId(e.target.value)}
            className="px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white max-w-[220px]"
          >
            <option value="">Alle Begriffe · All keywords</option>
            {sortedKeywords.map((k) => (
              <option key={k.id} value={k.id}>{k.title}</option>
            ))}
          </select>
          <button
            onClick={() => setMine((v) => !v)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shrink-0 ${
              mine
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <User className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Nur meine · Mine
          </button>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {TYPE_CHIPS.map((chip) => (
            <button
              key={chip.id}
              onClick={() => setType(chip.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                type === chip.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-400 self-center">{total} Dateien</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : assets.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 border-dashed p-16 text-center">
          <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Keine Dateien gefunden · No files found</p>
          <p className="text-sm text-slate-400 mt-1">
            Lade Fotos & Dokumente in der Arbeitsansicht oder im Keyword Map hoch.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {assets.map((asset) => {
              const Icon = TYPE_ICONS[asset.file_type] ?? FileIcon;
              return (
                <button
                  key={asset.id}
                  onClick={() => setSelected(asset)}
                  className="group bg-white rounded-2xl border border-slate-200 overflow-hidden text-left hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/5 transition-all"
                >
                  <div className="aspect-[4/3] bg-slate-50 relative overflow-hidden">
                    {asset.file_type === 'image' ? (
                      <AssetThumb assetId={asset.id} alt={asset.file_name} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icon className="w-10 h-10 text-slate-300 group-hover:text-blue-400 transition-colors" />
                      </div>
                    )}
                    {asset.processing_status === 'processing' && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-semibold text-slate-500">
                        wird verarbeitet…
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-medium text-slate-800 truncate" title={asset.file_name}>
                      {asset.file_name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 truncate">
                      {asset.uploader && <span className="truncate">{asset.uploader}</span>}
                      <span className="shrink-0">· {new Date(asset.created_at).toLocaleDateString()}</span>
                    </div>
                    {asset.keywords.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {asset.keywords.slice(0, 2).map((k) => (
                          <span key={k.id} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium truncate max-w-[110px]">
                            {k.title}
                          </span>
                        ))}
                        {asset.keywords.length > 2 && (
                          <span className="text-[10px] text-slate-300">+{asset.keywords.length - 2}</span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {assets.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-5 w-full py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-all"
            >
              {loadingMore ? 'Wird geladen…' : `Mehr laden · Load more (${total - assets.length})`}
            </button>
          )}
        </>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(680px,94vw)] max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-bold text-slate-900 truncate">{selected.file_name}</h2>
                {selected.description && (
                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">{selected.description}</p>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <AssetPreview asset={selected} />

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 text-slate-600">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{selected.uploader ?? 'Unbekannt'}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 text-slate-600">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {new Date(selected.created_at).toLocaleString()}
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 text-slate-600">
                <HardDrive className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {formatSize(selected.file_size)} · {selected.file_type}
                {selected.language && ` · ${selected.language.toUpperCase()}`}
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 text-slate-600 min-w-0">
                <FolderTree className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">
                  {selected.keywords.length > 0
                    ? selected.keywords.map((k) => k.title).join(', ')
                    : 'Kein Begriff verknüpft'}
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => removeAsset(selected)}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Löschen · Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
