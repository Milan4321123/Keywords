import { NextRequest, NextResponse } from 'next/server';
import { mapSupabaseApiError } from '@/lib/supabase-errors';
import { requireOrgContext, audit, authErrorResponse } from '@/lib/auth';
import { getProvider } from '@/lib/ai/provider';
import { KeywordSuggestion, GenerateKeywordsResponse, Keyword } from '@/types';

const GENERATE_KEYWORDS_PROMPT = `You are an expert knowledge architect. Your task is to generate a structured keyword/concept hierarchy for a company knowledge base.

Given a topic or concept, generate relevant keywords with:
1. A clear, concise title (2-4 words)
2. A brief definition (1-2 sentences)
3. Logical sub-keywords where appropriate
4. Examples and synonyms if relevant

Guidelines:
- Keep definitions precise and professional
- Organize hierarchically (parent -> children)
- Include practical business terminology
- Consider relationships between concepts
- Avoid redundancy

Return ONLY valid JSON in this exact format:
{
  "keywords": [
    {
      "title": "Main Concept",
      "definition": "Brief definition here",
      "examples": ["example1", "example2"],
      "synonyms": ["synonym1"],
      "children": [
        {
          "title": "Sub Concept",
          "definition": "Sub concept definition",
          "examples": [],
          "synonyms": [],
          "children": []
        }
      ]
    }
  ],
  "explanation": "Brief explanation of the suggested structure"
}`;

// POST /api/generate-keywords - Generate keyword suggestions using AI
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    const body = await req.json();
    const { topic, context, depth = 2, count = 5 } = body;

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic is required' },
        { status: 400 }
      );
    }

    // Get existing keywords for context
    const { data: existingKeywords } = await ctx.supabase
      .from('keywords')
      .select('title, definition')
      .eq('organization_id', ctx.org.id)
      .limit(20);

    const existingContext = existingKeywords?.length 
      ? `\n\nExisting keywords in the system (avoid duplicates):\n${existingKeywords.map(k => `- ${k.title}`).join('\n')}`
      : '';

    const userPrompt = `Generate a keyword hierarchy for: "${topic}"
${context ? `\nAdditional context: ${context}` : ''}
${existingContext}

Requirements:
- Generate approximately ${count} main keywords
- Include up to ${depth} levels of depth (sub-keywords)
- Focus on practical, business-relevant concepts
- Each keyword should have a clear definition`;

    const messages = [
      { role: 'system' as const, content: GENERATE_KEYWORDS_PROMPT },
      { role: 'user' as const, content: userPrompt },
    ];

    const response = await getProvider().chat(messages, {
      tier: 'strong',
      json: true,
      temperature: 0.7,
      maxTokens: 2000,
    });

    // Parse the JSON response
    let parsed: GenerateKeywordsResponse;
    try {
      // Extract JSON from the response (handle markdown code blocks)
      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      parsed = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response:', response);
      return NextResponse.json(
        { error: 'Failed to parse AI suggestions. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: authErr.status });
    }
    console.error('Error generating keywords:', error);
    const mapped = mapSupabaseApiError(error, 'Failed to generate keyword suggestions');
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status }
    );
  }
}

// POST /api/generate-keywords/create - Create the suggested keywords
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const supabase = ctx.supabase;
    const body = await req.json();
    const { keywords, parent_id = null } = body as { keywords: KeywordSuggestion[], parent_id?: string | null };

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json(
        { error: 'Keywords array is required' },
        { status: 400 }
      );
    }

    if (parent_id) {
      const { data: parent } = await supabase
        .from('keywords')
        .select('id')
        .eq('id', parent_id)
        .eq('organization_id', ctx.org.id)
        .maybeSingle();
      if (!parent) {
        return NextResponse.json({ error: 'Parent keyword not found' }, { status: 400 });
      }
    }

    const createdKeywords: Keyword[] = [];

    // Recursive function to create keywords with children
    async function createKeywordWithChildren(
      kw: KeywordSuggestion, 
      parentId: string | null
    ): Promise<Keyword | null> {
      const slug = kw.title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || `keyword-${Date.now()}`;

      const { data: created, error } = await supabase
        .from('keywords')
        .insert({
          organization_id: ctx.org.id,
          title: kw.title,
          slug: slug,
          definition: kw.definition,
          parent_id: parentId,
          examples: kw.examples || [],
          synonyms: kw.synonyms || [],
          labels_json: {},
          rules: [],
          sort_order: 0,
          created_by: ctx.user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating keyword:', kw.title, error);
        return null;
      }

      createdKeywords.push(created);

      // Create children recursively
      if (kw.children && kw.children.length > 0) {
        for (const child of kw.children) {
          await createKeywordWithChildren(child, created.id);
        }
      }

      return created;
    }

    // Create all top-level keywords
    for (const kw of keywords) {
      await createKeywordWithChildren(kw, parent_id);
    }

    await audit(ctx, 'keyword.bulk_create', { type: 'keyword' }, {
      count: createdKeywords.length,
      source: 'ai_generation',
    });

    return NextResponse.json({
      data: createdKeywords,
      error: null,
      message: `Successfully created ${createdKeywords.length} keywords`
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: authErr.status });
    }
    console.error('Error creating keywords:', error);
    const mapped = mapSupabaseApiError(error, 'Failed to create keywords');
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status }
    );
  }
}
