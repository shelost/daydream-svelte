import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { DrawingContent } from '$lib/types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import OpenAI from 'openai';

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Image edit API called');
    const requestData = await event.request.json();
    const {
      drawingContent,
      imageData,
      aspectRatio,
      prompt: clientPrompt
    } = requestData;

    if (!drawingContent || !imageData) {
      return json({ error: 'Drawing content and image data are required' }, { status: 400 });
    }

    // Convert base64 data URL to base64 string
    const base64Data = imageData.split(',')[1];
    if (!base64Data) {
      return json({ error: 'Invalid image data format' }, { status: 400 });
    }

    // Get OpenAI API Key using dynamic import to avoid TypeScript errors
    const { OPENAI_API_KEY } = await import('$env/static/private');

    // Check if API key is available
    if (!OPENAI_API_KEY) {
      return json({ error: 'OpenAI API key is not configured' }, { status: 500 });
    }

    // Create OpenAI instance
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // Use the prompt provided by the client (from the store)
    if (!clientPrompt) {
      return json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Determine image size based on aspect ratio
    let imageSize: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024"; // Default square
    if (aspectRatio) {
      switch(aspectRatio) {
        case '4:5':
          imageSize = "1024x1024";
          break;
        case '1:1':
          imageSize = "1024x1024";
          break;
        case '9:16':
          imageSize = "1024x1024";
          break;
        default:
          imageSize = "1024x1024";
      }
    }
    console.log('Using image size:', imageSize);

    try {
      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: clientPrompt,
        n: 1,
        size: imageSize
      });

      if (response.data && response.data.length > 0) {
        const editedImage = response.data[0];
        if (editedImage.revised_prompt) {
          console.log('GPT-Image-1 revised prompt:', editedImage.revised_prompt);
        }
        if (editedImage.url) {
          return json({
            imageUrl: editedImage.url,
            url: editedImage.url,
            model: "gpt-image-1-edit",
            aspectRatio: aspectRatio
          });
        } else if (editedImage.b64_json) {
          return json({
            imageUrl: `data:image/png;base64,${editedImage.b64_json}`,
            url: `data:image/png;base64,${editedImage.b64_json}`,
            model: "gpt-image-1-edit",
            aspectRatio: aspectRatio
          });
        }
      }
      return json({ error: 'Failed to edit image - unexpected API response format' }, { status: 500 });
    } catch (error) {
      console.error('OpenAI API error:', error);
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('safety') ||
            errorMessage.includes('content filter') ||
            errorMessage.includes('policy violation') ||
            errorMessage.includes('rejected')) {
          return json({
            error: 'Your drawing or description triggered OpenAI\'s content filter. Please modify your drawing or description to avoid sensitive content.'
          }, { status: 400 });
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('Error editing image:', error);
    return json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
};
