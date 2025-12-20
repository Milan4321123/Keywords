import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/relations - Get all relations (optionally filtered)
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(req.url);
    const keywordId = searchParams.get('keyword_id');

    let query = supabase
      .from('keyword_relations')
      .select(`
        *,
        from_keyword:keywords!from_keyword_id(id, title, slug),
        to_keyword:keywords!to_keyword_id(id, title, slug)
      `);

    if (keywordId) {
      query = query.or(`from_keyword_id.eq.${keywordId},to_keyword_id.eq.${keywordId}`);
    }

    const { data: relations, error } = await query;

    if (error) throw error;

    return NextResponse.json({ data: relations, error: null });
  } catch (error) {
    console.error('Error fetching relations:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to fetch relations' },
      { status: 500 }
    );
  }
}

// POST /api/relations - Create a new relation
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();

    const { data: relation, error } = await supabase
      .from('keyword_relations')
      .insert({
        from_keyword_id: body.from_keyword_id,
        relation_type: body.relation_type,
        to_keyword_id: body.to_keyword_id,
        note: body.note || null,
        strength: body.strength || 5,
        bidirectional: body.bidirectional || false,
      })
      .select(`
        *,
        from_keyword:keywords!from_keyword_id(id, title),
        to_keyword:keywords!to_keyword_id(id, title)
      `)
      .single();

    if (error) throw error;

    // If bidirectional, create the reverse relation too
    if (body.bidirectional) {
      await supabase.from('keyword_relations').insert({
        from_keyword_id: body.to_keyword_id,
        relation_type: body.relation_type,
        to_keyword_id: body.from_keyword_id,
        note: body.note || null,
        strength: body.strength || 5,
        bidirectional: true,
      });
    }

    return NextResponse.json({ data: relation, error: null });
  } catch (error) {
    console.error('Error creating relation:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to create relation' },
      { status: 500 }
    );
  }
}

// DELETE /api/relations - Delete a relation by ID
export async function DELETE(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { data: null, error: 'Relation ID required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('keyword_relations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting relation:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to delete relation' },
      { status: 500 }
    );
  }
}
