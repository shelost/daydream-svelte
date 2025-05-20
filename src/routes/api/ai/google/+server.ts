import { json } from '@sveltejs/kit';
import { GOOGLE_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, type Part } from '@google/generative-ai';

const REQUEST_TIMEOUT = 30000; // 30-second timeout

export const POST: RequestHandler = async (event) => {
    const startTime = Date.now();
    try {
        const { prompt, model = 'gemini-2.5-pro-preview-05-06', images = [] } = await event.request.json();

        if (!GOOGLE_API_KEY) {
            console.error('Google API Key is missing.');
            return json({ error: 'API key not configured.' }, { status: 500 });
        }

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return json({ error: 'Prompt is required.' }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
        const geminiModel = genAI.getGenerativeModel({ model: model.startsWith('models/') ? model : `models/${model}` });

        const requestParts: Part[] = [{ text: prompt }];

        if (images && images.length > 0) {
            for (const imageUrl of images) {
                if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image')) {
                    const [header, base64Data] = imageUrl.split(',');
                    const mimeType = header.match(/data:(image\/\w+);base64/)?.[1];
                    if (mimeType && base64Data) {
                        requestParts.push({ inlineData: { mimeType, data: base64Data } });
                    }
                } else {
                     console.warn('Skipping non-data URL image for Google Gemini as direct URLs are not robustly supported here.');
                }
            }
        }

        // Safety settings - adjust as needed
        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ];

        try {
            const generationConfig = {
                maxOutputTokens: 2048,
                temperature: 0.7,
            };

            const streamResultPromise = geminiModel.generateContentStream({
                contents: [{ role: "user", parts: requestParts }],
                generationConfig,
                safetySettings,
            });

            // Create a readable stream to send to the client
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        const encoder = new TextEncoder();
                        const streamResult = await streamResultPromise;

                        for await (const chunk of streamResult.stream) {
                            try {
                                const textContent = chunk.text();
                                if (textContent) {
                                    // Parse and extract just the message content if it's a JSON response
                                    try {
                                        // Check if the text is actually a JSON object
                                        if (textContent.trim().startsWith('{') && textContent.trim().endsWith('}')) {
                                            const jsonObj = JSON.parse(textContent);
                                            // Extract only the actual content part if available
                                            if (jsonObj.message && typeof jsonObj.message === 'string') {
                                                controller.enqueue(encoder.encode(jsonObj.message));
                                            } else if (jsonObj.text && typeof jsonObj.text === 'string') {
                                                controller.enqueue(encoder.encode(jsonObj.text));
                                            } else if (jsonObj.content && typeof jsonObj.content === 'string') {
                                                controller.enqueue(encoder.encode(jsonObj.content));
                                            } else {
                                                // If we can't find a specific content field, strip metadata
                                                // Remove JSON fields that look like metadata
                                                const filteredObj = { ...jsonObj };
                                                ['usage', 'input_chars', 'output_chars', 'cost', 'durationMs', 'total_tokens'].forEach(key => {
                                                    delete filteredObj[key];
                                                });
                                                controller.enqueue(encoder.encode(JSON.stringify(filteredObj)));
                                            }
                                        } else {
                                            // Plain text, send as is
                                            controller.enqueue(encoder.encode(textContent));
                                        }
                                    } catch (jsonErr) {
                                        // Not valid JSON, just send the raw text
                                        controller.enqueue(encoder.encode(textContent));
                                    }
                                }
                            } catch (e) {
                                console.warn("Could not extract text using .text() method from chunk", e);
                            }
                        }
                        controller.close();
                    } catch (error) {
                        console.error("Stream processing error:", error);
                        controller.error(error);
                    }
                }
            });

            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-cache'
                }
            });

        } catch (error: any) {
            if (error.message?.includes('timed out')) {
                 return json({ error: 'Request to Google Gemini timed out.', durationMs: Date.now() - startTime }, { status: 504 });
            }
            console.error('Google Gemini API error:', error);
            // Check for specific safety/block reasons if available
            if (error.response && error.response.promptFeedback && error.response.promptFeedback.blockReason) {
                return json({ error: `Blocked by Google: ${error.response.promptFeedback.blockReason}`, details: error.response.promptFeedback }, { status: 400 });
            }
            return json({ error: error.message || 'Google Gemini API error.', durationMs: Date.now() - startTime }, { status: error.status || 500 });
        }

    } catch (err: any) {
        console.error('Google Gemini endpoint error:', err);
        return json({ error: err.message || 'Internal server error.', durationMs: Date.now() - startTime }, { status: 500 });
    }
};