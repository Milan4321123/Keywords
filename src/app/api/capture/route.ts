import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit, accessibleLevels } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { getCaptureFormsForKeyword, validateAndCoerce } from '@/lib/capture';
import { CaptureField } from '@/lib/capture-types';

// GET /api/capture?keyword_id= — capture forms derived from the keyword's datasets
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const keywordId = new URL(req.url).searchParams.get('keyword_id');
    if (!keywordId) {
      return NextResponse.json({ data: null, error: 'keyword_id required' }, { status: 400 });
    }

    // Keyword must exist and be visible at the caller's access tier
    const { data: keyword } = await ctx.supabase
      .from('keywords')
      .select('id')
      .eq('id', keywordId)
      .eq('organization_id', ctx.org.id)
      .in('access_level', accessibleLevels(ctx.role))
      .maybeSingle();
    if (!keyword) {
      return NextResponse.json({ data: { forms: [] }, error: null });
    }

    const forms = await getCaptureFormsForKeyword(ctx.supabase, ctx.org.id, keywordId);
    return NextResponse.json({ data: { forms }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to load capture forms');
  }
}

// POST /api/capture — insert one structured record into a dataset table
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const body = await req.json();
    const tableId: string | undefined = body.dataset_table_id;
    const values: Record<string, unknown> = body.values ?? {};
    const evidenceAssetId: string | null =
      typeof body.evidence_asset_id === 'string' ? body.evidence_asset_id : null;

    if (!tableId) {
      return NextResponse.json({ data: null, error: 'dataset_table_id required' }, { status: 400 });
    }

    // Table → dataset → org + keyword access check
    const { data: table } = await ctx.supabase
      .from('dataset_tables')
      .select('id, name, row_count, dataset:datasets!inner(id, title, organization_id, keyword_id), columns:dataset_columns(*)')
      .eq('id', tableId)
      .eq('dataset.organization_id', ctx.org.id)
      .maybeSingle();
    if (!table) {
      return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 });
    }
    const dataset = (table as any).dataset;
    if (dataset?.keyword_id) {
      const { data: kw } = await ctx.supabase
        .from('keywords')
        .select('id')
        .eq('id', dataset.keyword_id)
        .in('access_level', accessibleLevels(ctx.role))
        .maybeSingle();
      if (!kw) {
        return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 });
      }
    }

    // Optional evidence must be an asset in this org; store a stable reference
    let evidenceReference: string | null = null;
    if (evidenceAssetId) {
      const { data: asset } = await ctx.supabase
        .from('assets')
        .select('id, file_name')
        .eq('id', evidenceAssetId)
        .eq('organization_id', ctx.org.id)
        .maybeSingle();
      if (asset) evidenceReference = `asset:${asset.id}`;
    }

    // Rebuild field defs from the live columns (never trust client field metadata)
    const fields: CaptureField[] = ((table as any).columns ?? []).map((col: any) => {
      const rules = col.validation_rules ?? {};
      return {
        field: col.normalized_name,
        label: col.name,
        data_type: col.data_type,
        semantic: col.semantic_name ?? null,
        required: Boolean(col.is_required),
        description: col.description ?? null,
        options: null,
        min: typeof rules.min === 'number' ? rules.min : null,
        max: typeof rules.max === 'number' ? rules.max : null,
        auto: null as any,
      };
    });
    // Recompute autos with the same rules used for form generation:
    for (const f of fields) {
      const s = f.semantic;
      f.auto =
        s === 'business_date' ? 'today'
        : s === 'weekday' ? 'weekday'
        : s === 'employee_id' ? 'user'
        : s === 'evidence_reference' ? 'evidence'
        : s && /timestamp/.test(s) && s !== 'verification_timestamp' ? 'now'
        : null;
    }

    const result = validateAndCoerce(fields, values, {
      userEmail: ctx.user.email,
      evidenceReference,
    });
    if (!result.ok) {
      return NextResponse.json({ data: null, error: result.errors.join(' · ') }, { status: 400 });
    }

    // Next row_index with a small retry window for concurrent captures
    let inserted: any = null;
    let lastError: any = null;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const { data: maxRow } = await ctx.supabase
        .from('dataset_rows')
        .select('row_index')
        .eq('dataset_table_id', tableId)
        .order('row_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextIndex = (maxRow?.row_index ?? 0) + 1 + attempt;

      const { data, error } = await ctx.supabase
        .from('dataset_rows')
        .insert({
          dataset_table_id: tableId,
          row_index: nextIndex,
          data: result.data,
          source_json: {
            source: 'capture-form',
            captured_by: ctx.user.email,
            captured_at: new Date().toISOString(),
            evidence_asset_id: evidenceAssetId,
          },
        })
        .select('id, row_index, data')
        .maybeSingle();
      if (data) inserted = data;
      else lastError = error;
    }
    if (!inserted) throw lastError ?? new Error('Failed to insert row');

    // Keep the row counter roughly accurate for schema displays
    const { count } = await ctx.supabase
      .from('dataset_rows')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_table_id', tableId);
    if (typeof count === 'number') {
      await ctx.supabase.from('dataset_tables').update({ row_count: count }).eq('id', tableId);
    }

    await audit(ctx, 'data.capture', { type: 'dataset_row', id: inserted.id }, {
      table: (table as any).name,
      dataset: dataset?.title,
      evidence: Boolean(evidenceAssetId),
    });

    return NextResponse.json({ data: { row: inserted }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to save record');
  }
}
