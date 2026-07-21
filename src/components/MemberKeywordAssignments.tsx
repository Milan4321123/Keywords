'use client';

import React, { useEffect, useState } from 'react';
import { FolderTree, Loader2, Plus, X } from 'lucide-react';
import { Keyword } from '@/types';

interface Assignment {
  id: string;
  keyword_id: string;
  keyword: { id: string; title: string } | null;
}

/**
 * Assign keywords (branches) to one member. A worker with assignments sees
 * ONLY those branches in the app; without assignments they see everything
 * at worker level.
 */
export default function MemberKeywordAssignments({
  memberId,
  keywords,
}: {
  memberId: string;
  keywords: Keyword[];
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch(`/api/orgs/members/assignments?member_id=${memberId}`);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setAssignments(data ?? []);
    } catch (err: any) {
      setError(err.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const assign = async (keywordId: string) => {
    if (!keywordId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/orgs/members/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, keyword_id: keywordId }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      await load();
    } catch (err: any) {
      setError(err.message || 'Zuweisen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (keywordId: string) => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/orgs/members/assignments?member_id=${memberId}&keyword_id=${keywordId}`, {
        method: 'DELETE',
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const assignedIds = new Set(assignments.map((a) => a.keyword_id));
  const available = keywords.filter((k) => !assignedIds.has(k.id));

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-2.5">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
        <FolderTree className="w-3.5 h-3.5 text-slate-400" />
        Zugewiesene Begriffe · Assigned keywords
        {busy && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
      ) : (
        <>
          {assignments.length === 0 ? (
            <p className="text-xs text-slate-400">
              Keine Zuweisung — sieht alle Begriffe der Worker-Ebene. · None assigned — sees all worker-level keywords.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {assignments.map((assignment) => (
                <span
                  key={assignment.id}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-blue-50 border border-blue-100 text-xs font-medium text-blue-700"
                >
                  {assignment.keyword?.title ?? '—'}
                  <button
                    onClick={() => remove(assignment.keyword_id)}
                    className="opacity-50 hover:opacity-100"
                    title="Entfernen · Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              defaultValue=""
              onChange={(e) => {
                assign(e.target.value);
                e.target.value = '';
              }}
              disabled={busy}
              className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
            >
              <option value="">Begriff/Zweig zuweisen · Assign keyword/branch…</option>
              {available.map((k) => (
                <option key={k.id} value={k.id}>{k.title}</option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-slate-400">
            Ein zugewiesener Zweig umfasst alle Unterbegriffe. · An assigned branch includes all sub-keywords.
          </p>
        </>
      )}
    </div>
  );
}
