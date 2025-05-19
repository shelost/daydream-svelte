import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';

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
  try {
    const { imageData, prompt, additionalContext } = await event.request.json();

    // @ts-ignore – env import
    const { OPENAI_API_KEY } = await import('$env/static/private');
    if (!OPENAI_API_KEY) {
      return json({ error: 'OpenAI API key is not configured.' }, { status: 500 });
    }

    if (!imageData || !prompt) {
      return json({ error: 'imageData and prompt are required.' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const sysPrompt = `You are a precise vector conversion engine. Return ONLY valid standalone SVG markup with no additional commentary. Do not include <html> or <body> tags. All geometry must match the layout of the supplied sketch image. Use colour fills and strokes when relevant.`;

    const userContent: any = [];
    if (prompt) userContent.push({ type: 'text', text: prompt + (additionalContext ? `\n\nExtra context: ${additionalContext}` : '') });
    // OpenAI Vision message format
    userContent.push({
      type: 'image_url',
      image_url: {
        url: imageData,
      }
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Use GPT-4o (vision capable). Adjust if newer model exists.
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userContent }
      ]
    });

    const rawSvg = completion.choices[0]?.message?.content || '';
    const svgCode = extractSvg(rawSvg);

    if (!svgCode.startsWith('<svg')) {
      return json({ error: 'Model response did not contain valid SVG.' }, { status: 500 });
    }

    return json({ svgCode });
  } catch (err: any) {
    console.error('Error in generate-svg endpoint:', err);
    return json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
};