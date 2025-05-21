import { OpenAI } from 'openai';
import { OPENAI_API_KEY } from '$env/static/private';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export async function POST({ request }) {
  const startTime = Date.now();
  try {
    const { messagesHistory, model } = await request.json();

    if (!messagesHistory || !Array.isArray(messagesHistory) || messagesHistory.length === 0) {
      return new Response(JSON.stringify({
        error: 'Messages history is required and must be a non-empty array',
        apiLogEntry: {
          id: `openai-${Date.now()}`,
          timestamp: new Date().toISOString(),
          apiProvider: 'OpenAI',
          model: model || 'unknown',
          endpoint: '/chat/completions',
          cost: 0,
          status: 400,
          durationMs: Date.now() - startTime,
          error: 'Messages history is required and must be a non-empty array',
          page: 'Chat'
        }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!model) {
      return new Response(JSON.stringify({
        error: 'Model is required',
        apiLogEntry: {
          id: `openai-${Date.now()}`,
          timestamp: new Date().toISOString(),
          apiProvider: 'OpenAI',
          model: 'unknown',
          endpoint: '/chat/completions',
          cost: 0,
          status: 400,
          durationMs: Date.now() - startTime,
          error: 'Model is required',
          page: 'Chat'
        }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const stream = await openai.chat.completions.create({
      model: model,
      messages: messagesHistory,
      stream: true,
    });

    // Variable to track token usage from stream chunks
    let inputTokens = 0;
    let outputTokens = 0;

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(encoder.encode(content));
          }

          // Update token counts if available in the chunk
          if (chunk.usage) {
            if (chunk.usage.prompt_tokens) inputTokens = chunk.usage.prompt_tokens;
            if (chunk.usage.completion_tokens) outputTokens = chunk.usage.completion_tokens;
          }
        }

        // After the stream is done, append the API log entry as a special JSON chunk
        const costPerInputToken = 0.00001; // Simplified cost calculation
        const costPerOutputToken = 0.00003; // Simplified cost calculation
        const estimatedCost = (inputTokens * costPerInputToken) + (outputTokens * costPerOutputToken);

        // Send API log as a final chunk
        const apiLogEntry = {
          id: `openai-${Date.now()}`,
          timestamp: new Date().toISOString(),
          apiProvider: 'OpenAI',
          model: model,
          endpoint: '/chat/completions',
          cost: estimatedCost,
          status: 200,
          durationMs: Date.now() - startTime,
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          page: 'Chat'
        };

        controller.enqueue(encoder.encode(`\n\n{
          "apiLogEntry": ${JSON.stringify(apiLogEntry)}
        }`));

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

    return new Response(JSON.stringify({
      error: errorMessage,
      apiLogEntry: {
        id: `openai-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        apiProvider: 'OpenAI',
        model: error.body?.model || 'unknown',
        endpoint: '/chat/completions',
        cost: 0,
        status: errorStatus,
        durationMs: Date.now() - startTime,
        error: errorMessage,
        page: 'Chat'
      }
    }), {
      status: errorStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}