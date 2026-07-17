import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = body.query || '';
    const rawContext = body.rawContext || '';
    const llmModel = body.llmModel || 'qwen2.5:3b'; // dynamic LLM model

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const systemPrompt = `You are a helpful coding assistant analyzing a codebase.
Use the provided codebase context to answer the user's question accurately.
If the context doesn't contain the answer, say so. Do not hallucinate files or logic.

${rawContext}`;

    // Stream from Ollama
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmModel,
        prompt: `Question: ${query}`,
        system: systemPrompt,
        stream: true,
      })
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to connect to LLM backend' }, { status: 500 });
    }

    // Return the readable stream directly to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
