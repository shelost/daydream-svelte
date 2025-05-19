import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';

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
      detectedObjects: clientEnhancedObjects
    } = requestData;

    // @ts-ignore
    const { OPENAI_API_KEY } = await import('$env/static/private');
    if (!OPENAI_API_KEY) {
      return json({ error: 'OpenAI API key is not configured' }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let finalPrompt: string;
    let operationType: 'sketch-to-image' | 'text-to-image';

    if (drawingContent && imageData) {
      operationType = 'sketch-to-image';
      console.log('Processing sketch-to-image request for /generate-image');

      // For sketch-to-image, the /draw page sends a very specific, structured prompt as clientPrompt.
      // We should prioritize that.
      if (clientPrompt && typeof clientPrompt === 'string' && clientPrompt.trim() !== '') {
        console.log('Using client-provided prompt for sketch enhancement.');
        finalPrompt = clientPrompt;
      } else {
        // Fallback: Build a server-side prompt for sketch enhancement if clientPrompt is missing/empty.
        // This is less likely for the /draw page usage but provides a safeguard.
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
            // Ensure obj.x, obj.y, obj.width, obj.height are fractions (0-1) before multiplying by 100
            const xPercent = Math.round((obj.x || 0) * 100);
            const yPercent = Math.round((obj.y || 0) * 100);
            const wPercent = Math.round((obj.width || 0) * 100);
            const hPercent = Math.round((obj.height || 0) * 100);
            // centerX/Y should also be derived from fractional values if not directly provided as such
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
      return json({ error: 'Invalid request: Missing required fields for sketch or text mode.' }, { status: 400 });
    }

    finalPrompt = trimPromptToLimit(finalPrompt, 4000);
    console.log(`Final prompt for OpenAI (${operationType}, length: ${finalPrompt.length}): ${finalPrompt.substring(0, 200)}...`);

    let imageSize: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024";
    let finalAspectRatioString = aspectRatio || '1:1';

    // Map descriptive aspect ratios to DALL-E 3 sizes
    if (aspectRatio === 'portrait') finalAspectRatioString = "1024x1792";
    else if (aspectRatio === 'landscape') finalAspectRatioString = "1792x1024";
    else if (aspectRatio === '1:1') finalAspectRatioString = "1024x1024";
    // If specific DALL-E 3 sizes are passed, use them directly
    else if (aspectRatio === "1024x1792" || aspectRatio === "1792x1024" || aspectRatio === "1024x1024") finalAspectRatioString = aspectRatio;
    // Default for any other string
    else finalAspectRatioString = "1024x1024";

    imageSize = finalAspectRatioString as "1024x1024" | "1792x1024" | "1024x1792";

    console.log(`Requesting image size from OpenAI: ${imageSize}`);

    try {
      const generationPayload: OpenAI.Images.ImageGenerateParams = {
        model: "dall-e-3",
        prompt: finalPrompt,
        n: 1,
        size: imageSize,
        quality: "standard",
      };

      const response = await openai.images.generate(generationPayload);

      // Enhanced logging for OpenAI response data
      if (response && response.data && response.data.length > 0) {
        console.log('OpenAI response.data[0]:', JSON.stringify(response.data[0], null, 2));
      } else {
        console.log('OpenAI response or response.data is empty or not as expected:', JSON.stringify(response, null, 2));
      }

      const imageUrl = response.data[0]?.url;
      const revisedPrompt = response.data[0]?.revised_prompt;

      if (!imageUrl) {
        return json({ error: 'Failed to generate image, no URL returned by OpenAI' }, { status: 500 });
      }

      console.log('Image generated successfully by OpenAI:', imageUrl);
      return json({
        imageUrl: imageUrl,
        url: imageUrl,
        model: 'dall-e-3', // Consistent model name
        prompt: originalPrompt || clientPrompt, // Return the original user prompt if available
        modified_prompt: clientPrompt !== originalPrompt ? clientPrompt : undefined, // Return the modified prompt if it was changed
        revised_prompt: revisedPrompt,
        aspectRatio: finalAspectRatioString // Return the aspect ratio string that determined the size
      });

    } catch (error: any) {
      console.error('OpenAI API error:', error);
      let errorMessage = 'Error generating image with OpenAI';
      let errorStatus = 500;
      if (error.response) {
        console.error('OpenAI Error Data:', error.response.data);
        errorMessage = error.response.data?.error?.message || error.message || errorMessage;
        errorStatus = error.response.status || errorStatus;
      } else {
        errorMessage = error.message || errorMessage;
      }
      // Check for content policy violation
      if (error.code === 'content_policy_violation' || (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('content policy'))) {
          errorMessage = "Your prompt was rejected by OpenAI's content policy. Please modify your prompt.";
          errorStatus = 400; // Bad Request due to content policy
      }
      return json({ error: errorMessage }, { status: errorStatus });
    }
  } catch (error: any) {
    console.error('Error in /api/ai/generate-image endpoint:', error);
    return json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
};

// Removed getReplicateDimensions as it's not used in this file
// It will be part of the generate-replicate endpoint.
