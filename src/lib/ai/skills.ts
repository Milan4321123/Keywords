import { createHash } from 'crypto';
import { OrgContext, accessibleLevels, roleHasPermission } from '@/lib/auth';
import { chatCompletion } from '@/lib/openai';
import { Keyword, KeywordRelation } from '@/types';

/**
 * Keyword Skills & Organization World Model
 * =========================================
 * Every keyword is compiled into a "skill" — a self-contained context module
 * the LLM can load to understand that concept exactly the way this company
 * defines it. On top of the skills sits one org-level "world model": a
 * compact synthesis of what the company is, how its concepts connect, and
 * where the blind spots are. Both are persisted in the `ai_skills` table
 * (world model = row with keyword_id NULL and the reserved name below) and
 * re-compiled only when the ontology content hash changes.
 */

export const WORLD_MODEL_SKILL_NAME = '__world_model__';
export const INSIGHTS_SKILL_NAME = '__insights__';
export const GUIDANCE_SKILL_NAME = '__guidance__';

export interface Ontology {
  keywords: Keyword[];
  relations: KeywordRelation[];
}

export interface WorldModel {
  markdown: string;
  hash: string;
  generated_at: string;
  stats: { keywords: number; relations: number; defined: number };
}

/** Load the access-filtered ontology (keywords + relations) for an org. */
export async function loadOntology(ctx: OrgContext): Promise<Ontology> {
  const [{ data: keywords }, { data: relations }] = await Promise.all([
    ctx.supabase
      .from('keywords')
      .select('*')
      .eq('organization_id', ctx.org.id)
      .in('access_level', accessibleLevels(ctx.role))
      .neq('status', 'archived')
      .order('sort_order')
      .order('title'),
    ctx.supabase
      .from('keyword_relations')
      .select('*, from_keyword:keywords!keyword_relations_from_keyword_id_fkey(id, title), to_keyword:keywords!keyword_relations_to_keyword_id_fkey(id, title)')
      .eq('organization_id', ctx.org.id),
  ]);
  return { keywords: (keywords ?? []) as Keyword[], relations: (relations ?? []) as KeywordRelation[] };
}

/** Stable content hash so we only re-compile when the ontology changed. */
export function ontologyHash(ontology: Ontology): string {
  const h = createHash('sha256');
  for (const k of ontology.keywords) {
    h.update(`${k.id}|${k.updated_at}|`);
  }
  for (const r of ontology.relations) {
    h.update(`${r.from_keyword_id}>${r.relation_type}>${r.to_keyword_id}|`);
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Compile one keyword into a deterministic "skill card" — the exact context
 * block an LLM gets when this concept is in play. No LLM call needed.
 */
export function compileKeywordSkill(
  keyword: Keyword,
  ontology: Ontology
): { name: string; description: string; markdown: string } {
  const byId = new Map(ontology.keywords.map((k) => [k.id, k]));
  const parent = keyword.parent_id ? byId.get(keyword.parent_id) : null;
  const children = ontology.keywords.filter((k) => k.parent_id === keyword.id);
  const rels = ontology.relations.filter(
    (r) => r.from_keyword_id === keyword.id || r.to_keyword_id === keyword.id
  );

  const lines: string[] = [`## Skill: ${keyword.title}`];
  if (keyword.keyword_type) lines.push(`Type: ${keyword.keyword_type}`);
  if (parent) lines.push(`Belongs to: ${parent.title}`);
  if (keyword.definition) lines.push(`Definition: ${keyword.definition}`);
  if (keyword.explanation) lines.push(`Explanation: ${keyword.explanation}`);
  if (keyword.synonyms?.length) lines.push(`Also called: ${keyword.synonyms.join(', ')}`);
  const labels = Object.entries(keyword.labels_json ?? {});
  if (labels.length) lines.push(`Translations: ${labels.map(([l, v]) => `${l}=${v}`).join(', ')}`);
  if (keyword.examples?.length) lines.push(`Examples: ${keyword.examples.join('; ')}`);
  if (keyword.rules?.length) {
    lines.push('Rules that MUST hold:');
    for (const rule of keyword.rules) lines.push(`- ${rule}`);
  }
  if (children.length) lines.push(`Sub-concepts: ${children.map((c) => c.title).join(', ')}`);
  if (rels.length) {
    lines.push('Relations:');
    for (const r of rels.slice(0, 20)) {
      const from = r.from_keyword?.title ?? byId.get(r.from_keyword_id)?.title ?? '?';
      const to = r.to_keyword?.title ?? byId.get(r.to_keyword_id)?.title ?? '?';
      lines.push(`- ${from} ${r.relation_type} ${to}${r.note ? ` (${r.note})` : ''}`);
    }
  }

  return {
    name: keyword.title,
    description: keyword.definition ?? '',
    markdown: lines.join('\n'),
  };
}

/** Deterministic skeleton the world-model LLM pass is grounded on. */
export function buildOntologySkeleton(ctx: OrgContext, ontology: Ontology): string {
  const { keywords, relations } = ontology;
  const byParent = new Map<string | null, Keyword[]>();
  for (const k of keywords) {
    const key = k.parent_id ?? null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(k);
  }

  const lines: string[] = [];
  lines.push(`Organization: ${ctx.org.name}`);
  lines.push(`Keywords: ${keywords.length}, relations: ${relations.length}`);
  lines.push('', '### Concept tree');
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 4) return;
    for (const k of byParent.get(parentId) ?? []) {
      const def = k.definition ? ` — ${k.definition.slice(0, 160)}` : ' — (no definition yet)';
      lines.push(`${'  '.repeat(depth)}- ${k.title} [${k.keyword_type ?? 'concept'}]${def}`);
      walk(k.id, depth + 1);
    }
  };
  walk(null, 0);

  const rules = keywords.flatMap((k) => (k.rules ?? []).map((r) => `- [${k.title}] ${r}`));
  if (rules.length) {
    lines.push('', '### Business rules');
    lines.push(...rules.slice(0, 60));
  }
  if (relations.length) {
    lines.push('', '### Relations');
    for (const r of relations.slice(0, 80)) {
      lines.push(`- ${r.from_keyword?.title ?? '?'} ${r.relation_type} ${r.to_keyword?.title ?? '?'}`);
    }
  }
  return lines.join('\n');
}

/** Read the cached world model without triggering compilation. */
export async function readCachedWorldModel(ctx: OrgContext): Promise<WorldModel | null> {
  const { data } = await ctx.supabase
    .from('ai_skills')
    .select('prompt_template, required_data')
    .eq('organization_id', ctx.org.id)
    .eq('name', WORLD_MODEL_SKILL_NAME)
    .maybeSingle();
  if (!data?.prompt_template) return null;
  const meta = (data.required_data ?? {}) as any;
  return {
    markdown: data.prompt_template,
    hash: meta.hash ?? '',
    generated_at: meta.generated_at ?? '',
    stats: meta.stats ?? { keywords: 0, relations: 0, defined: 0 },
  };
}

/**
 * Get the organization world model. Re-compiles (one LLM pass) when the
 * ontology changed and the caller may write; otherwise serves the cache.
 */
export async function getWorldModel(
  ctx: OrgContext,
  options: { refresh?: boolean; ontology?: Ontology } = {}
): Promise<WorldModel | null> {
  const ontology = options.ontology ?? (await loadOntology(ctx));
  if (ontology.keywords.length === 0) return null;

  const hash = ontologyHash(ontology);
  const cached = await readCachedWorldModel(ctx);
  const canWrite = roleHasPermission(ctx.role, 'edit_keywords');

  if (cached && cached.hash === hash && !options.refresh) return cached;
  if (!canWrite) return cached; // stale is better than nothing for read-only roles

  const skeleton = buildOntologySkeleton(ctx, ontology);
  const markdown = await chatCompletion(
    [
      {
        role: 'system',
        content:
          'You compile organization world models for an AI harness. From the ontology skeleton, write a compact, factual world model of this company that a language model will load as base context for every future question. ' +
          'Sections: 1) Identity & domain (what this company does, inferred strictly from its concepts), 2) Core objects & vocabulary (the load-bearing concepts and what they mean here), 3) How work flows (processes/roles/dependencies as evidenced by relations and rules), 4) Hard rules (verbatim, attributed to their keyword), 5) Known blind spots (undefined or unconnected concepts). ' +
          'Ground every statement in the skeleton — never invent facts. Write in the ontology\'s dominant language. Max ~700 words.',
      },
      { role: 'user', content: skeleton },
    ],
    { temperature: 0.3, max_tokens: 1400 }
  );

  const model: WorldModel = {
    markdown,
    hash,
    generated_at: new Date().toISOString(),
    stats: {
      keywords: ontology.keywords.length,
      relations: ontology.relations.length,
      defined: ontology.keywords.filter((k) => k.definition?.trim()).length,
    },
  };

  await writeSkillRow(ctx, WORLD_MODEL_SKILL_NAME, {
    description: 'Compiled organization world model (auto-generated)',
    skill_type: 'summary',
    prompt_template: model.markdown,
    required_data: { hash: model.hash, generated_at: model.generated_at, stats: model.stats },
  });

  return model;
}

/** Read the learned guidance distilled from human feedback (RLHF-light: corrections steer future answers immediately). */
export async function readGuidance(ctx: OrgContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('ai_skills')
    .select('prompt_template')
    .eq('organization_id', ctx.org.id)
    .eq('name', GUIDANCE_SKILL_NAME)
    .maybeSingle();
  return data?.prompt_template ?? null;
}

/**
 * Recompile the guidance skill from the latest human feedback: every
 * thumbs-down with a correction becomes a standing instruction for future
 * answers. Deterministic — no LLM call, takes effect on the very next question.
 */
export async function recompileGuidance(ctx: OrgContext): Promise<number> {
  const { data: rows, error } = await ctx.supabase
    .from('ai_feedback')
    .select('question, correction, created_at')
    .eq('organization_id', ctx.org.id)
    .eq('rating', -1)
    .not('correction', 'is', null)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;

  const corrections = (rows ?? []).filter((r) => r.correction?.trim());
  if (corrections.length === 0) return 0;

  const lines = [
    '## Learned guidance from human feedback',
    'Users corrected earlier answers. Apply these corrections — they override generic knowledge:',
    ...corrections.map((r) => `- Frage: "${r.question.slice(0, 200)}" → Korrektur: ${r.correction!.slice(0, 400)}`),
  ];

  await writeSkillRow(ctx, GUIDANCE_SKILL_NAME, {
    description: 'Standing corrections distilled from AI answer feedback',
    skill_type: 'qa',
    prompt_template: lines.join('\n'),
    required_data: { corrections: corrections.length, compiled_at: new Date().toISOString() },
  });
  return corrections.length;
}

/** Insert-or-update a reserved org-level skill row by name (no unique constraint on the table). */
export async function writeSkillRow(
  ctx: OrgContext,
  name: string,
  fields: { description: string; skill_type: string; prompt_template: string; required_data: Record<string, any> }
): Promise<void> {
  const { data: existing } = await ctx.supabase
    .from('ai_skills')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('name', name)
    .maybeSingle();

  const row = { ...fields, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await ctx.supabase.from('ai_skills').update(row).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await ctx.supabase
      .from('ai_skills')
      .insert({ organization_id: ctx.org.id, keyword_id: null, name, ...row });
    if (error) throw error;
  }
}

/**
 * Sync per-keyword skill cards into ai_skills (deterministic, no LLM cost).
 * Returns how many skills were written.
 */
export async function syncKeywordSkills(ctx: OrgContext, ontology: Ontology): Promise<number> {
  const rows = ontology.keywords.map((k) => {
    const skill = compileKeywordSkill(k, ontology);
    return {
      organization_id: ctx.org.id,
      keyword_id: k.id,
      name: skill.name,
      description: skill.description,
      skill_type: 'qa' as const,
      prompt_template: skill.markdown,
      required_data: { compiled_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length === 0) return 0;
  // Cache table without unique constraints: replace the org's keyword skills wholesale.
  const { error: delError } = await ctx.supabase
    .from('ai_skills')
    .delete()
    .eq('organization_id', ctx.org.id)
    .not('keyword_id', 'is', null);
  if (delError) throw delError;
  const { error } = await ctx.supabase.from('ai_skills').insert(rows);
  if (error) throw error;
  return rows.length;
}
