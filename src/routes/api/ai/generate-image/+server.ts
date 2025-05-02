import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { DrawingContent } from '$lib/types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import { analyzeImageWithVision, generateImageDescription } from '$lib/services/googleVision';
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
    console.log('Image generation API called');
    const requestData = await event.request.json();
    const {
      drawingContent,
      imageData,
      additionalContext,
      aspectRatio,
      sketchAnalysis,
      strokeRecognition,
      prompt: clientPrompt,
      structureData,
      detectedObjects: clientEnhancedObjects
    } = requestData;

    if (!drawingContent || !imageData) {
      return json({ error: 'Drawing content and image data are required' }, { status: 400 });
    }

    // Convert base64 data URL to base64 string
    const base64Data = imageData.split(',')[1];
    if (!base64Data) {
      return json({ error: 'Invalid image data format' }, { status: 400 });
    }

    // Convert SVG strokes to paths for compatibility - fixed parameter passing
    const svgResult = svgFromStrokes(
      drawingContent.strokes,
      drawingContent.bounds ? drawingContent.bounds.width : 800,
      drawingContent.bounds ? drawingContent.bounds.height : 600,
      '#ffffff'
    );

    // Get OpenAI API Key using dynamic import to avoid TypeScript errors
    const { OPENAI_API_KEY } = await import('$env/static/private');

    // Check if API key is available
    if (!OPENAI_API_KEY) {
      return json({ error: 'OpenAI API key is not configured' }, { status: 500 });
    }

    // Create OpenAI instance
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // First, use GPT-4o to analyze the content of the drawing for enhanced context
    console.log('Analyzing drawing content...');

    // Prepare compositional information based on aspect ratio
    let compositionGuide = 'Focus on the direct, front-facing view.';
    if (aspectRatio) {
      if (aspectRatio === '4:5') {
        compositionGuide = 'Maintain the portrait (4:5) composition with slightly more vertical space.';
      } else if (aspectRatio === '1:1') {
        compositionGuide = 'Maintain the perfect square (1:1) composition with equal horizontal and vertical space.';
      } else if (aspectRatio === '9:16') {
        compositionGuide = 'Maintain the tall portrait (9:16) composition with significantly more vertical space.';
      }
    }

    // Extract structural information from the request if available
    const structuralGuide = drawingContent?.strokes?.length
      ? `The drawing consists of ${drawingContent.strokes.length} strokes forming a coherent sketch. Preserve the exact structure.`
      : '';

    // Process text extraction and object detection from client data
    let extractedText = '';
    let detectedObjects = '';

    // Use the client-provided prompt if available, otherwise build one
    let prompt;
    if (clientPrompt) {
      console.log('Using client-provided prompt');
      prompt = clientPrompt;
    } else {
      console.log('Building server-side prompt (fallback)');

      // Build a new prompt that focuses on structure preservation
      prompt = `ENHANCEMENT MODE: You are ENHANCING a sketch, NOT CREATING a new image. You must follow the EXACT PIXEL-BY-PIXEL layout of the original sketch.

CRITICAL STRUCTURE PRESERVATION: Treat this sketch as an EXACT STRUCTURAL TEMPLATE where each element MUST remain in its PRECISE position.

ABSOLUTE RULES:
1. PIXEL-PERFECT POSITIONING: Every element MUST stay in the EXACT same x,y coordinates as the original sketch
2. PRESERVE ALL PROPORTIONS: Elements must maintain the EXACT same size relationships
3. DIRECT FRONT-FACING VIEW: Maintain the straight-on view with NO perspective changes
4. MATCH ORIGINAL SCALE: Keep elements at the EXACT same scale - do NOT make them larger or smaller relative to the canvas
5. USE SKETCH AS OVERLAY: Imagine your task is to add color and texture to the original sketch, NOT create a new composition

`;

      // Include sketch analysis if available (as content description)
      if (sketchAnalysis && sketchAnalysis !== "draw something to see ai's interpretation") {
        prompt += `CONTENT DESCRIPTION: ${sketchAnalysis}\n\n`;
      } else {
        prompt += `CONTENT DESCRIPTION: A user's sketch that should be enhanced while preserving exact structure.\n\n`;
      }

      // Include structural guide if available
      if (structuralGuide) {
        prompt += `STRUCTURAL GUIDE: ${structuralGuide}\n\n`;
      }

    // Add user's additional context if provided (preserve this as high priority)
    const sanitizedContext = sanitizeInput(additionalContext || '');
    if (sanitizedContext) {
      prompt += `USER'S CONTEXT: "${sanitizedContext}"\n\n`;
    }

    // Include the compositional analysis (reduced priority)
    prompt += `COMPOSITION GUIDE: ${compositionGuide}\n\n`;

    // Add stroke-based recognition if available
    const sanitizedStrokeRecognition = sanitizeInput(strokeRecognition || '');
    if (sanitizedStrokeRecognition && sanitizedStrokeRecognition !== "draw something to see shapes recognized") {
      prompt += `RECOGNIZED SHAPES: ${sanitizedStrokeRecognition}\n\n`;
    }

      // Process detected objects if available
      if (clientEnhancedObjects && Array.isArray(clientEnhancedObjects) && clientEnhancedObjects.length > 0) {
        console.log(`Processing ${clientEnhancedObjects.length} enhanced objects for structural guidance`);

        // Format the objects with precise coordinates
        const objectsDetails = clientEnhancedObjects.map((obj, index) => {
          const label = obj.label || obj.name || `Object ${index + 1}`;
          const x = Math.round((obj.x || 0) * 100);
          const y = Math.round((obj.y || 0) * 100);
          const width = Math.round((obj.width || 0) * 100);
          const height = Math.round((obj.height || 0) * 100);
          const centerX = obj.centerX ? Math.round(obj.centerX * 100) : Math.round((x + width/2) * 100);
          const centerY = obj.centerY ? Math.round(obj.centerY * 100) : Math.round((y + height/2) * 100);

          return `Object ${index + 1}: "${label}" - CENTER(${centerX}%, ${centerY}%), SIZE(${width}%, ${height}%)`;
        }).join('\n');

        // Add the formatted objects to the prompt
        detectedObjects = objectsDetails;
      }

      // Add detected objects to the prompt if available
    if (detectedObjects) {
        prompt += `DETECTED OBJECTS WITH PRECISE COORDINATES:\n${detectedObjects}\n\n`;
    }

    if (extractedText) {
      prompt += `TEXT ELEMENTS: ${extractedText}\n\n`;
    }

      // Final instructions for perfect structural fidelity
      prompt += `FINAL INSTRUCTIONS: PRESERVE EXACT STRUCTURE. This is an ENHANCEMENT task - maintain the precise positions, sizes, and proportions of ALL elements in the original sketch. Add color and texture but DO NOT reposition or resize ANY elements from the sketch. The final image should look like a direct enhancement of the sketch, with the same spatial layout down to the pixel level.`;
    }

    // Trim the prompt to ensure it stays within API limits
    prompt = trimPromptToLimit(prompt, 4000);

    console.log('Generating image with GPT-Image-1, prompt length:', prompt.length);

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
      // Use GPT-Image-1 model with only supported parameters
      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        n: 1,
        size: imageSize
      });

      // Check if the response has the expected format
      if (response.data && response.data.length > 0) {
        const generatedImage = response.data[0];

        // Log the revised prompt that GPT-Image-1 actually used (for debugging)
        if (generatedImage.revised_prompt) {
          console.log('GPT-Image-1 revised prompt:', generatedImage.revised_prompt);
        }

        if (generatedImage.url) {
          return json({
            imageUrl: generatedImage.url,
            url: generatedImage.url,
            model: "gpt-image-1",
            aspectRatio: aspectRatio // Return the aspect ratio used
          });
        } else if (generatedImage.b64_json) {
          return json({
            imageUrl: `data:image/png;base64,${generatedImage.b64_json}`,
            url: `data:image/png;base64,${generatedImage.b64_json}`,
            model: "gpt-image-1",
            aspectRatio: aspectRatio // Return the aspect ratio used
          });
        }
      }

      return json({ error: 'Failed to generate image - unexpected API response format' }, { status: 500 });
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
    console.error('Error generating image:', error);
    return json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
};
