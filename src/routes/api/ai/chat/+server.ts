import { OpenAI } from 'openai';
import { OPENAI_API_KEY } from '$env/static/private';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export async function POST({ request }) {
  try {
    const { messagesHistory, model } = await request.json();

    if (!messagesHistory || !Array.isArray(messagesHistory) || messagesHistory.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages history is required and must be a non-empty array' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!model) {
      return new Response(JSON.stringify({ error: 'Model is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const stream = await openai.chat.completions.create({
      model: model,
      messages: messagesHistory,
      stream: true,
    });

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(encoder.encode(content));
          }
        }
        controller.close();
      },
      cancel() {
        // This will be called if the client aborts the request
        console.log('Stream cancelled by client');
      }
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      }
    });

  } catch (error: any) {
    console.error('Error in /api/ai/chat endpoint:', error);
    let errorMessage = 'An unexpected error occurred.';
    let errorStatus = 500;

    if (error.response) { // Axios-like error structure from OpenAI library
        errorMessage = error.response.data?.error?.message || error.message;
        errorStatus = error.response.status || 500;
    } else if (error.message) {
        errorMessage = error.message;
    }

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: errorStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}