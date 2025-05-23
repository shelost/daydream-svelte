import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import type { ChatMessage } from '$lib/openai/api';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import { analyzeImageWithVision, generateImageDescription } from '$lib/services/googleVision';

// Define types for OpenAI responses
interface OpenAIResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  created: number;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Define new type for content that can include images
interface ContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

// Extended chat message type
interface ChatMessageWithImage extends Omit<ChatMessage, 'content'> {
  content: string | ContentItem[];
}

// Simplified SVG generation with fewer points
function simplifyStrokes(strokes: any[], simplificationFactor = 5) {
  return strokes.map(stroke => {
    // Skip strokes with very few points
    if (stroke.points.length <= 5) return stroke;

    // Otherwise, reduce the number of points
    const simplifiedPoints = stroke.points.filter((_: any, index: number) =>
      index % simplificationFactor === 0 || index === stroke.points.length - 1
    );

    return {
      ...stroke,
      points: simplifiedPoints
    };
  });
}

export const POST: RequestHandler = async (event) => {
  try {
    const { drawingContent, userPrompt, chatHistory, imageData, useVision = false } = await event.request.json();

    if (!drawingContent || !userPrompt) {
      return json({
        error: 'Drawing content and user prompt are required'
      }, { status: 400 });
    }

    // Prepare messages array
    let messages: ChatMessageWithImage[] = [];

    // System message configuring the AI for our use case
    messages.push({
      role: 'system',
      content: `You are an AI assistant specialized in analyzing and describing drawings.

      When describing a drawing:
      1. Focus primarily on WHAT is depicted in the image - identify people, objects, scenes, characters, etc.
      2. Describe the subject matter in detail (e.g., "a young girl with long hair wearing a tank top" rather than "curved lines forming a shape")
      3. Note the artistic style (sketch, cartoon, realistic, anime-style, etc.)
      4. Mention colors, expressions, poses, and other notable visual elements
      5. Only mention technical aspects of the drawing (like SVG paths, Bezier curves) if specifically asked

      If the user has enabled Vision API analysis, prioritize and trust this information as it represents machine recognition of the image content.

      If the user requests modifications, describe what changes you would make.

      Use <analyze> tags when describing the drawing.
      Use <modify> tags when suggesting modifications to the drawing.

      Respond in a helpful, clear manner focused on what the human would want to know about their drawing.`
    });

    // Add chat history for context (assuming they are text-only for simplicity)
    // Limit to most recent messages if not already limited on client
    const limitedChatHistory = Array.isArray(chatHistory)
      ? chatHistory.slice(-6)  // Only use the 6 most recent messages if too many were sent
      : [];

    if (limitedChatHistory.length > 0) {
      messages = [...messages, ...limitedChatHistory as ChatMessageWithImage[]];
    }

    // Prepare the current user message
    let userContent = `My request: ${userPrompt}`;

    // Variable to store Vision API analysis if used
    let visionAnalysis = null;

    // Check if we should use Google Vision API for image analysis
    if (imageData && imageData.startsWith('data:image/') && useVision) {
      try {
        // Use Google Vision API to analyze the image
        visionAnalysis = await analyzeImageWithVision(imageData);

        // Generate a description from the Vision API analysis
        const imageDescription = generateImageDescription(visionAnalysis);

        // Add the Vision analysis to the user message in a more prominent way
        userContent = `${userContent}\n\nIMPORTANT CONTEXT FROM VISION API ANALYSIS:\n${imageDescription}\n\nThe drawing contains objects identified as: ${visionAnalysis.labels.join(', ')}.`;

        if (visionAnalysis.text) {
          userContent += `\nText detected in the image: "${visionAnalysis.text}"`;
        }

        if (visionAnalysis.faces && visionAnalysis.faces.length > 0) {
          userContent += `\nThere are ${visionAnalysis.faces.length} human faces detected in the image.`;
        }

        // If Vision API encountered an error, include it in the message
        if (visionAnalysis.error) {
          userContent += `\n\nNote: Vision API error: ${visionAnalysis.error}`;
        }
      } catch (visionError) {
        console.error('Error using Vision API:', visionError);
        userContent += '\n\nNote: Failed to analyze image with Vision API.';
      }
    }

    // Check if we have image data to use
    if (imageData && imageData.startsWith('data:image/')) {
      // We have image data from canvas snapshot
      // Use OpenAI's vision capability with the image
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${userContent}\n\nPlease focus on WHAT this drawing depicts - identify the main subject(s), scene, characters, or objects. Describe it as a human would, mentioning style, characteristics, and what makes it recognizable. Don't focus on technical SVG details unless specifically asked.`
          },
          {
            type: 'image_url',
            image_url: {
              url: imageData
            }
          }
        ]
      });
    } else {
      // Fall back to SVG if no image data
      // Use simplified strokes to reduce token count
      const simplifiedDrawingContent = {
        ...drawingContent,
        strokes: simplifyStrokes(drawingContent.strokes, 3) // Simplify by factor of 3
      };

      const { svg, error } = svgFromStrokes(
        simplifiedDrawingContent.strokes,
        drawingContent.bounds?.width || 800,
        drawingContent.bounds?.height || 600
      );

      if (error) {
        return json({
          error: `Error generating SVG: ${error}`
        }, { status: 500 });
      }

      // Add SVG to the user message, but truncate if excessively large
      const maxSvgLength = 20000; // Limit SVG size
      // Make sure svg is defined before using it
      const svgContent = svg || "";
      const truncatedSvg = svgContent.length > maxSvgLength
        ? svgContent.substring(0, maxSvgLength) + '... [SVG truncated due to size]'
        : svgContent;

      userContent = `Here is my drawing in SVG format:\n\n${truncatedSvg}\n\n${userContent}`;
      messages.push({
        role: 'user',
        content: userContent
      });
    }

    // Determine which OpenAI model to use based on if we're using image data
    const model = imageData && imageData.startsWith('data:image/')
      ? 'gpt-4o' // Use vision-capable model for images
      : 'gpt-4o'; // Use text-only model for SVG

    // Make API call to OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2000, // Reduced max_tokens to save on usage
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json();

      // Check for token limit errors specifically
      if (errorData.error?.code === 'context_length_exceeded' ||
          errorData.error?.message?.includes('maximum context length')) {

        // Create a more helpful error message for token limits
        return json({
          error: 'The drawing is too complex for the AI to analyze fully. Try creating a simpler drawing, focusing on a specific part of the drawing, or asking a more specific question.'
        }, { status: 413 }); // 413 Payload Too Large
      }

      return json({
        error: errorData.error?.message || 'Failed to get response from OpenAI'
      }, { status: response.status });
    }

    const data: OpenAIResponse = await response.json();
    const aiResponse = data.choices[0]?.message?.content || 'No response from AI';

    // Extract modification instructions if present
    let modifiedSVG: string | undefined;

    // Check if the response contains SVG code
    const svgMatch = aiResponse.match(/<svg>([\s\S]*?)<\/svg>/);
    if (svgMatch && svgMatch[1]) {
      modifiedSVG = svgMatch[1].trim();
    }

    // Log token usage for debugging
    if (data.usage) {
      console.log(`API usage - Prompt tokens: ${data.usage.prompt_tokens}, Completion tokens: ${data.usage.completion_tokens}, Total: ${data.usage.total_tokens}`);
    }

    return json({
      message: aiResponse.replace(/<svg>[\s\S]*?<\/svg>/g, '').trim(),
      svg: modifiedSVG,
      visionAnalysis: useVision ? visionAnalysis : undefined
    });
  } catch (error) {
    console.error('Error in OpenAI API call:', error);
    return json({
      error: `Server error: ${error instanceof Error ? error.message : String(error)}`
    }, { status: 500 });
  }
};