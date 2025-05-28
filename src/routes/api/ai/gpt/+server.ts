import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';

// Simple in-memory cache for responses
// In a production app, consider using Redis or another persistent cache
const responseCache = new Map();
const CACHE_TTL = 60 * 1000; // Cache for 1 minute
const REQUEST_TIMEOUT = 30000; // 30-second timeout

/**
 * Calculates a cache key based on request parameters
 */
function calculateCacheKey(prompt: string, model: string, images: string[]): string {
  return `${model}:${prompt}:${JSON.stringify(images)}`;
}

/**
 * Cleans up old cache entries to prevent memory leaks
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      responseCache.delete(key);
    }
  }
}

// Run cleanup every minute
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCache, 60000);
}

export const POST: RequestHandler = async (event) => {
  const startTime = Date.now();
  try {
    const { prompt, model = 'gpt-4o-mini', images = [] } = await event.request.json();

    if (!OPENAI_API_KEY) {
      console.error('OpenAI API Key is missing from environment variables.');
      return json({ error: 'API key not configured on server.' }, { status: 500 });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Create OpenAI client
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // Check cache for identical requests to avoid redundant API calls
    const cacheKey = calculateCacheKey(prompt, model, images);
    if (responseCache.has(cacheKey)) {
      const cachedResponse = responseCache.get(cacheKey);
      if (Date.now() - cachedResponse.timestamp < CACHE_TTL) {
        console.log('Returning cached response for', model);
        return json({
          ...cachedResponse.data,
          cached: true,
          durationMs: Date.now() - startTime
        });
      } else {
        // Cache expired, remove it
        responseCache.delete(cacheKey);
      }
    }

    /* ---------------------------------------------
       1) Handle image-generation models
    --------------------------------------------- */
    if (model.startsWith('gpt-image')) {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), REQUEST_TIMEOUT);
      });

      // Make the API call with timeout
      const imgResponsePromise = fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: '1024x1024'
        })
      });

      // Race the API call against the timeout
      const imgResponse = await Promise.race([imgResponsePromise, timeoutPromise]) as Response;

      if (!imgResponse.ok) {
        const errorData = await imgResponse.json();
        return json({
          error: errorData.error?.message || 'OpenAI API error while generating image',
          durationMs: Date.now() - startTime
        }, { status: imgResponse.status });
      }

      const data = await imgResponse.json();
      const imageUrl = data.data?.[0]?.url ?? '';

      // Cache the successful response
      const responseData = { imageUrl, durationMs: Date.now() - startTime };
      responseCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

      return json(responseData);
    }

    /* ---------------------------------------------
       2) Handle chat models (optionally vision)
    --------------------------------------------- */
    const userContent: any = images.length
      ? [
          { type: 'text', text: prompt },
          ...images.map((url: string) => ({ type: 'image_url', image_url: { url } }))
        ]
      : prompt;

    // Create a chat completion with streaming enabled for text-based models
    try {
      // Determine if we should use streaming (only for text models)
      const shouldStream = !model.startsWith('gpt-image') && !images.length;

      // Set up a timeout wrapper
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT);

      try {
        if (shouldStream) {
          // For streaming responses, we'll get token by token updates
          const stream = await openai.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: userContent }
            ],
            temperature: 0.7,
            stream: true
          }, { signal: abortController.signal });

          let fullMessage = '';
          let tokenCount = 0;

          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              fullMessage += chunk.choices[0].delta.content;
              tokenCount++;
            }
          }

          // Calculate approx cost for tracking
          const cost = model.includes('gpt-4') ? tokenCount * 0.00005 : tokenCount * 0.000001;

          const responseData = {
            message: fullMessage,
            durationMs: Date.now() - startTime,
            usage: { total_tokens: tokenCount },
            cost
          };

          // Cache the successful response
          responseCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

          return json(responseData);
        } else {
          // For non-streaming responses (e.g., vision models), use regular completion
          const chatResponse = await openai.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: userContent }
            ],
            temperature: 0.7
          }, { signal: abortController.signal });

          const message = chatResponse.choices?.[0]?.message?.content ?? '';
          const usage = chatResponse.usage;

          // Calculate approximate cost
          let cost = 0;
          if (usage) {
            // Rough cost estimation - use actual pricing in production
            const inputRate = model.includes('gpt-4') ? 0.00003 : 0.0000005;
            const outputRate = model.includes('gpt-4') ? 0.00006 : 0.0000015;
            cost = (usage.prompt_tokens * inputRate) + (usage.completion_tokens * outputRate);
          }

          const responseData = {
            message,
            usage,
            durationMs: Date.now() - startTime,
            cost
          };

          // Cache the successful response
          responseCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

          return json(responseData);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      console.error('OpenAI chat error:', error);
      if (error.name === 'AbortError' || error.message?.includes('timed out')) {
        return json({
          error: 'The request to OpenAI timed out. Please try again.',
          durationMs: Date.now() - startTime
        }, { status: 504 });
      }
      const errorData = error.response?.data || {};
      return json({
        error: errorData.error?.message || error.message || 'OpenAI API error during chat completion',
        durationMs: Date.now() - startTime
      }, { status: error.status || 500 });
    }
  } catch (err: any) {
    console.error('GPT endpoint error:', err);
    return json({
      error: err.message || 'Internal server error',
      durationMs: Date.now() - startTime
    }, { status: 500 });
  }
};