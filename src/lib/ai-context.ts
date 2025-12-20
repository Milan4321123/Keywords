import { Keyword, KeywordRelation, Asset, Chunk } from '@/types';

/**
 * Build context for AI from keywords, relations, and documents
 */
export function buildAIContext(
  keywords: Keyword[],
  relations: KeywordRelation[],
  chunks: Array<Chunk & { similarity: number }>
): string {
  const parts: string[] = [];

  // Add keyword definitions
  if (keywords.length > 0) {
    parts.push('## Company Ontology (Definitions)\n');
    for (const kw of keywords) {
      parts.push(`### ${kw.title}`);
      if (kw.definition) {
        parts.push(`**Definition:** ${kw.definition}`);
      }
      if (kw.explanation) {
        parts.push(`**Explanation:** ${kw.explanation}`);
      }
      if (kw.examples && kw.examples.length > 0) {
        parts.push(`**Examples:** ${kw.examples.join(', ')}`);
      }
      if (kw.rules && kw.rules.length > 0) {
        parts.push(`**Rules:** ${kw.rules.join('; ')}`);
      }
      parts.push('');
    }
  }

  // Add relations
  if (relations.length > 0) {
    parts.push('## Relationships\n');
    for (const rel of relations) {
      const fromTitle = rel.from_keyword?.title || rel.from_keyword_id;
      const toTitle = rel.to_keyword?.title || rel.to_keyword_id;
      parts.push(`- ${fromTitle} **${rel.relation_type}** ${toTitle}${rel.note ? ` (${rel.note})` : ''}`);
    }
    parts.push('');
  }

  // Add relevant document chunks
  if (chunks.length > 0) {
    parts.push('## Relevant Documents\n');
    for (const chunk of chunks) {
      const relevance = Math.round(chunk.similarity * 100);
      parts.push(`### [Relevance: ${relevance}%]`);
      parts.push(chunk.chunk_text);
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * System prompt for the AI assistant
 */
export function getSystemPrompt(companyName: string = 'the company'): string {
  return `You are an intelligent assistant for ${companyName}'s knowledge base. 

Your role is to:
1. Answer questions using the company's ontology (keyword definitions, explanations, and rules)
2. Reference relationships between concepts when relevant
3. Use evidence from uploaded documents to support your answers
4. Be precise and cite your sources when possible

Guidelines:
- If information comes from the ontology, mention the keyword
- If information comes from a document, indicate it's from company documents
- If you don't have enough information, say so clearly
- Maintain consistency with the company's defined terminology
- When discussing processes, respect the defined relationships (requires, depends-on, etc.)

Always prioritize accuracy over completeness. It's better to admit uncertainty than to make up information.`;
}

/**
 * Build a follow-up question to gather more context
 */
export function buildClarificationPrompt(
  question: string,
  availableKeywords: string[]
): string {
  return `The user asked: "${question}"

To provide a better answer, which of these topics would be most relevant?
${availableKeywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

Respond with the numbers of relevant topics, or 'all' if the question is broad.`;
}

/**
 * Extract potential keywords from a question
 */
export function extractPotentialKeywords(question: string, keywords: Keyword[]): Keyword[] {
  const questionLower = question.toLowerCase();
  
  return keywords.filter(kw => {
    // Check title
    if (questionLower.includes(kw.title.toLowerCase())) return true;
    
    // Check synonyms
    if (kw.synonyms?.some(syn => questionLower.includes(syn.toLowerCase()))) return true;
    
    // Check multilingual labels
    if (kw.labels_json) {
      for (const label of Object.values(kw.labels_json)) {
        if (questionLower.includes(label.toLowerCase())) return true;
      }
    }
    
    return false;
  });
}

/**
 * Rank and filter chunks by relevance
 */
export function rankChunks(
  chunks: Array<Chunk & { similarity: number }>,
  options: { minSimilarity?: number; maxChunks?: number } = {}
): Array<Chunk & { similarity: number }> {
  const { minSimilarity = 0.7, maxChunks = 10 } = options;
  
  return chunks
    .filter(c => c.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxChunks);
}

/**
 * Deduplicate chunks that are too similar
 */
export function deduplicateChunks(
  chunks: Array<Chunk & { similarity: number }>,
  overlapThreshold: number = 0.5
): Array<Chunk & { similarity: number }> {
  const result: Array<Chunk & { similarity: number }> = [];
  
  for (const chunk of chunks) {
    const isDuplicate = result.some(existing => {
      const overlap = calculateTextOverlap(existing.chunk_text, chunk.chunk_text);
      return overlap > overlapThreshold;
    });
    
    if (!isDuplicate) {
      result.push(chunk);
    }
  }
  
  return result;
}

/**
 * Simple text overlap calculation
 */
function calculateTextOverlap(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }
  
  return overlap / Math.max(words1.size, words2.size);
}
