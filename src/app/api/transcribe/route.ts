import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/openai';

// POST /api/transcribe - Transcribe audio to text
export async function POST(req: NextRequest) {
  try {
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

    console.log('Received audio file:', audioFile.name, 'Size:', audioFile.size, 'Type:', audioFile.type);

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
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
