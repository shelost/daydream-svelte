import type { RequestHandler } from './$types';
import OpenAI from 'openai';

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

// Extended interfaces for the new streaming events (since they're not in OpenAI types yet)
interface PartialImageEvent {
    type: "response.image_generation_call.partial_image";
    partial_image_index: number;
    partial_image_b64: string;
}

interface ImageGeneratedEvent {
    type: "response.image_generation_call.image_generated";
    image_url: string;
}

interface FunctionCallCompletedEvent {
    type: "response.function_call_completed";
}

interface StreamErrorEvent {
    type: "error";
    error?: string;
}

type ExtendedStreamEvent = PartialImageEvent | ImageGeneratedEvent | FunctionCallCompletedEvent | StreamErrorEvent;

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Streaming image edit API called');
    const requestData = await event.request.json();
    let {
      drawingContent,
      imageData,
      aspectRatio,
      prompt: clientPrompt,
      additionalContext
    } = requestData;

    // Add debugging for received image data
    console.log('Received request data:', {
      hasImageData: !!imageData,
      imageDataType: typeof imageData,
      imageDataLength: imageData ? imageData.length : 0,
      imageDataPrefix: imageData ? imageData.substring(0, 50) + '...' : 'null',
      aspectRatio,
      hasPrompt: !!clientPrompt,
      hasDrawingContent: !!drawingContent
    });

    if (!imageData) {
        // Return error as JSON for non-streaming errors
        return new Response(JSON.stringify({ error: 'Image data or URL is required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (typeof imageData === 'string' && (imageData.startsWith('http://') || imageData.startsWith('https://'))) {
        console.log(`imageData is a URL: ${imageData}. Attempting to fetch and convert.`);
        const conversionResult = await convertUrlToDataUrl(imageData);
        if (!conversionResult || !conversionResult.dataUrl) {
            return new Response(JSON.stringify({ error: 'Failed to fetch or convert image from URL. Ensure the URL points to a supported image format (JPEG, PNG, GIF, WEBP) and is publicly accessible.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
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
      return new Response(JSON.stringify({ error: 'Invalid image data format. Ensure it is a valid data URL (e.g., data:image/png;base64,...) or a fetchable image URL.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
      });
    }

    const imageType = matches[1];
    const base64Data = matches[2];

    // @ts-ignore
    const { OPENAI_API_KEY } = await import('$env/static/private');

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'OpenAI API key is not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
      });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    if (!clientPrompt || typeof clientPrompt !== 'string' || clientPrompt.trim() === '') {
      return new Response(JSON.stringify({ error: 'Prompt is required and must be a non-empty string.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
      });
    }

    // Combine prompt with additional context if provided
    let finalPrompt = clientPrompt;
    if (additionalContext && additionalContext.trim()) {
        finalPrompt = `${clientPrompt}\n\nAdditional context: ${additionalContext}`;
    }

    // Add image context to the prompt
    finalPrompt = `Based on the provided sketch image: ${finalPrompt}`;

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
    console.log('Using image size for streaming generation:', imageSizeTyped);

    // Create a readable stream for Server-Sent Events
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Starting streaming image generation with Responses API');

          // Send initial status
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'status',
            message: 'Starting image generation...'
          })}\n\n`));

          // Construct proper message format for Responses API with image content
          const inputMessages = [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: finalPrompt
                },
                {
                  type: "input_image",
                  image_url: imageData  // Use the data URL directly
                }
              ]
            }
          ];

          console.log('Sending request to OpenAI Responses API with proper image message format');

          // @ts-ignore - Bypass all typing for the new streaming API
          const responseStream = await (openai as any).responses.create({
            model: "gpt-4.1",
            input: inputMessages,
            stream: true,
            tools: [{
              type: "image_generation",
              partial_images: 3,  // Generate 3 progressive refinements
              size: imageSizeTyped  // Specify the image size
            }],
          });

          let imageIndex = 0;
          let finalImageUrl = null;

          // @ts-ignore - Bypass typing for the streaming events
          for await (const event of responseStream) {
            console.log('Received streaming event:', event.type);

            // @ts-ignore - Type assertion for partial image events
            if (event.type === "response.image_generation_call.partial_image") {
              const idx = event.partial_image_index;
              const imageBase64 = event.partial_image_b64;

              console.log(`Received partial image ${idx}`);

              // Send the progressive image to the client
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'partial_image',
                imageIndex: idx,
                imageData: `data:image/png;base64,${imageBase64}`,
                isPartial: true
              })}\n\n`));

              imageIndex = idx;
            // @ts-ignore - Type assertion for final image events
            } else if (event.type === "response.image_generation_call.image_generated") {
              // Final image generated
              const imageUrl = event.image_url;
              finalImageUrl = imageUrl;

              console.log('Final image generated:', imageUrl);

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'final_image',
                imageUrl: imageUrl,
                imageData: imageUrl,
                isPartial: false,
                aspectRatio: aspectRatio,
                model: 'gpt-4.1'
              })}\n\n`));
            // @ts-ignore - Type assertion for completion events
            } else if (event.type === "response.function_call_completed") {
              // Generation completed
              console.log('Image generation completed');

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'completed',
                finalImageUrl: finalImageUrl,
                aspectRatio: aspectRatio,
                model: 'gpt-4.1'
              })}\n\n`));
            // @ts-ignore - Type assertion for error events
            } else if (event.type === "error") {
              console.error('Error in streaming response:', event);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                error: event.error || 'Unknown streaming error'
              })}\n\n`));
            }
          }

          // Send completion signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'done'
          })}\n\n`));

          controller.close();
        } catch (error: any) {
          console.error(`OpenAI Responses API error during streaming: ${error.message}`);
          if (error.stack) console.error(error.stack);

          const encoder = new TextEncoder();
          let errorMessage = 'Error generating image with OpenAI Responses API';

          if (error.response) {
            const errorData = error.response.data;
            console.error(`OpenAI Error Response Status: ${error.response.status}`);
            console.error('OpenAI Error Response Data:', errorData);

            if (errorData && typeof errorData === 'object' && errorData.error && typeof errorData.error.message === 'string') {
                errorMessage = errorData.error.message;
            } else if (typeof errorData === 'string' && errorData.length < 2000) {
                errorMessage = errorData;
            }
          } else if (error.message) {
             errorMessage = error.message;
          }

          if (error.code === 'content_policy_violation' || (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('content policy'))) {
              errorMessage = "Your image or prompt was rejected by OpenAI's content policy.";
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: errorMessage
          })}\n\n`));

          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      }
    });
  } catch (error: any) {
    console.error(`Error in /api/ai/edit-image endpoint: ${error.message}`);
    if (error.stack) console.error(error.stack);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });
  }
};
