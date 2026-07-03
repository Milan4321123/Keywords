import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { getProvider } from '@/lib/ai/provider';

// POST /api/tasks/checklist - AI checklist suggestions grounded in a keyword.
// Returns suggestions only; the user approves by creating tasks.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    const { keyword_id } = await req.json();
    if (!keyword_id) {
      return NextResponse.json({ data: null, error: 'keyword_id required' }, { status: 400 });
    }

    const { data: keyword } = await ctx.supabase
      .from('keywords')
      .select('id, title, definition, explanation, rules, examples')
      .eq('id', keyword_id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (!keyword) {
      return NextResponse.json({ data: null, error: 'Keyword not found' }, { status: 404 });
    }

    const { data: relations } = await ctx.supabase
      .from('keyword_relations')
      .select('relation_type, from_keyword:keywords!from_keyword_id(title), to_keyword:keywords!to_keyword_id(title)')
      .eq('organization_id', ctx.org.id)
      .or(`from_keyword_id.eq.${keyword_id},to_keyword_id.eq.${keyword_id}`)
      .in('relation_type', ['requires', 'depends-on', 'precedes', 'succeeds', 'blocks', 'validated-by', 'approves'])
      .limit(15);

    const provider = getProvider();
    const raw = await provider.chat(
      [
        {
          role: 'system',
          content:
            'You create an actionable checklist for a business concept, grounded ONLY in the provided definition, rules, and process relations. Do not invent company-specific facts. ' +
            'Return ONLY JSON: {"checklist": [{"title": "short imperative step", "description": "1 sentence", "priority": "low"|"medium"|"high"}], max 8 items}',
        },
        {
          role: 'user',
          content: JSON.stringify({
            concept: keyword.title,
            definition: keyword.definition,
            explanation: keyword.explanation,
            business_rules: keyword.rules,
            process_relations: (relations ?? []).map(
              (r: any) => `${r.from_keyword?.title} ${r.relation_type} ${r.to_keyword?.title}`
            ),
          }),
        },
      ],
      { tier: 'strong', json: true, temperature: 0.3, maxTokens: 800 }
    );

    let checklist: Array<{ title: string; description: string; priority: string }> = [];
    try {
      const parsed = JSON.parse(raw);
      checklist = Array.isArray(parsed.checklist)
        ? parsed.checklist
            .filter((item: any) => typeof item?.title === 'string' && item.title.trim())
            .slice(0, 8)
            .map((item: any) => ({
              title: String(item.title).slice(0, 200),
              description: String(item.description ?? '').slice(0, 400),
              priority: ['low', 'medium', 'high'].includes(item.priority) ? item.priority : 'medium',
            }))
        : [];
    } catch {
      return NextResponse.json(
        { data: null, error: 'AI returned an unparseable checklist. Try again.' },
        { status: 502 }
      );
    }

    await audit(ctx, 'ai.generate_checklist', { type: 'keyword', id: keyword_id }, {
      items: checklist.length,
    });

    return NextResponse.json({
      data: { keyword: { id: keyword.id, title: keyword.title }, checklist },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to generate checklist');
  }
}
