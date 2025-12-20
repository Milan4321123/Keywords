import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createEmbedding } from '@/lib/openai';
import pdf from 'pdf-parse';

// POST /api/assets/upload - Upload files and link to keyword
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const formData = await req.formData();
    
    const file = formData.get('file') as File;
    const keywordId = formData.get('keyword_id') as string;
    
    if (!file) {
      return NextResponse.json(
        { data: null, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Determine file type
    const mimeType = file.type;
    let fileType = 'other';
    if (mimeType.startsWith('image/')) fileType = 'image';
    else if (mimeType === 'application/pdf') fileType = 'pdf';
    else if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) fileType = 'excel';
    else if (mimeType.includes('word') || mimeType.includes('document')) fileType = 'word';
    else if (mimeType.startsWith('text/')) fileType = 'text';

    // Upload to Supabase Storage
    const fileBuffer = await file.arrayBuffer();
    const fileName = `${Date.now()}-${file.name}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('assets')
      .upload(fileName, fileBuffer, {
        contentType: mimeType,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('assets')
      .getPublicUrl(fileName);

    // Create asset record
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        mime_type: mimeType,
        file_size: file.size,
        processed: false,
      })
      .select()
      .single();

    if (assetError) throw assetError;

    // Link to keyword if provided
    if (keywordId && asset) {
      await supabase.from('keyword_assets').insert({
        keyword_id: keywordId,
        asset_id: asset.id,
      });
    }

    // Queue for processing (text extraction, chunking)
    // In a real app, this would trigger a background job
    processAssetAsync(asset.id, fileBuffer, mimeType);

    return NextResponse.json({ data: asset, error: null });
  } catch (error) {
    console.error('Error uploading asset:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}

// Background processing function (simplified - in production use a job queue)
async function processAssetAsync(assetId: string, fileBuffer?: ArrayBuffer, mimeType?: string) {
  try {
    const supabase = createServerClient();

    // Get asset
    const { data: asset } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single();

    if (!asset) return;

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
            asset_id: assetId,
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
    const supabase = createServerClient();
    const { searchParams } = new URL(req.url);
    const keywordId = searchParams.get('keyword_id');

    if (keywordId) {
      const { data, error } = await supabase
        .from('keyword_assets')
        .select('*, asset:assets(*)')
        .eq('keyword_id', keywordId);

      if (error) throw error;

      return NextResponse.json({
        data: data?.map((ka) => ka.asset) || [],
        error: null,
      });
    }

    const { data: assets, error } = await supabase
      .from('assets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ data: assets, error: null });
  } catch (error) {
    console.error('Error fetching assets:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to fetch assets' },
      { status: 500 }
    );
  }
}
