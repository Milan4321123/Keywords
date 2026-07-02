import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

function csvEscape(value: unknown): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

const ARRAY_JOIN = ' | ';

// GET /api/keywords/export?format=json|csv - Export the keyword ontology
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('export_data');
    const { searchParams } = new URL(req.url);
    const format = searchParams.get('format') === 'csv' ? 'csv' : 'json';

    const { data: keywords, error } = await ctx.supabase
      .from('keywords')
      .select('*')
      .eq('organization_id', ctx.org.id)
      .order('sort_order')
      .order('title');
    if (error) throw error;

    const slugById = new Map((keywords ?? []).map((k) => [k.id, k.slug] as const));
    const rows = (keywords ?? []).map((k) => ({
      title: k.title,
      slug: k.slug,
      parent_slug: k.parent_id ? slugById.get(k.parent_id) ?? '' : '',
      keyword_type: k.keyword_type ?? 'concept',
      status: k.status ?? 'active',
      definition: k.definition ?? '',
      explanation: k.explanation ?? '',
      examples: k.examples ?? [],
      synonyms: k.synonyms ?? [],
      rules: k.rules ?? [],
      labels_json: k.labels_json ?? {},
      completeness_score: k.completeness_score ?? 0,
    }));

    await audit(ctx, 'data.export', { type: 'keyword' }, { format, count: rows.length });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      return new NextResponse(JSON.stringify({ organization: ctx.org.slug, exported_at: new Date().toISOString(), keywords: rows }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="keywords-${ctx.org.slug}-${stamp}.json"`,
        },
      });
    }

    const header = [
      'title', 'slug', 'parent_slug', 'keyword_type', 'status',
      'definition', 'explanation', 'examples', 'synonyms', 'rules',
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.title, r.slug, r.parent_slug, r.keyword_type, r.status,
          r.definition, r.explanation,
          r.examples.join(ARRAY_JOIN), r.synonyms.join(ARRAY_JOIN), r.rules.join(ARRAY_JOIN),
        ]
          .map(csvEscape)
          .join(',')
      ),
    ];

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="keywords-${ctx.org.slug}-${stamp}.csv"`,
      },
    });
  } catch (error) {
    return apiError(error, 'Failed to export keywords');
  }
}
