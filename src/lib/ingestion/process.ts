import * as XLSX from 'xlsx';
import pdf from 'pdf-parse';
import { createServiceClient } from '@/lib/supabase/server';
import { createEmbedding, openai } from '@/lib/openai';

const MAX_TEXT_CHARS = 200_000;
const MAX_ENRICH_CHARS = 6_000;

export interface ProcessResult {
  status: 'processed' | 'failed';
  extractedChars: number;
  chunks: number;
  language: string | null;
  summary: string | null;
  suggestedKeywordIds: string[];
  error?: string;
}

/** Simple paragraph-based chunking. */
export function chunkText(text: string, maxChunkSize = 1000): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize) {
      if (current) chunks.push(current.trim());
      current = para;
    } else {
      current += '\n\n' + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function excelToText(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 10)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (csv) parts.push(`## Sheet: ${sheetName}\n${csv.slice(0, 30_000)}`);
  }
  return parts.join('\n\n');
}

/** OCR fallback for images via the vision model. Never throws. */
async function imageToText(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  try {
    const base64 = Buffer.from(buffer).toString('base64');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all readable text from this image verbatim. If it is a photo without text, describe what it shows in 2-3 sentences. Return only the extracted text or description.',
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  } catch (error) {
    console.error('Image OCR failed:', error);
    return '';
  }
}

interface Enrichment {
  language: string | null;
  summary: string | null;
  suggestedKeywordIds: string[];
}

/**
 * One cheap LLM call: language detection + summary + keyword-link suggestions
 * against the org's real keyword list. Never throws.
 */
async function enrichAsset(
  text: string,
  fileName: string,
  orgKeywords: Array<{ id: string; title: string; synonyms: string[] | null }>
): Promise<Enrichment> {
  if (!text.trim()) return { language: null, summary: null, suggestedKeywordIds: [] };
  try {
    const keywordList = orgKeywords.slice(0, 120).map((k) => ({
      id: k.id,
      title: k.title,
      synonyms: (k.synonyms ?? []).slice(0, 5),
    }));

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You analyze a company document. Return ONLY JSON: {"language": "ISO 639-1 code", "summary": "2-3 sentence summary", "keyword_ids": ["ids of the provided keywords this document is clearly about, max 5"]}. Only suggest keyword ids from the provided list; suggest none if unsure.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            file_name: fileName,
            document_text: text.slice(0, MAX_ENRICH_CHARS),
            available_keywords: keywordList,
          }),
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
    const validIds = new Set(orgKeywords.map((k) => k.id));
    return {
      language: typeof parsed.language === 'string' ? parsed.language.slice(0, 8) : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 1000) : null,
      suggestedKeywordIds: Array.isArray(parsed.keyword_ids)
        ? parsed.keyword_ids.filter((id: unknown) => typeof id === 'string' && validIds.has(id)).slice(0, 5)
        : [],
    };
  } catch (error) {
    console.error('Asset enrichment failed:', error);
    return { language: null, summary: null, suggestedKeywordIds: [] };
  }
}

/**
 * Full ingestion pipeline for one asset:
 * status lifecycle → text extraction (pdf / text / excel / image-OCR)
 * → language + summary + keyword suggestions → chunk + embed → provenance.
 */
export async function processAsset(params: {
  assetId: string;
  organizationId: string;
  fileBuffer: ArrayBuffer;
  keywordId?: string | null;
}): Promise<ProcessResult> {
  const supabase = createServiceClient();
  const { assetId, organizationId, fileBuffer } = params;
  let keywordId = params.keywordId ?? null;

  const fail = async (message: string): Promise<ProcessResult> => {
    await supabase
      .from('assets')
      .update({ processing_status: 'failed', processed: false })
      .eq('id', assetId)
      .eq('organization_id', organizationId);
    return {
      status: 'failed', extractedChars: 0, chunks: 0,
      language: null, summary: null, suggestedKeywordIds: [], error: message,
    };
  };

  try {
    const { data: asset } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!asset) return await fail('Asset not found');

    await supabase
      .from('assets')
      .update({ processing_status: 'processing' })
      .eq('id', assetId)
      .eq('organization_id', organizationId);

    if (!keywordId) {
      const { data: links } = await supabase
        .from('keyword_assets')
        .select('keyword_id')
        .eq('asset_id', assetId);
      if (links && links.length === 1) keywordId = links[0].keyword_id;
    }

    // --- Extraction ---
    let extractedText = '';
    if (asset.file_type === 'pdf') {
      try {
        extractedText = (await pdf(Buffer.from(fileBuffer))).text;
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
      }
    } else if (asset.file_type === 'text') {
      extractedText = new TextDecoder('utf-8', { fatal: false }).decode(fileBuffer);
    } else if (asset.file_type === 'excel') {
      try {
        extractedText = excelToText(fileBuffer);
      } catch (xlsxError) {
        console.error('Excel parsing error:', xlsxError);
      }
    } else if (asset.file_type === 'image' && asset.mime_type) {
      extractedText = await imageToText(fileBuffer, asset.mime_type);
    }
    extractedText = extractedText.slice(0, MAX_TEXT_CHARS);

    // --- Enrichment: language, summary, keyword-link suggestions ---
    const { data: orgKeywords } = await supabase
      .from('keywords')
      .select('id, title, synonyms')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .limit(120);

    const enrichment = await enrichAsset(extractedText, asset.file_name, orgKeywords ?? []);

    // --- Persist extraction + enrichment ---
    await supabase
      .from('assets')
      .update({
        extracted_text: extractedText || null,
        description: enrichment.summary,
        processed: true,
        processing_status: 'processed',
        meta_json: {
          ...(asset.meta_json ?? {}),
          language: enrichment.language,
          summary: enrichment.summary,
          suggested_keyword_ids: enrichment.suggestedKeywordIds,
          extracted_chars: extractedText.length,
          processed_at: new Date().toISOString(),
        },
      })
      .eq('id', assetId)
      .eq('organization_id', organizationId);

    // --- Chunk + embed (replace any previous chunks on reprocess) ---
    let chunkCount = 0;
    if (extractedText) {
      await supabase.from('chunks').delete().eq('asset_id', assetId);
      const chunks = chunkText(extractedText);
      for (let i = 0; i < chunks.length; i++) {
        try {
          const embedding = await createEmbedding(chunks[i]);
          await supabase.from('chunks').insert({
            organization_id: organizationId,
            asset_id: assetId,
            keyword_id: keywordId,
            chunk_index: i,
            chunk_text: chunks[i],
            embedding,
            token_count: Math.ceil(chunks[i].length / 4),
          });
          chunkCount++;
        } catch (embeddingError) {
          console.error('Embedding error for chunk', i, embeddingError);
        }
      }
    }

    return {
      status: 'processed',
      extractedChars: extractedText.length,
      chunks: chunkCount,
      language: enrichment.language,
      summary: enrichment.summary,
      suggestedKeywordIds: enrichment.suggestedKeywordIds,
    };
  } catch (error: any) {
    console.error('Asset processing failed:', error);
    return await fail(error?.message ?? 'processing failed');
  }
}
