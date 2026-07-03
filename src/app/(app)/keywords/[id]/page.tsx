'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  BookOpen,
  ChevronRight,
  Clock,
  FileUp,
  Link2,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Keyword, KeywordRelation, Asset, KeywordVersion } from '@/types';
import { computeCompleteness } from '@/lib/ontology/completeness';
import KeywordDetail from '@/components/KeywordDetail';
import RelationEditor from '@/components/RelationEditor';
import FileUpload from '@/components/FileUpload';
import { openAsset } from '@/lib/asset-view';

type Tab = 'overview' | 'relations' | 'files' | 'history';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
};

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

export default function KeywordDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [keyword, setKeyword] = useState<Keyword | null>(null);
  const [allKeywords, setAllKeywords] = useState<Keyword[]>([]);
  const [relations, setRelations] = useState<KeywordRelation[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [versions, setVersions] = useState<KeywordVersion[]>([]);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadKeyword = useCallback(async () => {
    try {
      const response = await fetch(`/api/keywords/${id}`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setKeyword(data);
      setRelations(data.relations || []);
      setAssets(data.assets || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load keyword');
    }
  }, [id]);

  const loadVersions = useCallback(async () => {
    try {
      const response = await fetch(`/api/keywords/${id}/versions`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setVersions(data ?? []);
      setVersionsLoaded(true);
    } catch {
      setVersionsLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadKeyword(),
      fetch('/api/keywords')
        .then((r) => r.json())
        .then(({ data }) => setAllKeywords(data ?? [])),
    ]).finally(() => setLoading(false));
  }, [loadKeyword]);

  useEffect(() => {
    if (tab === 'history' && !versionsLoaded) loadVersions();
  }, [tab, versionsLoaded, loadVersions]);

  const breadcrumb = useMemo(() => {
    if (!keyword) return [] as Keyword[];
    const byId = new Map(allKeywords.map((k) => [k.id, k] as const));
    const path: Keyword[] = [];
    let cursor = keyword.parent_id ? byId.get(keyword.parent_id) : undefined;
    let guard = 0;
    while (cursor && guard < 20) {
      path.unshift(cursor);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      guard++;
    }
    return path;
  }, [keyword, allKeywords]);

  const children = useMemo(
    () => allKeywords.filter((k) => k.parent_id === keyword?.id),
    [allKeywords, keyword]
  );

  const completeness = useMemo(() => {
    if (!keyword) return { score: 0, missing: [] as string[] };
    return computeCompleteness({
      ...keyword,
      relationCount: relations.length,
      assetCount: assets.length,
    });
  }, [keyword, relations, assets]);

  const handleSave = async (data: Partial<Keyword>) => {
    const response = await fetch(`/api/keywords/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const { error } = await response.json();
    if (error) {
      setError(error);
      return;
    }
    setVersionsLoaded(false);
    await loadKeyword();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this keyword and all its sub-keywords?')) return;
    const response = await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
    const { error } = await response.json();
    if (error) {
      setError(error);
      return;
    }
    router.push('/keywords');
  };

  const handleRestore = async (version: KeywordVersion) => {
    if (!confirm(`Restore version ${version.version_no}? Current state is saved to history first.`)) return;
    const snap = version.snapshot as Record<string, any>;
    await handleSave({
      title: snap.title,
      definition: snap.definition,
      explanation: snap.explanation,
      examples: snap.examples ?? [],
      synonyms: snap.synonyms ?? [],
      rules: snap.rules ?? [],
      labels_json: snap.labels_json ?? {},
      keyword_type: snap.keyword_type,
      status: snap.status,
    });
    setTab('overview');
  };

  const handleUploadFiles = async (files: File[]) => {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('keyword_id', id);
      const response = await fetch('/api/assets/upload', { method: 'POST', body: formData });
      const { data, error } = await response.json();
      if (!error && data) setAssets((prev) => [...prev, data]);
    }
  };

  const handleAddRelation = async (relation: Omit<KeywordRelation, 'id' | 'created_at'>) => {
    const response = await fetch('/api/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(relation),
    });
    const { data, error } = await response.json();
    if (!error && data) setRelations((prev) => [...prev, data]);
  };

  const handleRemoveRelation = async (relationId: string) => {
    const response = await fetch(`/api/relations?id=${relationId}`, { method: 'DELETE' });
    const { error } = await response.json();
    if (!error) setRelations((prev) => prev.filter((r) => r.id !== relationId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (!keyword) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-slate-500">{error || 'Keyword not found.'}</p>
        <Link href="/keywords" className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-700">
          ← Back to Keyword Map
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-slate-500 flex-wrap">
        <Link href="/keywords" className="hover:text-blue-600 font-medium">Keyword Map</Link>
        {breadcrumb.map((ancestor) => (
          <React.Fragment key={ancestor.id}>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <Link href={`/keywords/${ancestor.id}`} className="hover:text-blue-600 font-medium">
              {ancestor.title}
            </Link>
          </React.Fragment>
        ))}
        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        <span className="font-semibold text-slate-800">{keyword.title}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{keyword.title}</h1>
              <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold capitalize">
                {(keyword.keyword_type || 'concept').replace('_', ' ')}
              </span>
              <span className={`px-2.5 py-1 rounded-lg border text-xs font-semibold capitalize ${STATUS_STYLES[keyword.status || 'active']}`}>
                {keyword.status || 'active'}
              </span>
            </div>
            {keyword.definition && (
              <p className="text-slate-600 mt-2 leading-relaxed">{keyword.definition}</p>
            )}
          </div>
          <div className="w-full sm:w-56 shrink-0">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1.5">
              <span>Completeness</span>
              <span>{completeness.score}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreColor(completeness.score)}`}
                style={{ width: `${completeness.score}%` }}
              />
            </div>
            {completeness.missing.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {completeness.missing.slice(0, 3).map((m) => (
                  <li key={m} className="text-[11px] text-slate-400">• {m}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {children.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Sub-concepts</div>
            <div className="flex flex-wrap gap-2">
              {children.map((child) => (
                <Link
                  key={child.id}
                  href={`/keywords/${child.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:border-blue-300 hover:text-blue-600 text-sm font-medium text-slate-700 transition-colors"
                >
                  {child.title}
                  <ChevronRight className="w-3 h-3 opacity-50" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto">
        {[
          { id: 'overview' as Tab, label: 'Overview', icon: BookOpen },
          { id: 'relations' as Tab, label: `Relations (${relations.length})`, icon: Link2 },
          { id: 'files' as Tab, label: `Files (${assets.length})`, icon: FileUp },
          { id: 'history' as Tab, label: 'History', icon: Clock },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                : 'text-slate-600 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {tab === 'overview' && (
          <KeywordDetail
            keyword={keyword}
            allKeywords={allKeywords}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={() => router.push('/keywords')}
          />
        )}

        {tab === 'relations' && (
          <div className="p-6">
            <RelationEditor
              keyword={keyword}
              allKeywords={allKeywords}
              relations={relations}
              onAddRelation={handleAddRelation}
              onRemoveRelation={handleRemoveRelation}
            />
          </div>
        )}

        {tab === 'files' && (
          <div className="p-6">
            <FileUpload
              keywordId={keyword.id}
              existingAssets={assets}
              onUpload={handleUploadFiles}
              onRemove={(assetId) => setAssets((prev) => prev.filter((a) => a.id !== assetId))}
              onViewAsset={(asset) => openAsset(asset)}
            />
          </div>
        )}

        {tab === 'history' && (
          <div className="divide-y divide-slate-100">
            {!versionsLoaded ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              </div>
            ) : versions.length === 0 ? (
              <p className="text-sm text-slate-400 py-12 text-center">
                No versions yet. Every edit creates a snapshot here.
              </p>
            ) : (
              versions.map((version) => {
                const snap = version.snapshot as Record<string, any>;
                const author =
                  (version as any).profiles?.full_name || (version as any).profiles?.email || '—';
                return (
                  <details key={version.id} className="group">
                    <summary className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-slate-50 list-none">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold">
                          v{version.version_no}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-slate-800">
                            {snap.title || 'Untitled'}
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              {version.change_type === 'DELETE' ? 'before deletion' : 'before edit'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400">
                            {new Date(version.created_at).toLocaleString()} · {author}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleRestore(version);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Restore
                      </button>
                    </summary>
                    <div className="px-6 pb-5 pt-1 space-y-2 bg-slate-50/50">
                      {snap.definition && (
                        <p className="text-sm text-slate-600">
                          <span className="font-semibold text-slate-700">Definition:</span> {snap.definition}
                        </p>
                      )}
                      {snap.explanation && (
                        <p className="text-sm text-slate-500 leading-relaxed">
                          <span className="font-semibold text-slate-700">Explanation:</span> {snap.explanation}
                        </p>
                      )}
                      {snap.rules?.length > 0 && (
                        <p className="text-sm text-slate-500">
                          <span className="font-semibold text-slate-700">Rules:</span> {snap.rules.join(' · ')}
                        </p>
                      )}
                    </div>
                  </details>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
