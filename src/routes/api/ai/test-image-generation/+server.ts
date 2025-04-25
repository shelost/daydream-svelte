import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';

/**
 * Test endpoint for image generation to verify our OpenAI integration works properly
 */
export const POST: RequestHandler = async (event) => {
  try {
    console.log('Test image generation API called');

    // Check if API key is available
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key is missing');
      return json({
        error: 'OpenAI API key is not configured'
      }, { status: 500 });
    }

    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY
    });

    console.log('Generating test image with GPT-Image-1');

    // Use a simple prompt for testing
    const prompt = "A simple sketch of a house with a sun in the sky";

    try {
      // Use GPT-Image-1 model with minimal parameters
      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        n: 1,
        size: "1024x1024"
      });

      // Log the full response structure
      console.log('API response keys:', Object.keys(response));
      console.log('Data length:', response.data.length);

      if (response.data && response.data.length > 0) {
        const generatedImage = response.data[0];
        console.log('Image data keys:', Object.keys(generatedImage));

        // Return both url and imageUrl properties
        if (generatedImage.url) {
          return json({
            success: true,
            imageUrl: generatedImage.url,
            url: generatedImage.url,
            model: "gpt-image-1",
            responseStructure: {
              dataKeys: Object.keys(response.data[0])
            }
          });
        } else if (generatedImage.b64_json) {
          return json({
            success: true,
            imageUrl: `data:image/png;base64,${generatedImage.b64_json}`,
            url: `data:image/png;base64,${generatedImage.b64_json}`,
            model: "gpt-image-1",
            responseStructure: {
              dataKeys: Object.keys(response.data[0])
            }
          });
        }
      }

      return json({
        error: 'Failed to generate image - unexpected API response format',
        responseStructure: response
      }, { status: 500 });
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in test image generation:', error);
    return json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
};