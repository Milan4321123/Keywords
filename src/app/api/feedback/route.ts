import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { recompileGuidance } from '@/lib/ai/skills';

export const runtime = 'nodejs';

const TABLE_MISSING =
  'Feedback-Tabelle fehlt — Migration 0007 (supabase/migrations/0007_ai_feedback.sql) im SQL-Editor ausführen · Feedback table missing, run migration 0007';

// POST /api/feedback — record human feedback on an AI answer.
// Thumbs-down with a correction immediately updates the learned-guidance
// context; every row accumulates into the fine-tuning dataset.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    const body = await req.json();

    const rating = body.rating === 1 || body.rating === -1 ? body.rating : null;
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 4000) : '';
    const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, 8000) : '';
    const correction =
      typeof body.correction === 'string' && body.correction.trim()
        ? body.correction.trim().slice(0, 4000)
        : null;

    if (!rating || !question || !answer) {
      return NextResponse.json(
        { data: null, error: 'rating (+1/-1), question and answer are required' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('ai_feedback')
      .insert({
        organization_id: ctx.org.id,
        user_id: ctx.user.id,
        question,
        answer,
        rating,
        correction,
        context_keyword_ids: Array.isArray(body.context_keyword_ids)
          ? body.context_keyword_ids.slice(0, 20)
          : [],
        model: typeof body.model === 'string' ? body.model.slice(0, 100) : null,
      })
      .select('id')
      .single();

    if (error) {
      if ((error as any).code === '42P01') {
        return NextResponse.json({ data: null, error: TABLE_MISSING }, { status: 503 });
      }
      throw error;
    }

    // Corrections steer the very next answer — no retraining needed.
    if (rating === -1 && correction) {
      await recompileGuidance(ctx).catch((e) => console.error('Guidance recompile failed:', e));
    }

    await audit(ctx, 'ai.feedback', { type: 'ai_feedback', id: data.id }, { rating, corrected: Boolean(correction) });

    return NextResponse.json({ data: { id: data.id }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to record feedback');
  }
}
