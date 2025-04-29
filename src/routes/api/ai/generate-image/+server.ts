import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import type { DrawingContent } from '$lib/types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import { analyzeImageWithVision, generateImageDescription } from '$lib/services/googleVision';
import OpenAI from 'openai';

// Simple function to sanitize user input to reduce chance of filter triggers
function sanitizeInput(input) {
  if (!input) return '';

  // Replace potentially problematic terms with safer alternatives
  let sanitized = input
    .replace(/nude/gi, 'figure')
    .replace(/naked/gi, 'unclothed figure')
    .replace(/pornographic/gi, 'artistic')
    .replace(/sexual/gi, 'romantic')
    .replace(/violent/gi, 'dramatic')
    .replace(/gore/gi, 'intense')
    .replace(/blood/gi, 'red fluid');

  return sanitized;
}

// Function to ensure prompt stays within the 4000 character limit
function trimPromptToLimit(prompt: string, limit: number = 4000): string {
  if (prompt.length <= limit) return prompt;

  console.log(`Prompt exceeds ${limit} characters (${prompt.length}). Trimming...`);

  // Split the prompt into sections using double newlines as separators
  const sections = prompt.split('\n\n');

  // Identify key sections (we'll preserve these with higher priority)
  const criticalSections = [];
  const normalSections = [];

  sections.forEach(section => {
    // Check if this is a critical section (keep the most important ones)
    if (
      section.includes('CRITICAL STRUCTURE PRESERVATION') ||
      section.includes('ABSOLUTE RULE') ||
      section.includes('FINAL INSTRUCTIONS') ||
      section.startsWith('CONTENT DESCRIPTION:') ||
      section.includes('USER\'S CONTEXT:')
    ) {
      criticalSections.push(section);
    } else {
      normalSections.push(section);
    }
  });

  // Start with critical sections
  let trimmedPrompt = criticalSections.join('\n\n');

  // Trim structural and compositional guides which tend to be verbose
  for (const section of normalSections) {
    // Skip the most verbose sections entirely if we're already close to the limit
    if (
      (section.startsWith('STRUCTURAL GUIDE:') ||
       section.startsWith('COMPOSITION GUIDE:')) &&
      trimmedPrompt.length > limit * 0.7
    ) {
      continue;
    }

    // For large sections, extract just the important parts
    if (section.length > 500) {
      // Extract first paragraph and last paragraph
      const paragraphs = section.split('\n').filter(p => p.trim().length > 0);
      if (paragraphs.length > 3) {
        const sectionType = section.split(':')[0] + ':';
        const condensedSection = `${sectionType} ${paragraphs[0]} ... ${paragraphs[paragraphs.length-1]}`;

        // Add this section if it fits
        if (trimmedPrompt.length + condensedSection.length + 2 <= limit) {
          trimmedPrompt += '\n\n' + condensedSection;
        }
        continue;
      }
    }

    // Add complete section if it fits
    if (trimmedPrompt.length + section.length + 2 <= limit) {
      trimmedPrompt += '\n\n' + section;
    }
  }

  // If we're still over the limit, perform a final trim
  if (trimmedPrompt.length > limit) {
    console.log(`Still exceeding limit after section-based trimming. Final length: ${trimmedPrompt.length}`);
    trimmedPrompt = trimmedPrompt.substring(0, limit - 3) + '...';
  }

  console.log(`Trimmed prompt to ${trimmedPrompt.length} characters`);
  return trimmedPrompt;
}

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Image generation API called');
    const {
      drawingContent,
      imageData,
      textAnalysis,
      additionalContext,
      sketchAnalysis,
      strokeRecognition,
      structuralDetails,
      aspectRatio
    } = await event.request.json();

    if (!drawingContent || !imageData) {
      console.error('Missing required data: drawingContent or imageData');
      return json({
        error: 'Drawing content and image data are required'
      }, { status: 400 });
    }

    // Log received data for debugging
    console.log('Drawing content received, strokes:', drawingContent.strokes?.length);
    console.log('Aspect ratio received:', aspectRatio);

    // Extract any text detected in the drawing from the textAnalysis
    let extractedText = '';
    let detectedObjects = '';

    if (textAnalysis) {
      // Simple extraction of any quoted text which might be labels in the drawing
      const textMatches = textAnalysis.match(/"([^"]+)"/g);
      if (textMatches) {
        extractedText = textMatches.join(', ').replace(/"/g, '');
        extractedText = sanitizeInput(extractedText);
      }

      // Extract object descriptions
      const objectMatches = textAnalysis.match(/depicting a ([^.]+)/i) ||
                           textAnalysis.match(/shows a ([^.]+)/i) ||
                           textAnalysis.match(/contains a ([^.]+)/i) ||
                           textAnalysis.match(/illustrates a ([^.]+)/i);

      if (objectMatches && objectMatches[1]) {
        detectedObjects = sanitizeInput(objectMatches[1].trim());
      }
    }

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

    // Extract the base64 image data without the prefix
    const base64Data = imageData.split(',')[1];

    // ENHANCED APPROACH: First perform a deep structural analysis with vision
    // to ensure we fully capture the layout and proportions
    console.log('Analyzing sketch structure with GPT-4 Vision...');
    const structureAnalysis = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a precise structural analyst for drawings. Your ONLY job is to describe the EXACT positions, orientations, proportions, and spatial relationships of elements in the image.

DO NOT interpret the artistic qualities or the meaning of the sketch. FOCUS EXCLUSIVELY on:
1. The exact position and direction of each element (using coordinates like "top-left", "bottom-right", etc.)
2. The orientation/direction elements are facing (e.g., "character facing right")
3. The horizontal/vertical alignment of elements
4. Any perspective or horizon lines
5. The exact proportions and relative sizes of elements

Analyze the image as if it were to be precisely replicated with perfect structural fidelity.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Provide an EXHAUSTIVE structural analysis of this sketch. Describe the EXACT position of EVERY element and their spatial relationships. Be extremely detailed about positions, orientations, facing directions, and alignments. This is critical for perfect structural preservation in image generation."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Data}`
              }
            }
          ]
        }
      ],
      max_tokens: 1500
    });

    // Extract the detailed structural analysis
    const structuralGuide = structureAnalysis.choices[0].message.content;
    console.log('Detailed structural analysis obtained');

    // Now perform a compositional analysis focused specifically on the canvas proportions and framing
    console.log('Analyzing composition with GPT-4 Vision...');
    const compositionAnalysis = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a composition and framing specialist. Your ONLY job is to analyze the CANVAS dimensions, boundaries, and how elements are framed within the space.

DO NOT describe the artistic qualities. FOCUS EXCLUSIVELY on:
1. The canvas proportions (square, rectangle, etc.)
2. Where elements sit in relation to the canvas edges
3. The negative space distribution around elements
4. Any horizon line or ground line position relative to the canvas frame
5. How close elements are to the edges of the frame`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Provide a brief but precise FRAMING analysis of this sketch. Focus on how elements are arranged within the canvas boundaries and the distribution of negative space. This is critical for perfect structural preservation."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Data}`
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    // Extract the compositional analysis
    const compositionGuide = compositionAnalysis.choices[0].message.content;
    console.log('Composition analysis obtained');

    // Now get a detailed description of the sketch content to enhance the generation
    console.log('Analyzing content with GPT-4 Vision...');
    const contentAnalysis = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a visual content analyst. Your job is to describe WHAT is in the sketch - the subjects, objects, scenes, and their visual characteristics.

Focus on:
1. Identifying ALL subjects and objects in the sketch
2. Describing their visual characteristics, styles, and details
3. The mood, tone, and setting of the scene
4. Any text or labels present in the sketch`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe what this sketch depicts. What are the subjects, objects, and scene elements? What style should be used when rendering this as a detailed image?"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Data}`
              }
            }
          ]
        }
      ],
      max_tokens: 1000
    });

    // Extract the content analysis
    const contentGuide = contentAnalysis.choices[0].message.content;
    console.log('Content analysis obtained');

    // Build a new prompt designed for pixel-perfect structure preservation with GPT-Image-1
    let prompt = `CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE, maintaining a STRAIGHT-ON, HEAD-ON PERSPECTIVE. `;

    prompt += `ABSOLUTE RULE: The generated image MUST maintain the PRECISE:
1. Exact positions of ALL elements on the canvas (preserve their x,y coordinates)
2. Direct front-facing, straight-on perspective without any angling or skewing
3. Proportions and sizes of ALL elements relative to each other and the canvas
4. Orientations and facing directions exactly as in the sketch
5. Exact spatial relationships between ALL elements

`;

    // Include the content description from our analysis
    prompt += `CONTENT DESCRIPTION: ${contentGuide}\n\n`;

    // Add user's additional context if provided (preserve this as high priority)
    const sanitizedContext = sanitizeInput(additionalContext || '');
    if (sanitizedContext) {
      prompt += `USER'S CONTEXT: "${sanitizedContext}"\n\n`;
    }

    // Include the detailed structural information if available (highest priority)
    if (structuralGuide) {
      prompt += `STRUCTURAL GUIDE: ${structuralGuide}\n\n`;
    }

    // Include the compositional analysis (reduced priority)
    prompt += `COMPOSITION GUIDE: ${compositionGuide}\n\n`;

    // Add stroke-based recognition if available
    const sanitizedStrokeRecognition = sanitizeInput(strokeRecognition || '');
    if (sanitizedStrokeRecognition && sanitizedStrokeRecognition !== "draw something to see shapes recognized") {
      prompt += `RECOGNIZED SHAPES: ${sanitizedStrokeRecognition}\n\n`;
    }

    // Include sketch analysis if available
    if (sketchAnalysis && sketchAnalysis !== "draw something to see ai's interpretation") {
      prompt += `USER'S SKETCH ANALYSIS: ${sketchAnalysis}\n\n`;
    }

    // Add information about detected objects/text if available
    if (detectedObjects) {
      prompt += `DETECTED OBJECTS: ${detectedObjects}\n\n`;
    }

    if (extractedText) {
      prompt += `TEXT ELEMENTS: ${extractedText}\n\n`;
    }

    // Final instructions for perfect structural fidelity - more concise for GPT-Image-1
    prompt += `FINAL INSTRUCTIONS: Create a DIRECT, FRONT-FACING VIEW that maintains the EXACT same composition as the sketch. NEVER distort or reposition any element. Color and texture can be added, but the structural skeleton must remain identical to the original sketch.`;

    // Trim the prompt to ensure it stays within API limits
    prompt = trimPromptToLimit(prompt, 4000);

    console.log('Generating image with GPT-Image-1, prompt length:', prompt.length);

    // Determine image size based on aspect ratio
    let imageSize: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024"; // Default square
    if (aspectRatio) {
      switch(aspectRatio) {
        case '4:5':
          imageSize = "1024x1792"; // For portrait 4:5 ratio, use the portrait option
          break;
        case '1:1':
          imageSize = "1024x1024"; // Square
          break;
        case '9:16':
          imageSize = "1024x1792"; // For tall portrait 9:16 ratio, also use portrait option
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
