import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';
import { File } from 'undici';

// Helper function to fetch an image URL and convert it to a base64 data URL
async function convertUrlToDataUrl(imageUrl: string): Promise<{ dataUrl: string, imageType: string } | null> {
    try {
        console.log(`Fetching image from URL: ${imageUrl}`);
        const response = await fetch(imageUrl);
        if (!response.ok) {
            console.error(`Failed to fetch image from URL: ${imageUrl}, status: ${response.status} ${response.statusText}`);
            return null;
        }

        let imageType = response.headers.get('content-type');
        const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        if (!imageType || !supportedTypes.includes(imageType.toLowerCase().split(';')[0].trim())) {
            console.warn(`Content-Type '${imageType}' from URL ${imageUrl} is not a supported image type or missing. Attempting to guess from extension.`);
            const extension = imageUrl.split(/[#?]/)[0].split('.').pop()?.toLowerCase();
            let guessedType = null;
            if (extension === 'jpg' || extension === 'jpeg') guessedType = 'image/jpeg';
            else if (extension === 'png') guessedType = 'image/png';
            else if (extension === 'gif') guessedType = 'image/gif';
            else if (extension === 'webp') guessedType = 'image/webp';

            if (guessedType && supportedTypes.includes(guessedType)) {
                imageType = guessedType;
                console.log(`Guessed image type as ${imageType} for URL ${imageUrl}`);
            } else {
                console.error(`Could not determine a supported image type for URL ${imageUrl}. Original Content-Type: '${response.headers.get('content-type')}', Extension: '${extension}'.`);
                return null;
            }
        }
        imageType = imageType.split(';')[0].trim();

        const imageBuffer = await response.arrayBuffer();
        const base64Data = Buffer.from(imageBuffer).toString('base64');

        const dataUrl = `data:${imageType};base64,${base64Data}`;
        console.log(`Successfully converted ${imageUrl} to data URL (type: ${imageType}). Length: ${dataUrl.length}`);
        return { dataUrl, imageType };
    } catch (error: any) {
        console.error(`Error fetching or converting image from URL ${imageUrl}: ${error.message}`);
        if (error.stack) console.error(error.stack);
        return null;
    }
}

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Image edit API called');
    const requestData = await event.request.json();
    let {
      drawingContent,
      imageData,
      aspectRatio,
      prompt: clientPrompt
    } = requestData;

    if (!imageData) {
        return json({ error: 'Image data or URL is required.' }, { status: 400 });
    }

    if (typeof imageData === 'string' && (imageData.startsWith('http://') || imageData.startsWith('https://'))) {
        console.log(`imageData is a URL: ${imageData}. Attempting to fetch and convert.`);
        const conversionResult = await convertUrlToDataUrl(imageData);
        if (!conversionResult || !conversionResult.dataUrl) {
            return json({ error: 'Failed to fetch or convert image from URL. Ensure the URL points to a supported image format (JPEG, PNG, GIF, WEBP) and is publicly accessible.' }, { status: 400 });
        }
        imageData = conversionResult.dataUrl;
    }

    if (!drawingContent) {
      console.warn('drawingContent is missing or empty, proceeding with image edit based on prompt and imageData.');
      drawingContent = {};
    }

    const matches = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      console.error('Invalid image data format. Expected data URL (e.g., data:image/png;base64,...). Received (first 100 chars):', typeof imageData === 'string' ? imageData.substring(0,100) + "..." : "Not a string");
      return json({ error: 'Invalid image data format. Ensure it is a valid data URL (e.g., data:image/png;base64,...) or a fetchable image URL.' }, { status: 400 });
    }

    const imageType = matches[1];
    const base64Data = matches[2];
    const imgBuffer = Buffer.from(base64Data, 'base64');

    // @ts-ignore
    const { OPENAI_API_KEY } = await import('$env/static/private');

    if (!OPENAI_API_KEY) {
      return json({ error: 'OpenAI API key is not configured' }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    if (!clientPrompt || typeof clientPrompt !== 'string' || clientPrompt.trim() === '') {
      return json({ error: 'Prompt is required and must be a non-empty string.' }, { status: 400 });
    }

    let imageSizeTyped: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024";
    if (aspectRatio) {
      if (aspectRatio === 'portrait' || aspectRatio === '9:16' || aspectRatio === '1024x1792') {
          imageSizeTyped = '1024x1792';
      } else if (aspectRatio === 'landscape' || aspectRatio === '16:9' || aspectRatio === '1792x1024') {
          imageSizeTyped = '1792x1024';
      } else if (aspectRatio === '1:1' || aspectRatio === 'square' || aspectRatio === '1024x1024') {
          imageSizeTyped = '1024x1024';
      }
    }
    console.log('Using image size for OpenAI edit:', imageSizeTyped);

    try {
      const extension = imageType.split('/')[1];
      const file = new File([imgBuffer], `image.${extension || 'png'}`, { type: imageType });

      // @ts-ignore - Bypassing strict type check for size, as gpt-image-1 may support non-square sizes for edit per cookbook.
      const response = await openai.images.edit({
        model: 'gpt-image-1',
        prompt: clientPrompt,
        image: file,
        n: 1,
        size: imageSizeTyped as any // Cast to any to satisfy linter for model-specific sizes
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
            model: "gpt-image-1",
            revised_prompt: editedImage.revised_prompt,
            aspectRatio: aspectRatio
          });
        }
        else if (editedImage.b64_json) {
           console.warn('Received b64_json from gpt-image-1 edit, which is unexpected. Using it.');
           const dataUrl = `data:image/png;base64,${editedImage.b64_json}`;
           return json({
            imageUrl: dataUrl,
            url: dataUrl,
            model: "gpt-image-1",
            revised_prompt: editedImage.revised_prompt,
            aspectRatio: aspectRatio
          });
        }
      }
      console.error('Failed to edit image - unexpected API response format from OpenAI.');
      if(response?.data) {
        console.error('OpenAI unexpected response data (first item if array):', Array.isArray(response.data) ? response.data[0] : response.data);
      } else {
        console.error('OpenAI response data was missing or empty.');
      }
      return json({ error: 'Failed to edit image - unexpected API response format' }, { status: 500 });
    } catch (error: any) {
      console.error(`OpenAI API error during image edit: ${error.message}`);
      if (error.stack) console.error(error.stack);

      let errorMessage = 'Error editing image with OpenAI';
      let errorStatus = 500;
      let errorDetails = error.message;

      if (error.response) {
        const errorData = error.response.data;
        errorStatus = error.response.status || errorStatus;
        console.error(`OpenAI Error Response Status: ${errorStatus}`);
        console.error('OpenAI Error Response Data:', errorData);

        if (errorData && typeof errorData === 'object' && errorData.error && typeof errorData.error.message === 'string') {
            errorMessage = errorData.error.message;
            errorDetails = errorData.error.message;
        } else if (typeof errorData === 'string' && errorData.length < 2000) {
            errorMessage = errorData;
            errorDetails = errorData;
        }
      } else if (error.message) {
         errorMessage = error.message;
      }

      if (error.code === 'content_policy_violation' || (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('content policy'))) {
          errorMessage = "Your image or prompt was rejected by OpenAI's content policy.";
          errorStatus = 400;
          errorDetails = errorMessage;
      }
      return json({ error: errorMessage, details: errorDetails }, { status: errorStatus });
    }
  } catch (error: any) {
    console.error(`Error in /api/ai/edit-image endpoint: ${error.message}`);
    if (error.stack) console.error(error.stack);
    return json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
};
