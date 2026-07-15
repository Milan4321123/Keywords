import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { openai } from '@/lib/openai';
import {
  loadOntology,
  getWorldModel,
  syncKeywordSkills,
  buildOntologySkeleton,
  writeSkillRow,
  ontologyHash,
  INSIGHTS_SKILL_NAME,
} from '@/lib/ai/skills';
import { Keyword, RelationType } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const RELATION_TYPES: RelationType[] = [
  'is-a', 'part-of', 'requires', 'causes', 'leads-to', 'owned-by', 'depends-on',
  'related-to', 'approves', 'contains', 'triggers', 'blocks', 'succeeds', 'precedes',
  'produces', 'affects', 'enables', 'uses', 'generated-by', 'measured-by',
  'reported-in', 'calculated-from', 'validated-by', 'conflicts-with', 'replaces',
  'derived-from', 'belongs-to',
];

export interface Insight {
  severity: 'high' | 'medium' | 'low';
  category: 'gap' | 'inconsistency' | 'opportunity' | 'flow';
  title: string;
  detail: string;
  keyword_ids: string[];
  recommended_action: string;
}

export interface FieldProposal {
  keyword_id: string;
  keyword_title?: string;
  definition?: string;
  explanation?: string;
  examples?: string[];
  rules?: string[];
  reason: string;
}

export interface RelationSuggestion {
  from_keyword_id: string;
  to_keyword_id: string;
  from_title?: string;
  to_title?: string;
  relation_type: RelationType;
  note?: string;
  reason: string;
}

export interface InsightsPayload {
  generated_at: string;
  ontology_hash: string;
  insights: Insight[];
  proposals: FieldProposal[];
  relation_suggestions: RelationSuggestion[];
  audit_findings: string[];
  world_model_generated_at: string | null;
}

/** Deterministic ontology audit — the facts the LLM pass is anchored to. */
function auditOntology(keywords: Keyword[], relationCount: Map<string, number>): string[] {
  const findings: string[] = [];

  const undefinedKws = keywords.filter((k) => !k.definition?.trim());
  if (undefinedKws.length > 0) {
    findings.push(
      `${undefinedKws.length} keyword(s) have no definition: ${undefinedKws.slice(0, 15).map((k) => k.title).join(', ')}${undefinedKws.length > 15 ? ', …' : ''}`
    );
  }

  const isolated = keywords.filter(
    (k) => !k.parent_id && !keywords.some((c) => c.parent_id === k.id) && !(relationCount.get(k.id) ?? 0)
  );
  if (isolated.length > 0) {
    findings.push(
      `${isolated.length} keyword(s) are isolated (no parent, children, or relations): ${isolated.slice(0, 10).map((k) => k.title).join(', ')}`
    );
  }

  const processNoRules = keywords.filter(
    (k) => (k.keyword_type === 'process' || k.keyword_type === 'workflow_step') && !(k.rules?.length)
  );
  if (processNoRules.length > 0) {
    findings.push(
      `${processNoRules.length} process keyword(s) have no business rules: ${processNoRules.slice(0, 10).map((k) => k.title).join(', ')}`
    );
  }

  // Vocabulary collisions: same name/synonym claimed by two keywords
  const nameOwners = new Map<string, string[]>();
  for (const k of keywords) {
    for (const name of [k.title, ...(k.synonyms ?? [])]) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      nameOwners.set(key, [...(nameOwners.get(key) ?? []), k.title]);
    }
  }
  const collisions = Array.from(nameOwners.entries()).filter(([, owners]) => new Set(owners).size > 1);
  if (collisions.length > 0) {
    findings.push(
      `Vocabulary collisions (one name, several keywords): ${collisions.slice(0, 8).map(([name, owners]) => `"${name}" → ${Array.from(new Set(owners)).join(' / ')}`).join('; ')}`
    );
  }

  const drafts = keywords.filter((k) => k.status === 'draft');
  if (drafts.length > 0) {
    findings.push(`${drafts.length} keyword(s) are still drafts: ${drafts.slice(0, 10).map((k) => k.title).join(', ')}`);
  }

  return findings;
}

// GET /api/insights — last generated insights (no LLM call)
export async function GET() {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { data } = await ctx.supabase
      .from('ai_skills')
      .select('required_data')
      .eq('organization_id', ctx.org.id)
      .eq('name', INSIGHTS_SKILL_NAME)
      .maybeSingle();
    return NextResponse.json({ data: (data?.required_data as InsightsPayload | undefined) ?? null, error: null });
  } catch (error) {
    return apiError(error, 'Failed to load insights');
  }
}

// POST /api/insights — recompile world model if stale, audit the ontology,
// and generate grounded insights + self-drafted detail proposals.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    enforceRateLimit('ai', ctx.user.id);
    const body = await req.json().catch(() => ({}));

    const ontology = await loadOntology(ctx);
    if (ontology.keywords.length === 0) {
      return NextResponse.json(
        { data: null, error: 'Noch keine Begriffe vorhanden · No keywords yet' },
        { status: 400 }
      );
    }
    const byId = new Map(ontology.keywords.map((k) => [k.id, k]));

    // Keep the harness fresh: world model + per-keyword skill cards
    const worldModel = await getWorldModel(ctx, {
      refresh: Boolean(body.refresh_world_model),
      ontology,
    });
    await syncKeywordSkills(ctx, ontology);

    const relationCount = new Map<string, number>();
    for (const r of ontology.relations) {
      relationCount.set(r.from_keyword_id, (relationCount.get(r.from_keyword_id) ?? 0) + 1);
      relationCount.set(r.to_keyword_id, (relationCount.get(r.to_keyword_id) ?? 0) + 1);
    }
    const auditFindings = auditOntology(ontology.keywords, relationCount);

    const skeleton = buildOntologySkeleton(ctx, ontology).slice(0, 14000);
    const undefinedList = ontology.keywords
      .filter((k) => !k.definition?.trim())
      .slice(0, 10)
      .map((k) => ({
        keyword_id: k.id,
        title: k.title,
        type: k.keyword_type,
        parent: k.parent_id ? byId.get(k.parent_id)?.title ?? null : null,
        siblings: ontology.keywords
          .filter((s) => s.parent_id === k.parent_id && s.id !== k.id)
          .slice(0, 6)
          .map((s) => s.title),
      }));

    const system = `You are the insight engine of an organizational AI harness. You receive a company's compiled world model, its full ontology skeleton, and a deterministic audit. Your job:
1. "insights": 3-8 findings the owner would likely overlook — gaps, inconsistencies, and concrete opportunities to make the business flow work better. Ground every finding in the provided material (name the keywords involved); never invent company facts.
2. "proposals": for the listed undefined keywords, draft the missing details yourself (definition: 1-2 sentences; optionally explanation, 2-4 examples, rules) exactly as this company would use the term, inferred from its parent, siblings, and the world model.
3. "relation_suggestions": up to 6 missing relations that are strongly implied by the ontology (e.g. a process that clearly requires a document type). Only use keyword ids that exist.

Write all user-facing text (title, detail, recommended_action, definitions, reasons) in the dominant language of the ontology. Relation types must be one of: ${RELATION_TYPES.join(', ')}.
Respond with ONLY valid JSON: {"insights":[{"severity":"high|medium|low","category":"gap|inconsistency|opportunity|flow","title":"","detail":"","keyword_ids":[],"recommended_action":""}],"proposals":[{"keyword_id":"","definition":"","explanation":"","examples":[],"rules":[],"reason":""}],"relation_suggestions":[{"from_keyword_id":"","to_keyword_id":"","relation_type":"","note":"","reason":""}]}`;

    const user = JSON.stringify({
      world_model: worldModel?.markdown ?? '(not available)',
      ontology_skeleton: skeleton,
      audit_findings: auditFindings,
      undefined_keywords: undefinedList,
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    });

    let raw: any = {};
    try {
      raw = JSON.parse(response.choices[0].message.content || '{}');
    } catch {
      return NextResponse.json({ data: null, error: 'AI returned invalid JSON' }, { status: 502 });
    }

    // Validate against the real ontology — drop anything referencing unknown ids.
    const insights: Insight[] = (Array.isArray(raw.insights) ? raw.insights : [])
      .filter((i: any) => i?.title && i?.detail)
      .slice(0, 10)
      .map((i: any) => ({
        severity: ['high', 'medium', 'low'].includes(i.severity) ? i.severity : 'medium',
        category: ['gap', 'inconsistency', 'opportunity', 'flow'].includes(i.category) ? i.category : 'opportunity',
        title: String(i.title),
        detail: String(i.detail),
        keyword_ids: (Array.isArray(i.keyword_ids) ? i.keyword_ids : []).filter((id: string) => byId.has(id)),
        recommended_action: String(i.recommended_action ?? ''),
      }));

    const proposals: FieldProposal[] = (Array.isArray(raw.proposals) ? raw.proposals : [])
      .filter((p: any) => p?.keyword_id && byId.has(p.keyword_id) && p?.definition)
      .slice(0, 12)
      .map((p: any) => ({
        keyword_id: p.keyword_id,
        keyword_title: byId.get(p.keyword_id)!.title,
        definition: String(p.definition),
        explanation: p.explanation ? String(p.explanation) : undefined,
        examples: Array.isArray(p.examples) ? p.examples.map(String).slice(0, 6) : undefined,
        rules: Array.isArray(p.rules) ? p.rules.map(String).slice(0, 6) : undefined,
        reason: String(p.reason ?? ''),
      }));

    const relationSuggestions: RelationSuggestion[] = (Array.isArray(raw.relation_suggestions) ? raw.relation_suggestions : [])
      .filter(
        (r: any) =>
          r?.from_keyword_id &&
          r?.to_keyword_id &&
          r.from_keyword_id !== r.to_keyword_id &&
          byId.has(r.from_keyword_id) &&
          byId.has(r.to_keyword_id) &&
          RELATION_TYPES.includes(r.relation_type) &&
          !ontology.relations.some(
            (ex) => ex.from_keyword_id === r.from_keyword_id && ex.to_keyword_id === r.to_keyword_id
          )
      )
      .slice(0, 6)
      .map((r: any) => ({
        from_keyword_id: r.from_keyword_id,
        to_keyword_id: r.to_keyword_id,
        from_title: byId.get(r.from_keyword_id)!.title,
        to_title: byId.get(r.to_keyword_id)!.title,
        relation_type: r.relation_type,
        note: r.note ? String(r.note) : undefined,
        reason: String(r.reason ?? ''),
      }));

    const payload: InsightsPayload = {
      generated_at: new Date().toISOString(),
      ontology_hash: ontologyHash(ontology),
      insights,
      proposals,
      relation_suggestions: relationSuggestions,
      audit_findings: auditFindings,
      world_model_generated_at: worldModel?.generated_at ?? null,
    };

    await writeSkillRow(ctx, INSIGHTS_SKILL_NAME, {
      description: 'Last generated ontology insights (auto-generated)',
      skill_type: 'recommendation',
      prompt_template: insights.map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`).join('\n') || '(none)',
      required_data: payload as unknown as Record<string, any>,
    });

    await audit(ctx, 'ai.insights.generate', { type: 'organization', id: ctx.org.id }, {
      insights: insights.length,
      proposals: proposals.length,
      relations: relationSuggestions.length,
    });

    return NextResponse.json({ data: payload, error: null });
  } catch (error) {
    return apiError(error, 'Failed to generate insights');
  }
}
