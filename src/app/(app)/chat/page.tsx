'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Send,
  Loader2,
  Sparkles,
  FolderTree,
  Table2,
  FileText,
  Calculator,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { Keyword } from '@/types';

type Mode = 'auto' | 'definition' | 'analysis' | 'report' | 'forecast' | 'workflow' | 'search';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'search', label: 'Ask' },
  { id: 'analysis', label: 'Analyze' },
  { id: 'report', label: 'Report' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'definition', label: 'Explain' },
  { id: 'workflow', label: 'Workflow' },
];

interface TableOption {
  id: string;
  label: string;
}

interface AiSources {
  keywords: Array<{ id: string; title: string; relevance: number; via: string }>;
  documents: Array<{ chunk_id: string; file_name: string | null; similarity: number }>;
  tables: Array<{ table_id: string; name: string; dataset: string }>;
}

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  sources?: AiSources;
  calculations?: Array<{ tool: string; input: Record<string, any>; output: Record<string, any> }>;
  missing_data?: string[];
}

export default function ChatPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [mode, setMode] = useState<Mode>('auto');
  const [scopeKeywordIds, setScopeKeywordIds] = useState<string[]>([]);
  const [scopeTableId, setScopeTableId] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/keywords')
      .then((r) => r.json())
      .then(({ data }) => setKeywords(data ?? []));
    fetch('/api/datasets')
      .then((r) => r.json())
      .then(({ data }) => {
        const options: TableOption[] = [];
        for (const dataset of data ?? []) {
          for (const table of dataset.tables ?? []) {
            options.push({ id: table.id, label: `${dataset.title} — ${table.name}` });
          }
        }
        setTables(options);
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  const sortedKeywords = useMemo(
    () => [...keywords].sort((a, b) => a.title.localeCompare(b.title)),
    [keywords]
  );

  const toggleKeyword = (id: string) => {
    setScopeKeywordIds((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  };

  const ask = async () => {
    const question = input.trim();
    if (!question || asking) return;
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setAsking(true);

    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          mode: mode === 'auto' ? undefined : mode,
          session_id: sessionId,
          scope: {
            keyword_ids: scopeKeywordIds,
            dataset_table_id: scopeTableId || undefined,
          },
        }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);

      setSessionId(data.session_id ?? sessionId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          intent: data.intent,
          sources: data.sources,
          calculations: data.calculations,
          missing_data: data.missing_data,
        },
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to get an answer');
    } finally {
      setAsking(false);
    }
  };

  const resetConversation = () => {
    setMessages([]);
    setSessionId(null);
    setError(null);
  };

  const scopeSummary = useMemo(() => {
    const parts: string[] = [];
    if (scopeKeywordIds.length > 0) parts.push(`${scopeKeywordIds.length} keyword${scopeKeywordIds.length > 1 ? 's' : ''}`);
    if (scopeTableId) parts.push('1 dataset');
    return parts.length > 0 ? parts.join(' + ') : 'Whole organization';
  }, [scopeKeywordIds, scopeTableId]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-slate-400" />
            AI Chat
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Grounded answers from your ontology, documents, and structured data.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={resetConversation}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> New conversation
          </button>
        )}
      </div>

      {/* Mode + scope bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-4 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === m.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {m.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setScopeOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
          >
            Scope: {scopeSummary}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${scopeOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {scopeOpen && (
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5" /> Keywords
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
                {sortedKeywords.map((keyword) => (
                  <label
                    key={keyword.id}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 cursor-pointer text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={scopeKeywordIds.includes(keyword.id)}
                      onChange={() => toggleKeyword(keyword.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="truncate">{keyword.title}</span>
                  </label>
                ))}
                {sortedKeywords.length === 0 && (
                  <p className="text-xs text-slate-400 px-2">No keywords yet.</p>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Table2 className="w-3.5 h-3.5" /> Dataset
              </div>
              <select
                value={scopeTableId}
                onChange={(e) => setScopeTableId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50"
              >
                <option value="">All datasets</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>{table.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-12 text-center">
            <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">Ask anything about your company.</p>
            <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
              "What is our income this month?" · "Explain what an Invoice requires" ·
              "Compare order volume by project"
            </p>
          </div>
        )}

        {messages.map((message, i) =>
          message.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-br-md bg-slate-900 text-white text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4">
                {message.intent && (
                  <span className="inline-block px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase tracking-wide mb-2">
                    {message.intent}
                  </span>
                )}
                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>

              {(message.missing_data?.length ?? 0) > 0 && (
                <div className="px-5 py-3 bg-amber-50/60 border-t border-amber-100 space-y-1">
                  {message.missing_data!.map((m, j) => (
                    <div key={j} className="flex items-start gap-2 text-xs text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {m}
                    </div>
                  ))}
                </div>
              )}

              {(message.calculations?.length ?? 0) > 0 && (
                <details className="border-t border-slate-100">
                  <summary className="px-5 py-2.5 text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-50 flex items-center gap-1.5">
                    <Calculator className="w-3.5 h-3.5" />
                    {message.calculations!.length} calculation{message.calculations!.length > 1 ? 's' : ''} performed
                  </summary>
                  <div className="px-5 pb-4 space-y-2">
                    {message.calculations!.map((calc, j) => (
                      <div key={j} className="text-xs bg-slate-50 rounded-lg p-3 font-mono overflow-x-auto">
                        <div className="font-bold text-slate-600 mb-1">{calc.tool}</div>
                        <div className="text-slate-500">in: {JSON.stringify(calc.input)}</div>
                        <div className="text-slate-500 mt-1">
                          out: {JSON.stringify(calc.output).slice(0, 400)}
                          {JSON.stringify(calc.output).length > 400 && '…'}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {message.sources &&
                (message.sources.keywords.length > 0 ||
                  message.sources.documents.length > 0 ||
                  message.sources.tables.length > 0) && (
                  <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                    {message.sources.keywords.slice(0, 6).map((k) => (
                      <span key={k.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[11px] font-medium">
                        <FolderTree className="w-3 h-3" /> {k.title}
                        {k.via !== 'seed' && <span className="opacity-60">· {k.via}</span>}
                      </span>
                    ))}
                    {message.sources.tables.map((t) => (
                      <span key={t.table_id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-medium">
                        <Table2 className="w-3 h-3" /> {t.name}
                      </span>
                    ))}
                    {message.sources.documents.slice(0, 4).map((d) => (
                      <span key={d.chunk_id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                        <FileText className="w-3 h-3" /> {d.file_name ?? 'document'}
                      </span>
                    ))}
                  </div>
                )}
            </div>
          )
        )}

        {asking && (
          <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center gap-3 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Routing, gathering context, computing…
          </div>
        )}
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="sticky bottom-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-2 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            rows={1}
            placeholder="Ask about your company…"
            className="flex-1 px-3 py-2.5 text-sm bg-transparent border-none focus:ring-0 resize-none max-h-32"
          />
          <button
            onClick={ask}
            disabled={asking || !input.trim()}
            className="p-3 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-all shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
