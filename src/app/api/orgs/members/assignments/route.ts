import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

// GET /api/orgs/members/assignments?member_id= — keywords assigned to a member
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('manage_members');
    const memberId = new URL(req.url).searchParams.get('member_id');
    if (!memberId) {
      return NextResponse.json({ data: null, error: 'member_id required' }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from('keyword_assignments')
      .select('id, keyword_id, keyword:keywords(id, title)')
      .eq('organization_id', ctx.org.id)
      .eq('member_id', memberId);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to load assignments');
  }
}

// POST /api/orgs/members/assignments — { member_id, keyword_id }
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('manage_members');
    const { member_id, keyword_id } = await req.json();
    if (!member_id || !keyword_id) {
      return NextResponse.json({ data: null, error: 'member_id and keyword_id required' }, { status: 400 });
    }

    const [{ data: member }, { data: keyword }] = await Promise.all([
      ctx.supabase
        .from('organization_members')
        .select('id')
        .eq('id', member_id)
        .eq('organization_id', ctx.org.id)
        .maybeSingle(),
      ctx.supabase
        .from('keywords')
        .select('id, title')
        .eq('id', keyword_id)
        .eq('organization_id', ctx.org.id)
        .maybeSingle(),
    ]);
    if (!member || !keyword) {
      return NextResponse.json({ data: null, error: 'Member or keyword not found' }, { status: 404 });
    }

    const { data: assignment, error } = await ctx.supabase
      .from('keyword_assignments')
      .upsert(
        { organization_id: ctx.org.id, member_id, keyword_id },
        { onConflict: 'keyword_id,member_id', ignoreDuplicates: true }
      )
      .select('id, keyword_id')
      .maybeSingle();
    if (error) throw error;

    await audit(ctx, 'member.assign_keyword', { type: 'member', id: member_id }, {
      keyword: keyword.title,
    });
    return NextResponse.json({ data: assignment ?? { assigned: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to assign keyword');
  }
}

// DELETE /api/orgs/members/assignments?member_id=&keyword_id=
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('manage_members');
    const url = new URL(req.url);
    const memberId = url.searchParams.get('member_id');
    const keywordId = url.searchParams.get('keyword_id');
    if (!memberId || !keywordId) {
      return NextResponse.json({ data: null, error: 'member_id and keyword_id required' }, { status: 400 });
    }
    const { error } = await ctx.supabase
      .from('keyword_assignments')
      .delete()
      .eq('organization_id', ctx.org.id)
      .eq('member_id', memberId)
      .eq('keyword_id', keywordId);
    if (error) throw error;

    await audit(ctx, 'member.unassign_keyword', { type: 'member', id: memberId }, { keyword_id: keywordId });
    return NextResponse.json({ data: { removed: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to remove assignment');
  }
}
