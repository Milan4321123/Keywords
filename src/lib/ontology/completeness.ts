import { SupabaseClient } from '@supabase/supabase-js';

export interface CompletenessInput {
  definition?: string | null;
  explanation?: string | null;
  examples?: string[] | null;
  synonyms?: string[] | null;
  rules?: string[] | null;
  relationCount?: number;
  assetCount?: number;
}

export interface CompletenessBreakdown {
  score: number;
  missing: string[];
}

/**
 * Completeness score 0–100 for a keyword. Weights:
 * definition 25, explanation 20, examples 15, synonyms 10,
 * rules 10, relations 10, assets 10.
 * A keyword is only "complete" when it carries meaning
 * (definitions), context (examples/rules), and connections
 * (relations/evidence) — matching the product's grounding rules.
 */
export function computeCompleteness(input: CompletenessInput): CompletenessBreakdown {
  let score = 0;
  const missing: string[] = [];

  const definition = (input.definition ?? '').trim();
  if (definition.length >= 20) score += 25;
  else if (definition.length > 0) {
    score += 15;
    missing.push('Definition is very short');
  } else missing.push('No definition');

  const explanation = (input.explanation ?? '').trim();
  if (explanation.length >= 60) score += 20;
  else if (explanation.length > 0) {
    score += 10;
    missing.push('Explanation is very short');
  } else missing.push('No detailed explanation');

  const examples = (input.examples ?? []).filter((e) => e && e.trim());
  if (examples.length >= 3) score += 15;
  else if (examples.length >= 1) {
    score += 10;
    missing.push('Fewer than 3 examples');
  } else missing.push('No examples');

  if ((input.synonyms ?? []).some((s) => s && s.trim())) score += 10;
  else missing.push('No synonyms');

  if ((input.rules ?? []).some((r) => r && r.trim())) score += 10;
  else missing.push('No business rules');

  if ((input.relationCount ?? 0) > 0) score += 10;
  else missing.push('No relations to other keywords');

  if ((input.assetCount ?? 0) > 0) score += 10;
  else missing.push('No attached evidence');

  return { score, missing };
}

/**
 * Recompute and persist the completeness score for one keyword.
 * Safe to fire-and-forget; never throws.
 */
export async function recomputeKeywordCompleteness(
  supabase: SupabaseClient,
  organizationId: string,
  keywordId: string
): Promise<number | null> {
  try {
    const [{ data: keyword }, relationsRes, assetsRes] = await Promise.all([
      supabase
        .from('keywords')
        .select('id, definition, explanation, examples, synonyms, rules, completeness_score')
        .eq('id', keywordId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('keyword_relations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .or(`from_keyword_id.eq.${keywordId},to_keyword_id.eq.${keywordId}`),
      supabase
        .from('keyword_assets')
        .select('id', { count: 'exact', head: true })
        .eq('keyword_id', keywordId),
    ]);

    if (!keyword) return null;

    const { score } = computeCompleteness({
      ...keyword,
      relationCount: relationsRes.count ?? 0,
      assetCount: assetsRes.count ?? 0,
    });

    if (score !== keyword.completeness_score) {
      await supabase
        .from('keywords')
        .update({ completeness_score: score })
        .eq('id', keywordId)
        .eq('organization_id', organizationId);
    }
    return score;
  } catch (error) {
    console.error('Failed to recompute completeness for keyword', keywordId, error);
    return null;
  }
}
