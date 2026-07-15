import { NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readCachedWorldModel, getWorldModel } from '@/lib/ai/skills';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/insights/world-model — cached compiled world model (no LLM call)
export async function GET() {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const model = await readCachedWorldModel(ctx);
    return NextResponse.json({ data: model, error: null });
  } catch (error) {
    return apiError(error, 'Failed to load world model');
  }
}

// POST /api/insights/world-model — force re-compilation from the current ontology
export async function POST() {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    enforceRateLimit('ai', ctx.user.id);
    const model = await getWorldModel(ctx, { refresh: true });
    if (!model) {
      return NextResponse.json(
        { data: null, error: 'Noch keine Begriffe vorhanden · No keywords yet' },
        { status: 400 }
      );
    }
    await audit(ctx, 'ai.world_model.compile', { type: 'organization', id: ctx.org.id }, {
      keywords: model.stats.keywords,
    });
    return NextResponse.json({ data: model, error: null });
  } catch (error) {
    return apiError(error, 'Failed to compile world model');
  }
}
