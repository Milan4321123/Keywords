import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { createEmbedding } from '@/lib/openai';
import pdf from 'pdf-parse';

// POST /api/assets/upload - Upload files and link to keyword
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const formData = await req.formData();

    const file = formData.get('file') as File;
    const keywordId = formData.get('keyword_id') as string;

    if (!file) {
      return NextResponse.json(
        { data: null, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Keyword link must belong to the active organization
    if (keywordId) {
      const { data: keyword } = await ctx.supabase
        .from('keywords')
        .select('id')
        .eq('id', keywordId)
        .eq('organization_id', ctx.org.id)
        .maybeSingle();
      if (!keyword) {
        return NextResponse.json({ data: null, error: 'Keyword not found' }, { status: 400 });
      }
    }

    // Determine file type
    const mimeType = file.type;
    let fileType = 'other';
    if (mimeType.startsWith('image/')) fileType = 'image';
    else if (mimeType === 'application/pdf') fileType = 'pdf';
    else if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) fileType = 'excel';
    else if (mimeType.includes('word') || mimeType.includes('document')) fileType = 'word';
    else if (mimeType.startsWith('text/')) fileType = 'text';

    // Upload to Supabase Storage under an org-scoped path
    const fileBuffer = await file.arrayBuffer();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const fileName = `${ctx.org.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await ctx.supabase.storage
      .from('assets')
      .upload(fileName, fileBuffer, {
        contentType: mimeType,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = ctx.supabase.storage
      .from('assets')
      .getPublicUrl(fileName);

    // Create asset record
    const { data: asset, error: assetError } = await ctx.supabase
      .from('assets')
      .insert({
        organization_id: ctx.org.id,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        mime_type: mimeType,
        file_size: file.size,
        processed: false,
        processing_status: 'processing',
        created_by: ctx.user.id,
      })
      .select()
      .single();

    if (assetError) throw assetError;

    // Link to keyword if provided
    if (keywordId && asset) {
      await ctx.supabase.from('keyword_assets').insert({
        keyword_id: keywordId,
        asset_id: asset.id,
      });
    }

    await audit(ctx, 'asset.upload', { type: 'asset', id: asset.id }, {
      file_name: file.name,
      file_type: fileType,
      keyword_id: keywordId || null,
    });

    // Queue for processing (text extraction, chunking)
    // In a real app, this would trigger a background job
    processAssetAsync(asset.id, ctx.org.id, fileBuffer, mimeType, keywordId);

    return NextResponse.json({ data: asset, error: null });
  } catch (error) {
    return apiError(error, 'Failed to upload file');
  }
}

// Background processing function (simplified - in production use a job queue)
async function processAssetAsync(
  assetId: string,
  organizationId: string,
  fileBuffer?: ArrayBuffer,
  mimeType?: string,
  keywordId?: string
) {
  try {
    const supabase = createServiceClient();

    // Get asset
    const { data: asset } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .eq('organization_id', organizationId)
      .single();

    if (!asset) return;

    // If a keyword wasn't passed explicitly, try to infer it from the link table.
    // Note: assets can be linked to multiple keywords; in that case keep it null.
    if (!keywordId) {
      const { data: links } = await supabase
        .from('keyword_assets')
        .select('keyword_id')
        .eq('asset_id', assetId);

      if (links && links.length === 1) {
        keywordId = links[0].keyword_id;
      }
    }

    let extractedText = '';

    // Extract text based on file type
    if (asset.file_type === 'pdf' && fileBuffer) {
      try {
        // Parse PDF using pdf-parse
        const pdfData = await pdf(Buffer.from(fileBuffer));
        extractedText = pdfData.text;
        console.log(`Extracted ${extractedText.length} characters from PDF: ${asset.file_name}`);
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        extractedText = `[Failed to extract PDF content from ${asset.file_name}]`;
      }
    } else if (asset.file_type === 'text') {
      // Fetch and read text file
      const response = await fetch(asset.file_url);
      extractedText = await response.text();
    } else if (asset.file_type === 'excel') {
      // In a real app, use xlsx library
      extractedText = `[Excel content from ${asset.file_name}]`;
    }

    // Update asset with extracted text
    await supabase
      .from('assets')
      .update({
        extracted_text: extractedText,
        processed: true,
        processing_status: 'processed',
      })
      .eq('id', assetId);

    // Create chunks and embeddings
    if (extractedText) {
      const chunks = chunkText(extractedText);

      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i];

        try {
          const embedding = await createEmbedding(chunkText);

          await supabase.from('chunks').insert({
            organization_id: organizationId,
            asset_id: assetId,
            keyword_id: keywordId || null,
            chunk_index: i,
            chunk_text: chunkText,
            embedding: embedding,
            token_count: Math.ceil(chunkText.length / 4), // Rough estimate
          });
        } catch (embeddingError) {
          console.error('Error creating embedding:', embeddingError);
        }
      }
    }
  } catch (error) {
    console.error('Error processing asset:', error);
  }
}

// Simple text chunking function
function chunkText(text: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = para;
    } else {
      currentChunk += '\n\n' + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// GET /api/assets/upload - Get assets (optionally filtered by keyword)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { searchParams } = new URL(req.url);
    const keywordId = searchParams.get('keyword_id');

    if (keywordId) {
      const { data, error } = await ctx.supabase
        .from('keyword_assets')
        .select('*, asset:assets!inner(*)')
        .eq('keyword_id', keywordId)
        .eq('asset.organization_id', ctx.org.id);

      if (error) throw error;

      return NextResponse.json({
        data: data?.map((ka) => ka.asset) || [],
        error: null,
      });
    }

    const { data: assets, error } = await ctx.supabase
      .from('assets')
      .select('*')
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ data: assets, error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch assets');
  }
}
