import { json } from '@sveltejs/kit';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, TextBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';

// Define the ImageBlockParamSource interface to match Anthropic SDK requirements
interface ImageBlockParamSource {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
}

const REQUEST_TIMEOUT = 30000; // 30-second timeout

export const POST: RequestHandler = async (event) => {
    const startTime = Date.now();
    try {
        const { prompt, model = 'claude-3-7-sonnet-20250219', images = [] } = await event.request.json();

        if (!ANTHROPIC_API_KEY) {
            console.error('Anthropic API Key is missing.');
            return json({ error: 'API key not configured.' }, { status: 500 });
        }

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return json({ error: 'Prompt is required.' }, { status: 400 });
        }

        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

        const userMessagesContent: Array<TextBlockParam | ImageBlockParam> = [];

        // Add text part to content
        userMessagesContent.push({ type: 'text', text: prompt });

        // Add image parts to content if any
        if (images && images.length > 0) {
            for (const imageUrl of images) {
                if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image')) {
                    const [header, base64Data] = imageUrl.split(',');
                    const mediaTypeMatch = header.match(/data:(image\/\w+);base64/);
                    const rawMediaType = mediaTypeMatch ? mediaTypeMatch[1] : null;

                    // Validate media type is one of the allowed types
                    const validMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    const mediaType = validMediaTypes.includes(rawMediaType)
                        ? rawMediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
                        : 'image/png'; // Default to PNG if invalid

                    if (base64Data) {
                        userMessagesContent.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Data,
                            },
                        });
                    } else {
                        console.warn('Skipping malformed image data URL for Anthropic');
                    }
                } else {
                    console.warn('Skipping non-data URL image for Anthropic as direct URLs are not robustly supported here.');
                }
            }
        }

        const messages: MessageParam[] = [
            {
                role: 'user',
                content: userMessagesContent
            }
        ];

        // Filter out image content if the selected model does not support vision
        // This is a safeguard, primary check should be client-side
        const selectedModelInfo = { visionIn: true }; // Assume current Anthropic models are vision-capable
        if (!selectedModelInfo.visionIn) {
            messages[0].content = userMessagesContent.filter(c => c.type === 'text');
        }

        try {
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT);

            // Use streaming response
            const stream = await anthropic.messages.create({
                model: model, // Use the model ID from the request
                max_tokens: 2048,
                messages: messages,
                stream: true, // Enable streaming
                // system: "You are a helpful assistant.", // Optional system prompt
            }, { signal: abortController.signal });

            clearTimeout(timeoutId);

            // Create a readable stream to send to the client
            const responseStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();

                    try {
                        for await (const chunk of stream) {
                            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                                // Send text content directly to the client
                                controller.enqueue(encoder.encode(chunk.delta.text));
                            }
                        }
                        controller.close();
                    } catch (error) {
                        console.error("Stream processing error:", error);
                        controller.error(error);
                    }
                }
            });

            return new Response(responseStream, {
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-cache'
                }
            });

        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('timed out')) {
                return json({ error: 'Request to Anthropic timed out.', durationMs: Date.now() - startTime }, { status: 504 });
            }
            console.error('Anthropic API error:', error);
            return json({ error: error.message || 'Anthropic API error.', durationMs: Date.now() - startTime }, { status: error.status || 500 });
        }

    } catch (err: any) {
        console.error('Anthropic endpoint error:', err);
        return json({ error: err.message || 'Internal server error.', durationMs: Date.now() - startTime }, { status: 500 });
    }
};