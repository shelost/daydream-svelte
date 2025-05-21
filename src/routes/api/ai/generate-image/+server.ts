import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';
import { calculateCost } from '$lib/utils/apiPricing.js';

// Function to sanitize input text
function sanitizeInput(text: any): string {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, '').trim();
}

// Helper function to trim the prompt to a specific character limit
function trimPromptToLimit(prompt: string | undefined, limit = 4000): string {
  if (!prompt) return '';
  if (prompt.length <= limit) return prompt;

  const lastBreakPoint = prompt.lastIndexOf('\n\n', limit - 100);
  if (lastBreakPoint > limit * 0.75) {
    return prompt.substring(0, lastBreakPoint) + '\n\n[Prompt truncated to fit size limits...]';
  }
  return prompt.substring(0, limit - 50) + '\n\n[Prompt truncated to fit size limits...]';
}

export const POST: RequestHandler = async (event) => {
  const startTime = Date.now();

  // Default to gpt-image-1; will be overwritten if the request explicitly specifies another OpenAI image model
  let chosenModel = 'gpt-image-1';

  let apiLogEntry = {
      id: `genimg-${Date.now()}`,
      timestamp: new Date().toISOString(),
      apiProvider: 'OpenAI',
      model: chosenModel,
      endpoint: '/v1/images/generations',
      cost: 0,
      status: 500,
      durationMs: 0,
      error: null as string | null,
  };

  try {
    console.log('OpenAI /generate-image API called');
    const requestData = await event.request.json();
    const {
      drawingContent,
      imageData,
      additionalContext,
      aspectRatio,
      sketchAnalysis,
      strokeRecognition,
      prompt: clientPrompt,
      originalPrompt,
      structureData,
      detectedObjects: clientEnhancedObjects,
      model: clientModel // optional model field provided by client
    } = requestData;

    // Allow client to specify a different OpenAI image model if needed
    if (clientModel && typeof clientModel === 'string' && clientModel.trim() !== '') {
      chosenModel = clientModel.trim();
    }

    apiLogEntry.model = chosenModel;

    // @ts-ignore
    const { OPENAI_API_KEY } = await import('$env/static/private');
    if (!OPENAI_API_KEY) {
      apiLogEntry.error = 'OpenAI API key is not configured';
      apiLogEntry.durationMs = Date.now() - startTime;
      return json({ error: apiLogEntry.error, apiLogEntry }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let finalPrompt: string;
    let operationType: 'sketch-to-image' | 'text-to-image';

    if (drawingContent && imageData) {
      operationType = 'sketch-to-image';
      console.log('Processing sketch-to-image request for /generate-image');

      if (clientPrompt && typeof clientPrompt === 'string' && clientPrompt.trim() !== '') {
        console.log('Using client-provided prompt for sketch enhancement.');
        finalPrompt = clientPrompt;
      } else {
        console.log('Warning: Client prompt for sketch enhancement was empty. Building server-side fallback.');
        let promptBuilder = `ENHANCEMENT MODE: You are ENHANCING a sketch. Follow the EXACT layout of the original sketch.\n\nCRITICAL STRUCTURE PRESERVATION: Treat this sketch as an EXACT STRUCTURAL TEMPLATE.\n\nABSOLUTE RULES:\n1. PIXEL-PERFECT POSITIONING: Elements MUST stay in EXACT x,y coordinates.\n2. PRESERVE PROPORTIONS: Maintain EXACT size relationships.\n3. DIRECT FRONT-FACING VIEW: NO perspective changes.\n4. MATCH SCALE: Keep elements at EXACT same scale.\n5. SKETCH AS OVERLAY: Add color/texture, DO NOT change composition.\n\n`;
        const currentSketchAnalysis = sketchAnalysis || "A user's sketch for enhancement.";
        promptBuilder += `CONTENT DESCRIPTION: ${sanitizeInput(currentSketchAnalysis)}\n\n`;
        if (drawingContent?.strokes?.length) {
          promptBuilder += `STRUCTURAL GUIDE: ${drawingContent.strokes.length} strokes. Preserve structure.\n\n`;
        }
        const sanitizedContext = sanitizeInput(additionalContext);
        if (sanitizedContext) {
          promptBuilder += `USER'S CONTEXT: "${sanitizedContext}"\n\n`;
        }
        let currentAspectRatio = aspectRatio || '1:1';
        let compositionGuide = 'Focus on the direct, front-facing view.';
        if (currentAspectRatio === 'portrait') compositionGuide = 'Maintain portrait (e.g., 1024x1792) composition.';
        else if (currentAspectRatio === 'landscape') compositionGuide = 'Maintain landscape (e.g., 1792x1024) composition.';
        else if (currentAspectRatio === '1:1') compositionGuide = 'Maintain square (1:1) composition.';
        promptBuilder += `COMPOSITION GUIDE: ${compositionGuide}\n\n`;
        const sanitizedStrokeRec = sanitizeInput(strokeRecognition);
        if (sanitizedStrokeRec && sanitizedStrokeRec !== "draw something to see shapes recognized") {
          promptBuilder += `RECOGNIZED SHAPES: ${sanitizedStrokeRec}\n\n`;
        }
        if (clientEnhancedObjects && Array.isArray(clientEnhancedObjects) && clientEnhancedObjects.length > 0) {
          const objectsDetails = clientEnhancedObjects.map((obj: any, index: number) => {
            const label = sanitizeInput(obj.label || obj.name || `Object ${index + 1}`);
            const xPercent = Math.round((obj.x || 0) * 100);
            const yPercent = Math.round((obj.y || 0) * 100);
            const wPercent = Math.round((obj.width || 0) * 100);
            const hPercent = Math.round((obj.height || 0) * 100);
            const cxPercent = obj.centerX ? Math.round(obj.centerX * 100) : Math.round(((obj.x || 0) + (obj.width || 0) / 2) * 100);
            const cyPercent = obj.centerY ? Math.round(obj.centerY * 100) : Math.round(((obj.y || 0) + (obj.height || 0) / 2) * 100);
            return `Object ${index + 1}: "${label}" - CENTER(${cxPercent}%, ${cyPercent}%), SIZE(${wPercent}%, ${hPercent}%)`;
          }).join('\n');
          promptBuilder += `DETECTED OBJECTS:\n${objectsDetails}\n\n`;
        }
        promptBuilder += `FINAL INSTRUCTIONS: PRESERVE EXACT STRUCTURE. Enhance sketch, DO NOT reposition/resize.`;
        finalPrompt = promptBuilder;
      }
    } else if (clientPrompt && typeof clientPrompt === 'string' && clientPrompt.trim() !== '') {
      operationType = 'text-to-image';
      console.log('Processing text-to-image request for /generate-image');
      let textPromptBuilder = sanitizeInput(clientPrompt);
      const sanitizedContext = sanitizeInput(additionalContext);
      if (sanitizedContext) {
        textPromptBuilder += ` Additional details: ${sanitizedContext}`;
      }
      finalPrompt = textPromptBuilder;
    } else {
      apiLogEntry.error = 'Invalid request: Missing required fields for sketch or text mode.';
      apiLogEntry.status = 400;
      apiLogEntry.durationMs = Date.now() - startTime;
      return json({ error: apiLogEntry.error, apiLogEntry }, { status: 400 });
    }

    finalPrompt = trimPromptToLimit(finalPrompt, 4000);
    console.log(`Final prompt (${operationType}, length: ${finalPrompt.length}): ${finalPrompt.substring(0, 200)}...`);

    let imageSize: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024";
    let finalAspectRatioString = aspectRatio || '1:1';

    if (aspectRatio === 'portrait') finalAspectRatioString = "1024x1792";
    else if (aspectRatio === 'landscape') finalAspectRatioString = "1792x1024";
    else if (aspectRatio === '1:1') finalAspectRatioString = "1024x1024";
    else if (aspectRatio === "1024x1792" || aspectRatio === "1792x1024" || aspectRatio === "1024x1024") finalAspectRatioString = aspectRatio;
    else finalAspectRatioString = "1024x1024";

    imageSize = finalAspectRatioString as "1024x1024" | "1792x1024" | "1024x1792";

    console.log(`Requesting image (${imageSize}) from OpenAI model: ${chosenModel}`);

    try {
      const generationPayload: OpenAI.Images.ImageGenerateParams = {
        model: chosenModel as any, // Cast as any until official types include gpt-image-1
        prompt: finalPrompt,
        n: 1,
        size: imageSize,
        quality: 'medium',
      };

      const response = await openai.images.generate(generationPayload);
      apiLogEntry.durationMs = Date.now() - startTime;
      apiLogEntry.status = 200;

      if (response && response.data && response.data.length > 0) {
        console.log('OpenAI response.data[0]:', JSON.stringify(response.data[0], null, 2));
      } else {
        console.log('OpenAI response or response.data is empty or not as expected:', JSON.stringify(response, null, 2));
      }

      // Extract image information in a more robust way
      let imageUrl: string | undefined = undefined;
      const firstItem: any = response.data[0];
      const revisedPrompt = firstItem?.revised_prompt;

      if (firstItem?.url && typeof firstItem.url === 'string') {
        imageUrl = firstItem.url;
      } else if (firstItem?.b64_json && typeof firstItem.b64_json === 'string') {
        // Construct a data URL from base64 JSON string
        imageUrl = `data:image/png;base64,${firstItem.b64_json}`;
      } else if (firstItem?.image && typeof firstItem.image === 'string') {
        // Some experimental formats might return an `image` field containing a data URL or base64
        imageUrl = firstItem.image.startsWith('data:') ? firstItem.image : `data:image/png;base64,${firstItem.image}`;
      }

      if (!imageUrl) {
        apiLogEntry.error = 'Failed to generate image, no usable image data returned by OpenAI';
        apiLogEntry.status = 500;
        return json({ error: apiLogEntry.error, apiLogEntry }, { status: 500 });
      }

      const usageDetails = {
          resolution: imageSize,
          quality: generationPayload.quality,
          count: generationPayload.n || 1
      };
      apiLogEntry.cost = calculateCost('OpenAI', chosenModel, usageDetails);

      console.log('Image generated successfully.');
      return json({
        imageUrl,
        url: imageUrl,
        model: chosenModel,
        prompt: originalPrompt || clientPrompt,
        modified_prompt: clientPrompt !== originalPrompt ? clientPrompt : undefined,
        revised_prompt: revisedPrompt,
        aspectRatio: finalAspectRatioString,
        apiLogEntry,
      });

    } catch (error: any) {
      console.error('OpenAI API error:', error);
      apiLogEntry.durationMs = Date.now() - startTime;
      apiLogEntry.status = error.response?.status || error.status || 500;
      let errorMessage = 'Error generating image with OpenAI';

      if (error.response) {
        console.error('OpenAI Error Data:', error.response.data);
        errorMessage = error.response.data?.error?.message || error.message || errorMessage;
      } else {
        errorMessage = error.message || errorMessage;
      }
      if (error.code === 'content_policy_violation' || (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('content policy'))) {
          errorMessage = "Your prompt was rejected by OpenAI's content policy. Please modify your prompt.";
          apiLogEntry.status = 400;
      }
      apiLogEntry.error = errorMessage;
      return json({ error: errorMessage, apiLogEntry }, { status: apiLogEntry.status });
    }
  } catch (error: any) {
    console.error('Error in /api/ai/generate-image endpoint:', error);
    apiLogEntry.durationMs = Date.now() - startTime;
    apiLogEntry.error = error.message || 'Internal server error';
    apiLogEntry.status = 500;
    return json({ error: apiLogEntry.error, apiLogEntry }, { status: 500 });
  }
};

// Removed getReplicateDimensions as it's not used in this file
// It will be part of the generate-replicate endpoint.
