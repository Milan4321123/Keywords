'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  Lightbulb,
  Link2,
  Wand2,
} from 'lucide-react';

interface Insight {
  severity: 'high' | 'medium' | 'low';
  category: 'gap' | 'inconsistency' | 'opportunity' | 'flow';
  title: string;
  detail: string;
  keyword_ids: string[];
  recommended_action: string;
}

interface FieldProposal {
  keyword_id: string;
  keyword_title?: string;
  definition?: string;
  explanation?: string;
  examples?: string[];
  rules?: string[];
  reason: string;
}

interface RelationSuggestion {
  from_keyword_id: string;
  to_keyword_id: string;
  from_title?: string;
  to_title?: string;
  relation_type: string;
  note?: string;
  reason: string;
}

interface InsightsPayload {
  generated_at: string;
  insights: Insight[];
  proposals: FieldProposal[];
  relation_suggestions: RelationSuggestion[];
  audit_findings: string[];
}

interface WorldModel {
  markdown: string;
  generated_at: string;
  stats: { keywords: number; relations: number; defined: number };
}

const SEVERITY_DOT: Record<Insight['severity'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
};

const CATEGORY_LABEL: Record<Insight['category'], string> = {
  gap: 'Lücke · Gap',
  inconsistency: 'Widerspruch · Inconsistency',
  opportunity: 'Chance · Opportunity',
  flow: 'Ablauf · Flow',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function InsightsPage() {
  const [worldModel, setWorldModel] = useState<WorldModel | null>(null);
  const [worldModelOpen, setWorldModelOpen] = useState(false);
  const [compiling, setCompiling] = useState(false);

  const [payload, setPayload] = useState<InsightsPayload | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [appliedProposals, setAppliedProposals] = useState<Set<string>>(new Set());
  const [appliedRelations, setAppliedRelations] = useState<Set<number>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [insightsRes, wmRes] = await Promise.all([
          fetch('/api/insights'),
          fetch('/api/insights/world-model'),
        ]);
        const insights = await insightsRes.json();
        const wm = await wmRes.json();
        if (insights.data) setPayload(insights.data);
        if (wm.data) setWorldModel(wm.data);
      } catch (error) {
        console.error('Failed to load insights state:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setPayload(data);
      setAppliedProposals(new Set());
      setAppliedRelations(new Set());
      const wm = await fetch('/api/insights/world-model').then((r) => r.json());
      if (wm.data) setWorldModel(wm.data);
    } catch (error: any) {
      console.error('Analysis failed:', error);
      showToast(error.message || 'Analyse fehlgeschlagen · Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const recompileWorldModel = async () => {
    setCompiling(true);
    try {
      const response = await fetch('/api/insights/world-model', { method: 'POST' });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setWorldModel(data);
      showToast('Weltmodell aktualisiert · World model updated');
    } catch (error: any) {
      console.error('World model compile failed:', error);
      showToast(error.message || 'Aktualisierung fehlgeschlagen · Update failed');
    } finally {
      setCompiling(false);
    }
  };

  const applyProposal = async (proposal: FieldProposal) => {
    setBusyKey(`p:${proposal.keyword_id}`);
    try {
      const body: Record<string, any> = {};
      if (proposal.definition) body.definition = proposal.definition;
      if (proposal.explanation) body.explanation = proposal.explanation;
      if (proposal.examples?.length) body.examples = proposal.examples;
      if (proposal.rules?.length) body.rules = proposal.rules;
      const response = await fetch(`/api/keywords/${proposal.keyword_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setAppliedProposals((prev) => new Set(prev).add(proposal.keyword_id));
    } catch (error: any) {
      console.error('Apply failed:', error);
      showToast(error.message || 'Übernehmen fehlgeschlagen · Could not apply');
    } finally {
      setBusyKey(null);
    }
  };

  const applyAllProposals = async () => {
    if (!payload) return;
    for (const proposal of payload.proposals) {
      if (!appliedProposals.has(proposal.keyword_id)) {
        await applyProposal(proposal);
      }
    }
  };

  const applyRelation = async (suggestion: RelationSuggestion, index: number) => {
    setBusyKey(`r:${index}`);
    try {
      const response = await fetch('/api/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_keyword_id: suggestion.from_keyword_id,
          to_keyword_id: suggestion.to_keyword_id,
          relation_type: suggestion.relation_type,
          note: suggestion.note || suggestion.reason || 'KI-Vorschlag · AI suggestion',
        }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setAppliedRelations((prev) => new Set(prev).add(index));
    } catch (error: any) {
      console.error('Relation apply failed:', error);
      showToast(error.message || 'Verbinden fehlgeschlagen · Could not connect');
    } finally {
      setBusyKey(null);
    }
  };

  const openProposals = payload?.proposals.filter((p) => !appliedProposals.has(p.keyword_id)) ?? [];

  return (
    <div className="text-slate-900 font-sans">
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-32 space-y-6">
        {/* Header */}
        <header>
          <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-tight">Einblicke</h1>
          <p className="text-[15px] text-slate-500 mt-1">
            Was die KI über eure Firma weiß — und was ihr übersehen könntet · What the AI knows, and what you might miss
          </p>
        </header>

        {/* World model card */}
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden">
          <button
            onClick={() => setWorldModelOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-100 hover:bg-slate-50"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-medium text-slate-900">Weltmodell eurer Firma</span>
              <span className="block text-[13px] text-slate-400 truncate mt-0.5">
                {worldModel
                  ? `${worldModel.stats.keywords} Begriffe · ${worldModel.stats.relations} Verknüpfungen · Stand ${formatDate(worldModel.generated_at)}`
                  : 'Noch nicht kompiliert — Analyse starten · Not compiled yet'}
              </span>
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-300 shrink-0 transition-transform ${worldModelOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {worldModelOpen && (
            <div className="px-4 py-4 anim-fade-up">
              {worldModel ? (
                <>
                  <div className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto custom-scrollbar">
                    {worldModel.markdown}
                  </div>
                  <button
                    onClick={recompileWorldModel}
                    disabled={compiling}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  >
                    {compiling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Neu kompilieren · Recompile
                  </button>
                </>
              ) : (
                <p className="text-[14px] text-slate-500">
                  Das Weltmodell wird bei der ersten Analyse aus euren Begriffen kompiliert.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Analyze button */}
        <button
          onClick={analyze}
          disabled={analyzing || loading}
          className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-blue-600 text-white text-[16px] font-semibold shadow-sm shadow-blue-600/25 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-60 transition-all"
        >
          {analyzing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Analysiere eure Begriffe…
            </>
          ) : (
            <>
              <Lightbulb className="w-5 h-5" />
              {payload ? 'Neu analysieren · Re-analyze' : 'Analysieren · Analyze'}
            </>
          )}
        </button>

        {loading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : payload ? (
          <div className="space-y-8 anim-fade-up">
            <p className="px-1 text-[13px] text-slate-400">
              Letzte Analyse: {formatDate(payload.generated_at)}
            </p>

            {/* Insights */}
            {payload.insights.length > 0 && (
              <section>
                <p className="px-4 mb-2 text-[12px] font-semibold text-slate-400 uppercase tracking-wide">
                  Erkenntnisse · Insights
                </p>
                <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden">
                  {payload.insights.map((insight, i) => (
                    <div key={i} className="px-4 py-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[insight.severity]}`} />
                        <span className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide">
                          {CATEGORY_LABEL[insight.category]}
                        </span>
                      </div>
                      <h3 className="text-[15px] font-semibold text-slate-900">{insight.title}</h3>
                      <p className="text-[14px] text-slate-600 leading-relaxed mt-1">{insight.detail}</p>
                      {insight.recommended_action && (
                        <p className="text-[13px] text-blue-600 font-medium mt-2">
                          → {insight.recommended_action}
                        </p>
                      )}
                      {insight.keyword_ids.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {insight.keyword_ids.map((id) => (
                            <Link
                              key={id}
                              href={`/keywords/${id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-[12px] font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                            >
                              Begriff öffnen <ChevronRight className="w-3 h-3" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Self-drafted details */}
            {payload.proposals.length > 0 && (
              <section>
                <div className="flex items-center justify-between px-4 mb-2">
                  <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide">
                    Von der KI ausgefüllt · Drafted by AI
                  </p>
                  {openProposals.length > 1 && (
                    <button
                      onClick={applyAllProposals}
                      disabled={busyKey !== null}
                      className="text-[13px] font-semibold text-blue-600 active:opacity-50 disabled:opacity-40"
                    >
                      Alle übernehmen ({openProposals.length})
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden">
                  {payload.proposals.map((proposal) => {
                    const applied = appliedProposals.has(proposal.keyword_id);
                    const busy = busyKey === `p:${proposal.keyword_id}`;
                    return (
                      <div key={proposal.keyword_id} className={`px-4 py-4 ${applied ? 'bg-emerald-50/40' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
                              <Wand2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              {proposal.keyword_title}
                            </h3>
                            {proposal.definition && (
                              <p className="text-[14px] text-slate-700 leading-relaxed mt-1.5">{proposal.definition}</p>
                            )}
                            {proposal.examples && proposal.examples.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {proposal.examples.map((ex, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-md bg-blue-50 text-[12px] text-blue-700">
                                    {ex}
                                  </span>
                                ))}
                              </div>
                            )}
                            {proposal.rules && proposal.rules.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {proposal.rules.map((rule, i) => (
                                  <li key={i} className="text-[13px] text-amber-700 flex gap-1.5">
                                    <span className="shrink-0">•</span> {rule}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {proposal.reason && (
                              <p className="text-[12px] text-slate-400 mt-2">{proposal.reason}</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            {applied ? (
                              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-600">
                                <Check className="w-4 h-4" /> Übernommen
                              </span>
                            ) : (
                              <button
                                onClick={() => applyProposal(proposal)}
                                disabled={busyKey !== null}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 transition-all"
                              >
                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                Übernehmen
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Relation suggestions */}
            {payload.relation_suggestions.length > 0 && (
              <section>
                <p className="px-4 mb-2 text-[12px] font-semibold text-slate-400 uppercase tracking-wide">
                  Vorgeschlagene Verknüpfungen · Suggested connections
                </p>
                <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 divide-y divide-slate-100 overflow-hidden">
                  {payload.relation_suggestions.map((suggestion, index) => {
                    const applied = appliedRelations.has(index);
                    const busy = busyKey === `r:${index}`;
                    return (
                      <div key={index} className={`px-4 py-3.5 flex items-center gap-3 ${applied ? 'bg-emerald-50/40' : ''}`}>
                        <Link2 className="w-4 h-4 text-slate-300 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] text-slate-800">
                            <span className="font-semibold">{suggestion.from_title}</span>
                            <span className="mx-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                              {suggestion.relation_type}
                            </span>
                            <span className="font-semibold">{suggestion.to_title}</span>
                          </p>
                          {suggestion.reason && (
                            <p className="text-[12px] text-slate-400 mt-0.5 truncate">{suggestion.reason}</p>
                          )}
                        </div>
                        {applied ? (
                          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600 shrink-0">
                            <Check className="w-4 h-4" /> Verbunden
                          </span>
                        ) : (
                          <button
                            onClick={() => applyRelation(suggestion, index)}
                            disabled={busyKey !== null}
                            className="shrink-0 px-3.5 py-2 rounded-xl text-[13px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 active:scale-95 disabled:opacity-40 transition-all"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verbinden'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Audit findings */}
            {payload.audit_findings.length > 0 && (
              <section>
                <p className="px-4 mb-2 text-[12px] font-semibold text-slate-400 uppercase tracking-wide">
                  Automatische Prüfung · Automated audit
                </p>
                <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 px-4 py-4">
                  <ul className="space-y-2">
                    {payload.audit_findings.map((finding, i) => (
                      <li key={i} className="text-[13px] text-slate-600 flex gap-2">
                        <span className="text-slate-300 shrink-0">•</span> {finding}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="py-16 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-50 text-blue-500 mb-3">
              <Lightbulb className="w-6 h-6" />
            </div>
            <p className="text-[15px] font-medium text-slate-700">Noch keine Analyse</p>
            <p className="text-[13px] text-slate-400 mt-1 max-w-sm mx-auto">
              Die KI liest eure Begriffe, baut ein Weltmodell eurer Firma und zeigt, was fehlt oder besser laufen könnte.
            </p>
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-full bg-slate-900 text-white text-sm shadow-lg anim-fade-up">
          {toast}
        </div>
      )}
    </div>
  );
}
