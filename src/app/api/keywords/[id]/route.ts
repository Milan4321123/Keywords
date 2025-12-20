import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/keywords/[id] - Get a single keyword with relations and assets
export async function GET(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const supabase = createServerClient();
    const { id } = await params;

    // Get keyword
    const { data: keyword, error: keywordError } = await supabase
      .from('keywords')
      .select('*')
      .eq('id', id)
      .single();

    if (keywordError) throw keywordError;

    // Get relations (outgoing)
    const { data: outgoingRelations } = await supabase
      .from('keyword_relations')
      .select('*, to_keyword:keywords!to_keyword_id(id, title)')
      .eq('from_keyword_id', id);

    // Get relations (incoming)
    const { data: incomingRelations } = await supabase
      .from('keyword_relations')
      .select('*, from_keyword:keywords!from_keyword_id(id, title)')
      .eq('to_keyword_id', id);

    // Get assets
    const { data: keywordAssets } = await supabase
      .from('keyword_assets')
      .select('*, asset:assets(*)')
      .eq('keyword_id', id);

    return NextResponse.json({
      data: {
        ...keyword,
        relations: [...(outgoingRelations || []), ...(incomingRelations || [])],
        assets: keywordAssets?.map((ka) => ka.asset) || [],
      },
      error: null,
    });
  } catch (error) {
    console.error('Error fetching keyword:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to fetch keyword' },
      { status: 500 }
    );
  }
}

// PUT /api/keywords/[id] - Update a keyword
export async function PUT(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const supabase = createServerClient();
    const { id } = await params;
    const body = await req.json();

    // Update slug if title changed
    const updates: any = { ...body };
    if (body.title) {
      updates.slug = body.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    const { data: keyword, error } = await supabase
      .from('keywords')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data: keyword, error: null });
  } catch (error) {
    console.error('Error updating keyword:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to update keyword' },
      { status: 500 }
    );
  }
}

// DELETE /api/keywords/[id] - Delete a keyword
export async function DELETE(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const supabase = createServerClient();
    const { id } = await params;

    const { error } = await supabase
      .from('keywords')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to delete keyword' },
      { status: 500 }
    );
  }
}
