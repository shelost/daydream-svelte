import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import type { Stroke } from '$lib/types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { drawingContent, instruction, imageData, chatHistory = [], useVision = false } = await request.json();

    if (!drawingContent || !instruction) {
      return json({
        success: false,
        message: 'Drawing content and instruction are required'
      }, { status: 400 });
    }

    // Simple color change implementation as an example
    if (instruction.toLowerCase().includes('change color') ||
        instruction.toLowerCase().includes('turn') ||
        instruction.toLowerCase().includes('make') ||
        instruction.toLowerCase().includes('color')) {

      // Extract color information from instruction
      const colorMatch = instruction.match(/to\s+(\w+)|(\w+)\s+color/i);
      const fromColorMatch = instruction.match(/(black|red|green|blue|yellow|purple|orange|pink|brown|grey|gray|white)\s+stroke/i);

      if (colorMatch && (colorMatch[1] || colorMatch[2])) {
        const targetColor = colorMatch[1] || colorMatch[2];
        const fromColor = fromColorMatch ? fromColorMatch[1] : null;

        // Simple implementation - modify all strokes or only those matching fromColor
        const modifiedStrokes = drawingContent.strokes.map((stroke: Stroke) => {
          // If fromColor specified, only change matching strokes
          if (fromColor && !stroke.color.includes(fromColor.toLowerCase())) {
            return stroke;
          }

          return {
            ...stroke,
            color: getColorCode(targetColor.toLowerCase())
          };
        });

        return json({
          success: true,
          message: `Changed ${fromColor ? fromColor + ' strokes' : 'strokes'} to ${targetColor}`,
          modifiedStrokes
        });
      }
    }

    // If not a simple color change, call OpenAI for more complex modifications
    // Make a request to our analyze endpoint which can handle SVG generation

    // Limit chat history to reduce token usage
    const limitedChatHistory = Array.isArray(chatHistory)
      ? chatHistory.slice(-6)  // Only use the 6 most recent messages
      : [];

    // Call the analyze endpoint with our updated parameters
    const response = await fetch(new URL('/api/ai/analyze', request.url).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        drawingContent,
        userPrompt: instruction,
        chatHistory: limitedChatHistory,
        imageData: imageData, // Pass the potentially resized image data
        useVision: useVision // Pass the Vision API flag
      })
    });

    if (!response.ok) {
      const errorData = await response.json();

      // If we hit a token limit issue, provide a more helpful error message
      if (errorData.error && errorData.error.includes('complex')) {
        return json({
          success: false,
          message: errorData.error
        }, { status: 413 });
      }

      return json({
        success: false,
        message: errorData.error || 'Failed to get response from AI'
      }, { status: response.status });
    }

    const data = await response.json();

    // Check if Vision API analysis is available and user enabled it
    if (useVision && data.visionAnalysis) {
      const visionMessage = `Vision analysis detected: ${data.visionAnalysis.labels.join(', ')}`;

      return json({
        success: data.svg ? true : false,
        message: `${data.message}\n\n${visionMessage}`,
        svgString: data.svg || null
      });
    }

    if (data.svg) {
      return json({
        success: true,
        message: data.message,
        svgString: data.svg
      });
    }

    return json({
      success: false,
      message: "I understand what you want to do, but I can't automatically modify the drawing that way yet. " + data.message
    });
  } catch (error) {
    console.error('Error modifying drawing:', error);
    return json({
      success: false,
      message: `Server error: ${error instanceof Error ? error.message : String(error)}`
    }, { status: 500 });
  }
};

/**
 * Helper function to convert color names to hex codes
 */
function getColorCode(colorName: string): string {
  const colorMap: Record<string, string> = {
    'red': '#FF0000',
    'green': '#00FF00',
    'blue': '#0000FF',
    'yellow': '#FFFF00',
    'purple': '#800080',
    'orange': '#FFA500',
    'black': '#000000',
    'white': '#FFFFFF',
    'pink': '#FFC0CB',
    'brown': '#A52A2A',
    'grey': '#808080',
    'gray': '#808080',
    'cyan': '#00FFFF',
    'magenta': '#FF00FF'
  };

  return colorMap[colorName] || colorName;
}