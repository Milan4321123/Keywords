import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createEmbedding, chatCompletion } from '@/lib/openai';
import { buildAIContext, getSystemPrompt, extractPotentialKeywords, rankChunks } from '@/lib/ai-context';
import { Keyword, KeywordRelation, Chunk, AskAIResponse } from '@/types';

// POST /api/ask - Ask AI a question using the knowledge base
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();
    
    const {
      question,
      context_keyword_ids = [],
      include_relations = true,
      include_assets = true,
    } = body;

    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    // 1. Get all keywords for potential matching
    const { data: allKeywords } = await supabase
      .from('keywords')
      .select('*');

    // 2. Extract keywords mentioned in the question
    const mentionedKeywords = extractPotentialKeywords(question, allKeywords || []);
    
    // 3. Combine explicit context + mentioned keywords
    const relevantKeywordIds = [
      ...new Set([
        ...context_keyword_ids,
        ...mentionedKeywords.map((k) => k.id),
      ]),
    ];

    // 4. Get full keyword data for relevant keywords
    let relevantKeywords: Keyword[] = [];
    if (relevantKeywordIds.length > 0) {
      const { data: keywords } = await supabase
        .from('keywords')
        .select('*')
        .in('id', relevantKeywordIds);
      relevantKeywords = keywords || [];
    } else {
      // If no specific keywords, include top-level ones
      const { data: rootKeywords } = await supabase
        .from('keywords')
        .select('*')
        .is('parent_id', null)
        .limit(10);
      relevantKeywords = rootKeywords || [];
    }

    // 5. Get relations for relevant keywords
    let relations: KeywordRelation[] = [];
    if (include_relations && relevantKeywordIds.length > 0) {
      const { data: relData } = await supabase
        .from('keyword_relations')
        .select(`
          *,
          from_keyword:keywords!from_keyword_id(id, title),
          to_keyword:keywords!to_keyword_id(id, title)
        `)
        .or(
          relevantKeywordIds
            .map((id) => `from_keyword_id.eq.${id},to_keyword_id.eq.${id}`)
            .join(',')
        );
      relations = relData || [];
    }

    // 6. Search for relevant document chunks
    let relevantChunks: Array<Chunk & { similarity: number }> = [];
    if (include_assets) {
      try {
        // Create embedding for the question
        const questionEmbedding = await createEmbedding(question);
        
        // Search using the match_chunks function
        const { data: chunks } = await supabase.rpc('match_chunks', {
          query_embedding: questionEmbedding,
          match_threshold: 0.7,
          match_count: 10,
          filter_keyword_ids: relevantKeywordIds.length > 0 ? relevantKeywordIds : null,
        });
        
        relevantChunks = rankChunks(chunks || []);

        // Fallback: if keyword-scoped search yields nothing, try a small global search.
        if (relevantChunks.length === 0 && relevantKeywordIds.length > 0) {
          const { data: globalChunks } = await supabase.rpc('match_chunks', {
            query_embedding: questionEmbedding,
            match_threshold: 0.75,
            match_count: 5,
            filter_keyword_ids: null,
          });
          relevantChunks = rankChunks(globalChunks || [], { minSimilarity: 0.75, maxChunks: 5 });
        }
      } catch (embeddingError) {
        console.error('Embedding search error:', embeddingError);
        // Continue without document search
      }
    }

    // 7. Build context for the AI
    const context = buildAIContext(relevantKeywords, relations, relevantChunks, {
      maxKeywords: 20,
      maxChunks: 10,
      maxChunkChars: 1500,
      maxFieldChars: 800,
    });

    // 8. Generate response using GPT
    const systemPrompt = getSystemPrompt('Your Company');
    
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'system' as const, content: `Here is the relevant context from the company knowledge base:\n\n${context}` },
      { role: 'user' as const, content: question },
    ];

    const answer = await chatCompletion(messages, {
      temperature: 0.7,
      max_tokens: 1500,
    });

    // 9. Compile sources
    const sources: AskAIResponse['sources'] = [
      ...relevantKeywords.map((k) => ({
        type: 'keyword' as const,
        id: k.id,
        title: k.title,
        relevance: 1,
      })),
      ...relevantChunks.slice(0, 5).map((c) => ({
        type: 'chunk' as const,
        id: c.id,
        title: `Document chunk ${c.chunk_index + 1}`,
        relevance: c.similarity,
      })),
    ];

    // 10. Return response
    const response: AskAIResponse = {
      answer,
      sources,
      suggested_keywords: mentionedKeywords.map((k) => k.title),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in AI ask:', error);
    return NextResponse.json(
      { error: 'Failed to process question' },
      { status: 500 }
    );
  }
}
