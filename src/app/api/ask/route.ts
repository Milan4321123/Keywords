import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createEmbedding, rerankChunks } from '@/lib/openai';
import { getProvider } from '@/lib/ai/provider';
import { buildAIContext, getSystemPrompt, extractPotentialKeywords, rankChunks } from '@/lib/ai-context';
import { getDependencyContext, edgesToRelations } from '@/lib/ontology/graph';
import { readCachedWorldModel, readGuidance } from '@/lib/ai/skills';
import { Keyword, KeywordRelation, Chunk, AskAIResponse } from '@/types';

type ChunkWithSimilarity = Chunk & { similarity: number };

// POST /api/ask - Ask AI a question using the knowledge base
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    enforceRateLimit('ai', ctx.user.id);
    const supabase = ctx.supabase;
    const body = await req.json();

    const {
      question,
      context_keyword_ids = [],
      include_relations = true,
      include_assets = true,
    } = body;

    // Retrieval scope always comes from the verified session, never the payload.
    const org_id = ctx.org.id;

    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    // 1. Get all keywords for potential matching
    const { data: allKeywords } = await supabase
      .from('keywords')
      .select('*')
      .eq('organization_id', ctx.org.id);

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
        .eq('organization_id', ctx.org.id)
        .in('id', relevantKeywordIds);
      relevantKeywords = keywords || [];
    } else {
      // If no specific keywords, include top-level ones
      const { data: rootKeywords } = await supabase
        .from('keywords')
        .select('*')
        .eq('organization_id', ctx.org.id)
        .is('parent_id', null)
        .limit(10);
      relevantKeywords = rootKeywords || [];
    }

    // 5. Relation-aware expansion: follow the dependency graph from the matched
    // keywords (depth-limited, relevance-scored) so the AI sees required
    // dependencies, not just the directly mentioned concepts.
    let relations: KeywordRelation[] = [];
    const relevanceByKeywordId = new Map<string, number>(
      relevantKeywordIds.map((kid: string) => [kid, 1])
    );
    let retrievalKeywordIds: string[] = relevantKeywordIds;

    if (relevantKeywordIds.length > 0) {
      const depContext = await getDependencyContext(supabase, ctx.org.id, relevantKeywordIds, {
        maxDepth: 2,
        maxNodes: 15,
        intent: 'general',
      });

      const known = new Set(relevantKeywords.map((k) => k.id));
      for (const node of depContext.nodes) {
        relevanceByKeywordId.set(node.keyword.id, node.relevance);
        if (!known.has(node.keyword.id)) {
          relevantKeywords.push(node.keyword);
          known.add(node.keyword.id);
        }
      }

      if (include_relations) {
        relations = edgesToRelations(depContext.edges);
      }

      // Widen document retrieval to the dependency neighbourhood
      retrievalKeywordIds = Array.from(known);
    }

    // 6. Search for relevant document chunks
    let relevantChunks: ChunkWithSimilarity[] = [];
    if (include_assets) {
      try {
        // Create embedding for the question
        const questionEmbedding = await createEmbedding(question);

        const orgId: string = org_id;

        const isLikelyMissingArg = (error: unknown, argName: string) => {
          const msg = String((error as any)?.message ?? error ?? '');
          return msg.includes(argName) && (msg.includes('parameter') || msg.includes('argument') || msg.includes('named'));
        };

        const tryHybrid = async (filterKeywordIds: string[] | null): Promise<ChunkWithSimilarity[]> => {
          const argsBase = {
            query_text: question,
            query_embedding: questionEmbedding,
            match_threshold: 0.65,
            match_count: 25,
            filter_keyword_ids: filterKeywordIds,
            weight_vector: 0.7,
            weight_text: 0.3,
          };

          const withScope = orgId ? { ...argsBase, filter_org_id: orgId } : argsBase;

          const { data, error } = await supabase.rpc('match_chunks_hybrid', withScope);
          if (error) {
            // Backward compat: DB function not yet migrated to accept filter_org_id
            if (orgId && isLikelyMissingArg(error, 'filter_org_id')) {
              const retry = await supabase.rpc('match_chunks_hybrid', argsBase);
              if (retry.error) throw retry.error;
              return (retry.data ?? []) as ChunkWithSimilarity[];
            }
            throw error;
          }
          return (data ?? []) as ChunkWithSimilarity[];
        };

        const tryVectorOnly = async (filterKeywordIds: string[] | null): Promise<ChunkWithSimilarity[]> => {
          const argsBase = {
            query_embedding: questionEmbedding,
            match_threshold: 0.7,
            match_count: 25,
            filter_keyword_ids: filterKeywordIds,
          };

          const withScope = orgId ? { ...argsBase, filter_org_id: orgId } : argsBase;

          const { data, error } = await supabase.rpc('match_chunks', withScope);
          if (error) {
            // Backward compat: DB function not yet migrated to accept filter_org_id
            if (orgId && isLikelyMissingArg(error, 'filter_org_id')) {
              const retry = await supabase.rpc('match_chunks', argsBase);
              if (retry.error) throw retry.error;
              return (retry.data ?? []) as ChunkWithSimilarity[];
            }
            throw error;
          }
          return (data ?? []) as ChunkWithSimilarity[];
        };

        // Prefer hybrid retrieval (vector + full-text) if the RPC exists.
        // If it's not deployed in Supabase yet, fall back to vector-only search.
        let candidates: ChunkWithSimilarity[] = [];
        try {
          candidates = await tryHybrid(retrievalKeywordIds.length > 0 ? retrievalKeywordIds : null);
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? '');
          const likelyMissingRpc = msg.includes('match_chunks_hybrid') || msg.includes('PGRST') || msg.includes('not found');
          if (!likelyMissingRpc) throw e;
          candidates = await tryVectorOnly(retrievalKeywordIds.length > 0 ? retrievalKeywordIds : null);
        }

        relevantChunks = rankChunks(candidates, { minSimilarity: 0.6, maxChunks: 25 });

        // Fallback: if keyword-scoped retrieval yields nothing, try a small global retrieval.
        if (relevantChunks.length === 0 && retrievalKeywordIds.length > 0) {
          let globalCandidates: ChunkWithSimilarity[] = [];
          try {
            globalCandidates = await tryHybrid(null);
          } catch {
            globalCandidates = await tryVectorOnly(null);
          }
          relevantChunks = rankChunks(globalCandidates, { minSimilarity: 0.7, maxChunks: 10 });
        }

        // Optional rerank: use a cheap LLM to pick the most useful chunks.
        if (relevantChunks.length > 0) {
          const originalSimilarityById = new Map(relevantChunks.map((c) => [c.id, c.similarity] as const));
          const rankings = await rerankChunks({
            question,
            chunks: relevantChunks.map((c) => ({ id: c.id, text: c.chunk_text })),
            topN: 10,
          });

          if (rankings.length > 0) {
            const scoreById = new Map(rankings.map((r) => [r.id, r.score] as const));
            const maxScore = Math.max(...rankings.map((r) => r.score));

            // If reranker couldn't produce meaningful scores, keep original similarity ordering.
            if (maxScore >= 0.05) {
            const picked = relevantChunks
              .filter((c) => scoreById.has(c.id))
              .map((c) => ({ ...c, similarity: scoreById.get(c.id) ?? (originalSimilarityById.get(c.id) ?? c.similarity) }))
              .sort((a, b) => (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0));

            if (picked.length > 0) {
              relevantChunks = picked;
            }
            }
          }
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

    // 8. Generate response using GPT, grounded on the compiled world model
    const systemPrompt = getSystemPrompt(ctx.org.name);

    let worldModelBlock = '';
    try {
      const [worldModel, guidance] = await Promise.all([readCachedWorldModel(ctx), readGuidance(ctx)]);
      if (worldModel?.markdown) {
        worldModelBlock = `## Organization World Model (compiled from the company ontology)\n${worldModel.markdown.slice(0, 3500)}\n\n`;
      }
      if (guidance) {
        worldModelBlock += `${guidance.slice(0, 2500)}\n\n`;
      }
    } catch (error) {
      console.error('World model unavailable:', error);
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'system' as const, content: `Here is the relevant context from the company knowledge base:\n\n${worldModelBlock}${context}` },
      { role: 'user' as const, content: question },
    ];

    const answer = await getProvider().chat(messages, {
      tier: 'strong',
      temperature: 0.7,
      maxTokens: 1500,
    });

    // 9. Compile sources
    const assetIdSet = new Set(relevantChunks.map((c) => c.asset_id).filter(Boolean) as string[]);
    const assetIds = Array.from(assetIdSet);
    const assetNameById = new Map<string, string>();
    if (assetIds.length > 0) {
      const { data: assets } = await supabase
        .from('assets')
        .select('id,file_name')
        .eq('organization_id', ctx.org.id)
        .in('id', assetIds);
      for (const a of assets ?? []) {
        if (a?.id && a?.file_name) assetNameById.set(a.id, a.file_name);
      }
    }

    const sources: AskAIResponse['sources'] = [
      ...relevantKeywords
        .filter((k) => Boolean(k.title && k.title.trim().length > 0))
        .map((k) => ({
        type: 'keyword' as const,
        id: k.id,
        title: k.title,
        relevance: relevanceByKeywordId.get(k.id) ?? 1,
      })),
      ...relevantChunks.slice(0, 5).map((c) => ({
        type: 'chunk' as const,
        id: c.id,
        title: (() => {
          const assetName = c.asset_id ? assetNameById.get(c.asset_id) : undefined;
          const idx = Number.isFinite(c.chunk_index) ? c.chunk_index + 1 : undefined;
          if (assetName && idx) return `${assetName} (chunk ${idx})`;
          if (assetName) return assetName;
          if (idx) return `Document chunk ${idx}`;
          return 'Document chunk';
        })(),
        relevance: c.similarity,
      })),
    ];

    await audit(ctx, 'ai.ask', { type: 'ai_question' }, {
      question: question.slice(0, 500),
      keywords_used: relevantKeywords.length,
      chunks_used: relevantChunks.length,
    });

    // 10. Return response
    const response: AskAIResponse = {
      answer,
      sources,
      suggested_keywords: mentionedKeywords.map((k) => k.title).filter((t) => Boolean(t && t.trim().length > 0)),
    };

    return NextResponse.json(response);
  } catch (error) {
    return apiError(error, 'Failed to process question');
  }
}
