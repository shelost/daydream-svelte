import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  try {
    const { prompt, model = 'gpt-4o-mini', images = [] } = await event.request.json();

    if (!OPENAI_API_KEY) {
      console.error('OpenAI API Key is missing from environment variables.');
      return json({ error: 'API key not configured on server.' }, { status: 500 });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return json({ error: 'Prompt is required' }, { status: 400 });
    }

    /* ---------------------------------------------
       1) Handle image-generation models
    --------------------------------------------- */
    if (model.startsWith('gpt-image')) {
      const imgResponse = await fetch('https://api.openai.com/v1/images/generations', {
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

      if (!imgResponse.ok) {
        const errorData = await imgResponse.json();
        return json({ error: errorData.error?.message || 'OpenAI API error while generating image' }, { status: imgResponse.status });
      }

      const data = await imgResponse.json();
      const imageUrl = data.data?.[0]?.url ?? '';
      return json({ imageUrl });
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

    const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: userContent }
        ],
        temperature: 0.7
      })
    });

    if (!chatResponse.ok) {
      const errorData = await chatResponse.json();
      return json({ error: errorData.error?.message || 'OpenAI API error during chat completion' }, { status: chatResponse.status });
    }

    const chatData = await chatResponse.json();
    const message = chatData.choices?.[0]?.message?.content ?? '';
    return json({ message });
  } catch (err: any) {
    console.error('GPT endpoint error:', err);
    return json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
};