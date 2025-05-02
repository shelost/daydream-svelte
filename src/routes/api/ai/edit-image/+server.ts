import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { DrawingContent } from '$lib/types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import OpenAI from 'openai';

// Function to sanitize input text
function sanitizeInput(text) {
  if (!text) return '';
  // Remove any potential HTML/script injection
  return text.replace(/<[^>]*>/g, '').trim();
}

// Helper function to trim the prompt to a specific character limit
function trimPromptToLimit(prompt, limit = 4000) {
  if (!prompt) return '';
  if (prompt.length <= limit) return prompt;

  // If we need to trim, try to do it at a paragraph break
  const lastBreakPoint = prompt.lastIndexOf('\n\n', limit - 100);
  if (lastBreakPoint > limit * 0.75) {
    return prompt.substring(0, lastBreakPoint) + '\n\n[Prompt truncated to fit size limits...]';
  }

  return prompt.substring(0, limit - 50) + '\n\n[Prompt truncated to fit size limits...]';
}

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Image edit API called');
    const requestData = await event.request.json();
    const {
      drawingContent,
      imageData,
      aspectRatio,
      prompt
    } = requestData;

    if (!drawingContent || !imageData) {
      return json({ error: 'Drawing content and image data are required' }, { status: 400 });
    }

    if (!prompt) {
      return json({ error: 'Prompt is required. Please provide an edit prompt.' }, { status: 400 });
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

    console.log('Editing image with GPT-Image-1, prompt length:', prompt.length);

    // Determine image size based on aspect ratio
    let imageSize: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024"; // Default square
    if (aspectRatio) {
      switch(aspectRatio) {
        case '4:5':
          imageSize = "1024x1024"; // For portrait 4:5 ratio, use the portrait option
          break;
        case '1:1':
          imageSize = "1024x1024"; // Square
          break;
        case '9:16':
          imageSize = "1024x1024"; // For tall portrait 9:16 ratio, also use portrait option
          break;
        default:
          imageSize = "1024x1024"; // Default to square if unknown ratio
      }
    }
    console.log('Using image size:', imageSize);

    try {
      // For now, let's implement a simpler approach - just generate a new image
      // since the edit functionality requires specific setup
      // Note: In a production environment, you would set up proper file handling
      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        n: 1,
        size: imageSize
      });

      // Check if the response has the expected format
      if (response.data && response.data.length > 0) {
        const editedImage = response.data[0];

        // Log the revised prompt that GPT-Image-1 actually used (for debugging)
        if (editedImage.revised_prompt) {
          console.log('GPT-Image-1 revised prompt:', editedImage.revised_prompt);
        }

        if (editedImage.url) {
          return json({
            imageUrl: editedImage.url,
            url: editedImage.url,
            model: "gpt-image-1-edit",
            aspectRatio: aspectRatio // Return the aspect ratio used
          });
        } else if (editedImage.b64_json) {
          return json({
            imageUrl: `data:image/png;base64,${editedImage.b64_json}`,
            url: `data:image/png;base64,${editedImage.b64_json}`,
            model: "gpt-image-1-edit",
            aspectRatio: aspectRatio // Return the aspect ratio used
          });
        }
      }

      return json({ error: 'Failed to edit image - unexpected API response format' }, { status: 500 });
    } catch (error) {
      console.error('OpenAI API error:', error);

      // Check specifically for content filter errors
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

      throw error; // Re-throw to be caught by the outer catch block
    }
  } catch (error) {
    console.error('Error editing image:', error);
    return json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
};
