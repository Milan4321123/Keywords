'use client';

import React, { useRef, useState } from 'react';
import { Download, Upload, Loader2, RefreshCw, MoreHorizontal } from 'lucide-react';

interface ImportExportMenuProps {
  onImported: () => void;
}

export default function ImportExportMenu({ onImported }: ImportExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const importFile = async (file: File) => {
    setBusy('import');
    setMessage(null);
    try {
      const text = await file.text();
      let body: Record<string, any>;
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text);
        body = { keywords: Array.isArray(parsed) ? parsed : parsed.keywords ?? [] };
      } else {
        body = { csv: text };
      }
      const response = await fetch('/api/keywords/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setMessage(
        `Imported: ${data.created} created, ${data.updated} updated${
          data.errors?.length ? `, ${data.errors.length} errors` : ''
        }`
      );
      onImported();
    } catch (err: any) {
      setMessage(err.message || 'Import failed');
    } finally {
      setBusy(null);
    }
  };

  const recompute = async () => {
    setBusy('recompute');
    setMessage(null);
    try {
      const response = await fetch('/api/keywords/recompute', { method: 'POST' });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setMessage(`Recomputed completeness for ${data.recomputed} keywords`);
      onImported();
    } catch (err: any) {
      setMessage(err.message || 'Recompute failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
        Tools
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 w-64 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
            <a
              href="/api/keywords/export?format=json"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4 text-slate-400" /> Export as JSON
            </a>
            <a
              href="/api/keywords/export?format=csv"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4 text-slate-400" /> Export as CSV
            </a>
            <button
              onClick={() => {
                setOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100 transition-colors"
            >
              <Upload className="w-4 h-4 text-slate-400" /> Import JSON / CSV
            </button>
            <button
              onClick={() => {
                setOpen(false);
                recompute();
              }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100 transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-slate-400" /> Recompute completeness
            </button>
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importFile(file);
          e.target.value = '';
        }}
      />

      {message && (
        <div className="absolute right-0 top-full mt-2 z-40 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-lg whitespace-nowrap">
          {message}
          <button onClick={() => setMessage(null)} className="ml-3 text-slate-400 hover:text-white">✕</button>
        </div>
      )}
    </div>
  );
}
