'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText, Loader2 } from 'lucide-react';

interface AuditRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any>;
  created_at: string;
  profiles: { email: string; full_name: string | null } | null;
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async (before?: string) => {
    try {
      const url = before ? `/api/audit?before=${encodeURIComponent(before)}` : '/api/audit';
      const response = await fetch(url);
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      const page: AuditRow[] = data ?? [];
      setRows((prev) => (before ? [...prev, ...page] : page));
      if (page.length < 50) setDone(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit log');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    if (rows.length === 0) return;
    setLoadingMore(true);
    await load(rows[rows.length - 1].created_at);
    setLoadingMore(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-slate-400" />
          Audit Log
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Every material action in this organization, append-only.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-12 text-center">No audit events yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold">Actor</th>
                <th className="px-5 py-3 font-semibold">Action</th>
                <th className="px-5 py-3 font-semibold">Entity</th>
                <th className="px-5 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-slate-700">
                    {row.profiles?.full_name || row.profiles?.email || 'system'}
                  </td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-1 rounded-md bg-slate-100 text-xs font-mono text-slate-700">
                      {row.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{row.entity_type ?? '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-400 font-mono max-w-[240px] truncate">
                    {row.details && Object.keys(row.details).length > 0
                      ? JSON.stringify(row.details)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !done && rows.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-all"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
