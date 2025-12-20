import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { Keyword } from '@/types';

// GET /api/keywords - Get all keywords (tree structure)
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    
    const { data: keywords, error } = await supabase
      .from('keywords')
      .select('*')
      .order('sort_order')
      .order('title');

    if (error) throw error;

    return NextResponse.json({ data: keywords, error: null });
  } catch (error) {
    console.error('Error fetching keywords:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to fetch keywords' },
      { status: 500 }
    );
  }
}

// POST /api/keywords - Create a new keyword
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();

    // Validate title
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      return NextResponse.json(
        { data: null, error: 'Title is required' },
        { status: 400 }
      );
    }

    // Generate slug from title
    const slug = body.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `keyword-${Date.now()}`;

    const { data: keyword, error } = await supabase
      .from('keywords')
      .insert({
        title: body.title,
        slug: slug,
        parent_id: body.parent_id || null,
        definition: body.definition || null,
        explanation: body.explanation || null,
        examples: body.examples || [],
        synonyms: body.synonyms || [],
        labels_json: body.labels_json || {},
        rules: body.rules || [],
        icon: body.icon || null,
        color: body.color || null,
        sort_order: body.sort_order || 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data: keyword, error: null });
  } catch (error) {
    console.error('Error creating keyword:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to create keyword' },
      { status: 500 }
    );
  }
}
