import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/openai';
import { requireOrgContext, authErrorResponse } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { fileSizeError, MAX_AUDIO_BYTES } from '@/lib/validation';

// POST /api/transcribe - Transcribe audio to text
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    enforceRateLimit('ai', ctx.user.id);

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set');
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const field = formData.get('field') as string;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    const sizeError = fileSizeError(audioFile, MAX_AUDIO_BYTES);
    if (sizeError) {
      return NextResponse.json({ error: sizeError }, { status: 413 });
    }

    // Convert to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe using OpenAI Whisper
    const text = await transcribeAudio(buffer);

    return NextResponse.json({
      text,
      field,
      duration: null, // Could be extracted from audio metadata
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: authErr.status });
    }
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
