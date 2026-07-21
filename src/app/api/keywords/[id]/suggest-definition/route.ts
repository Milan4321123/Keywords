import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { getProvider } from '@/lib/ai/provider';

type RouteParams = { params: Promise<{ id: string }> };

const SYSTEM_PROMPT = `You are a knowledge architect writing company-specific business definitions.
You are given a business concept and its context inside one company's keyword ontology
(parent concept, sub-concepts, related concepts, industry).

Write a suggestion the user will review and approve. Ground it strictly in the provided
context — do not invent company-specific facts (numbers, names, policies) that were not given.

Return ONLY valid JSON:
{
  "definition": "1-2 sentence short definition",
  "explanation": "4-8 sentence detailed explanation of the concept in this company's context",
  "examples": ["example 1", "example 2", "example 3"]
}`;

// POST /api/keywords/[id]/suggest-definition - AI-drafted definition for user approval
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('run_ai');
    const { id } = await params;

    const { data: keyword, error: kwError } = await ctx.supabase
      .from('keywords')
      .select('*')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .single();
    if (kwError) throw kwError;

    const [{ data: parent }, { data: children }, { data: relations }] = await Promise.all([
      keyword.parent_id
        ? ctx.supabase
            .from('keywords')
            .select('title, definition')
            .eq('id', keyword.parent_id)
            .eq('organization_id', ctx.org.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      ctx.supabase
        .from('keywords')
        .select('title, definition')
        .eq('parent_id', id)
        .eq('organization_id', ctx.org.id)
        .limit(10),
      ctx.supabase
        .from('keyword_relations')
        .select('relation_type, from_keyword:keywords!from_keyword_id(title), to_keyword:keywords!to_keyword_id(title)')
        .eq('organization_id', ctx.org.id)
        .or(`from_keyword_id.eq.${id},to_keyword_id.eq.${id}`)
        .limit(15),
    ]);

    const { data: org } = await ctx.supabase
      .from('organizations')
      .select('industry')
      .eq('id', ctx.org.id)
      .maybeSingle();

    const contextLines = [
      `Concept: "${keyword.title}"`,
      org?.industry ? `Company industry: ${org.industry}` : null,
      keyword.definition ? `Current definition (improve on it): ${keyword.definition}` : null,
      keyword.explanation ? `Current explanation: ${keyword.explanation}` : null,
      keyword.synonyms?.length ? `Synonyms: ${keyword.synonyms.join(', ')}` : null,
      parent ? `Parent concept: ${parent.title}${parent.definition ? ` — ${parent.definition}` : ''}` : null,
      children?.length
        ? `Sub-concepts: ${children.map((c: any) => c.title).join(', ')}`
        : null,
      relations?.length
        ? `Relations: ${relations
            .map((r: any) => `${r.from_keyword?.title} ${r.relation_type} ${r.to_keyword?.title}`)
            .join('; ')}`
        : null,
    ].filter(Boolean);

    const response = await getProvider().chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: contextLines.join('\n') },
      ],
      { tier: 'strong', json: true, temperature: 0.4, maxTokens: 700 }
    );

    let parsed: { definition?: string; explanation?: string; examples?: string[] };
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = JSON.parse((jsonMatch ? jsonMatch[1] : response).trim());
    } catch {
      return NextResponse.json(
        { data: null, error: 'AI returned an unparseable suggestion. Try again.' },
        { status: 502 }
      );
    }

    await audit(ctx, 'ai.suggest_definition', { type: 'keyword', id });

    return NextResponse.json({
      data: {
        definition: parsed.definition ?? '',
        explanation: parsed.explanation ?? '',
        examples: Array.isArray(parsed.examples) ? parsed.examples.slice(0, 5) : [],
        context_used: contextLines,
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to suggest definition');
  }
}
