import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { optimize } from 'svgo';
import { calculateCost } from '$lib/utils/apiPricing.js';
import { get_encoding } from 'tiktoken';

const tokenizer = get_encoding('cl100k_base');

// Utility to strip markdown fences if the model wraps the SVG
function extractSvg(raw: string): string {
  if (!raw) return '';
  // Remove markdown triple back-ticks and language hints
  const cleaned = raw.replace(/```[a-zA-Z]*[\r\n]+/g, '').replace(/```/g, '').trim();
  // If the model still returned additional commentary, attempt to isolate the first <svg> ... </svg>
  const svgMatch = cleaned.match(/<svg[\s\S]*?<\/svg>/i);
  return svgMatch ? svgMatch[0] : cleaned;
}

export const POST: RequestHandler = async (event) => {
  const startTime = Date.now();
  let apiLogEntry = {
      id: `gensvg-${Date.now()}`,
      timestamp: new Date().toISOString(),
      apiProvider: 'OpenAI',
      model: 'gpt-4o-mini', // Default, will be confirmed by API call logic
      endpoint: '/v1/chat/completions', // Standard for chat models
      cost: 0,
      status: 500,
      durationMs: 0,
      error: null,
      inputTokens: 0,
      outputTokens: 0
  };

  try {
    const { imageData, prompt, additionalContext, model: clientModel } = await event.request.json();
    apiLogEntry.model = clientModel || 'gpt-4o-mini'; // Use client model if provided

    // @ts-ignore – env import
    const { OPENAI_API_KEY } = await import('$env/static/private');
    if (!OPENAI_API_KEY) {
      apiLogEntry.error = 'OpenAI API key is not configured.';
      apiLogEntry.durationMs = Date.now() - startTime;
      return json({ error: apiLogEntry.error, apiLogEntry }, { status: 500 });
    }

    const hasImage = typeof imageData === 'string' && imageData.trim().length > 0;

    if (!prompt) {
      apiLogEntry.error = 'prompt is required.';
      apiLogEntry.status = 400;
      apiLogEntry.durationMs = Date.now() - startTime;
      return json({ error: apiLogEntry.error, apiLogEntry }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const sysPromptSketch = `You are a precise vector conversion engine. Return ONLY valid standalone SVG markup with no additional commentary. Do not include <html> or <body> tags. All geometry must match the layout of the supplied sketch image. Use colour fills and strokes when relevant.`;
    const sysPromptText  = `You are a skilled vector illustration engine. Return ONLY valid standalone SVG markup with no additional commentary. Use colour fills and strokes when relevant.`;
    const sysPrompt = hasImage ? sysPromptSketch : sysPromptText;

    const userMessageContentParts: Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }> = [];
    userMessageContentParts.push({ type: 'text', text: prompt + (additionalContext ? `\n\nExtra context: ${additionalContext}` : '') });
    if (hasImage) {
      userMessageContentParts.push({
        type: 'image_url',
        image_url: { url: imageData }
      });
    }

    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userMessageContentParts }
    ];

    let inputTokenCount = 0;
    messages.forEach(msg => {
        if (msg.role === 'system' && typeof msg.content === 'string') {
             inputTokenCount += tokenizer.encode(msg.content).length;
        } else if (msg.role === 'user' && Array.isArray(msg.content)) {
            msg.content.forEach(part => {
                if (part.type === 'text') {
                    inputTokenCount += tokenizer.encode(part.text).length;
                }
                // Image tokens are handled differently by OpenAI pricing, often fixed or based on resolution/quality tier.
                // For gpt-4o with image inputs, the token cost is more complex.
                // We'll primarily base cost on text tokens and a fixed image cost if applicable.
            });
        }
    });
    apiLogEntry.inputTokens = inputTokenCount;
    // Add a base token count for the image if present, consult OpenAI docs for precise calculation for gpt-4o vision
    if (hasImage) apiLogEntry.inputTokens += 85; // Placeholder for low-res image input part

    const completion = await openai.chat.completions.create({
      model: apiLogEntry.model,
      temperature: 0.2,
      max_tokens: 4096,
      messages: messages
    });

    apiLogEntry.durationMs = Date.now() - startTime;
    apiLogEntry.status = 200;

    const rawSvg = completion.choices[0]?.message?.content || '';
    const svgCodeRaw = extractSvg(rawSvg);

    if (completion.usage) {
        apiLogEntry.inputTokens = completion.usage.prompt_tokens || apiLogEntry.inputTokens; // Use API reported if available
        apiLogEntry.outputTokens = completion.usage.completion_tokens || 0;
    } else {
        // Estimate output tokens if not provided (less accurate)
        apiLogEntry.outputTokens = tokenizer.encode(rawSvg).length;
    }

    // Cost calculation for GPT model
    const usageDetails = {
        inputTokens: apiLogEntry.inputTokens,
        outputTokens: apiLogEntry.outputTokens
    };
    apiLogEntry.cost = calculateCost('OpenAI', apiLogEntry.model, usageDetails);

    if (!svgCodeRaw.startsWith('<svg')) {
      apiLogEntry.error = 'Model response did not contain valid SVG.';
      apiLogEntry.status = 500; // Or 422 if considering it a processing error
      // Cost is already calculated based on tokens used, even if output is not as expected.
      return json({ error: apiLogEntry.error, svgCode: svgCodeRaw, apiLogEntry }, { status: apiLogEntry.status });
    }

    let svgCode = svgCodeRaw;
    try {
      const optimised = optimize(svgCodeRaw, { multipass: true });
      if ('data' in optimised) svgCode = optimised.data;
    } catch (optErr: any) {
      console.warn('SVGO optimisation failed:', optErr.message);
      // Not a critical error for logging, proceed with unoptimised SVG
    }

    return json({ svgCode, apiLogEntry });

  } catch (err: any) {
    console.error('Error in generate-svg endpoint:', err);
    apiLogEntry.durationMs = Date.now() - startTime;
    apiLogEntry.error = err.message || 'Internal server error';
    apiLogEntry.status = err.response?.status || err.status || 500;

    // Attempt to get token usage even from error response if available (some APIs might provide it)
    if (err.response?.data?.error?.usage) {
        apiLogEntry.inputTokens = err.response.data.error.usage.prompt_tokens || apiLogEntry.inputTokens;
        apiLogEntry.outputTokens = err.response.data.error.usage.completion_tokens || 0;
    }
    // Recalculate cost if tokens were found in error, otherwise it remains 0 or previously calculated if partial success
    if (apiLogEntry.inputTokens > 0 || apiLogEntry.outputTokens > 0) {
        const usageDetails = { inputTokens: apiLogEntry.inputTokens, outputTokens: apiLogEntry.outputTokens };
        apiLogEntry.cost = calculateCost('OpenAI', apiLogEntry.model, usageDetails);
    }

    return json({ error: apiLogEntry.error, apiLogEntry }, { status: apiLogEntry.status });
  }
};