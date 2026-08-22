/**
 * Transcribe API Route
 * POST: Accepts audio blob, sends to ElevenLabs Scribe v2, returns text
 */

import { NextResponse } from 'next/server';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided', success: false },
        { status: 400 }
      );
    }

    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured', success: false },
        { status: 500 }
      );
    }

    // Prepare form data for ElevenLabs
    const elevenLabsForm = new FormData();
    elevenLabsForm.append('file', audioFile);
    elevenLabsForm.append('model_id', 'scribe_v2');
    elevenLabsForm.append('language_code', 'eng');

    const startTime = performance.now();

    const response = await fetch(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: elevenLabsForm
    });

    const elapsed = performance.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Transcribe] ElevenLabs error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Transcription failed', details: errorText, success: false },
        { status: response.status }
      );
    }

    const data = await response.json();
    const transcript = data.text || '';

    return NextResponse.json({
      success: true,
      transcript: transcript.trim(),
      language: data.language_code || 'eng',
      duration_ms: Math.round(elapsed),
      model: 'scribe_v2'
    });
  } catch (error) {
    console.error('[Transcribe] Error:', error);
    return NextResponse.json(
      { error: 'Transcription failed', message: error.message, success: false },
      { status: 500 }
    );
  }
}
