import type { Stroke, DrawingContent } from '$lib/types';

// Types for chat messages
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Interface for modification result
export interface SVGModificationResult {
  success: boolean;
  message: string;
  modifiedStrokes?: Stroke[];
  svgString?: string;
  visionAnalysis?: {
    labels: string[];
    text: string;
  };
}

/**
 * Send the drawing content to server for analysis
 * @param drawingContent The current drawing content with strokes
 * @param userPrompt The user's instruction or question about the drawing
 * @param chatHistory Previous conversation context
 * @param imageData Base64 image data of the canvas for vision analysis
 * @param useVision Whether to use Google Vision API for image analysis
 * @returns The analysis or modification result
 */
export async function analyzeDrawing(
  drawingContent: DrawingContent,
  userPrompt: string,
  chatHistory: ChatMessage[] = [],
  imageData?: string | null,
  useVision: boolean = false
): Promise<{ message: string; svg?: string; modifications?: SVGModificationResult; visionAnalysis?: any }> {
  try {
    // Call the server endpoint
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        drawingContent,
        userPrompt,
        chatHistory: chatHistory.filter(msg =>
          msg.role === 'user' || msg.role === 'assistant'
        ),
        imageData,
        useVision
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to analyze drawing');
    }

    const result = await response.json();

    return {
      message: result.message,
      svg: result.svg,
      visionAnalysis: result.visionAnalysis
    };
  } catch (error) {
    console.error('Error in drawing analysis:', error);
    return {
      message: `Sorry, I encountered an error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Apply modifications to drawing strokes based on AI suggestions
 * @param drawingContent The current drawing content
 * @param instruction The modification instruction
 * @param imageData Base64 image data of the canvas for vision analysis
 * @param useVision Whether to use Google Vision API for image analysis
 * @returns The modified strokes or error message
 */
export async function modifyDrawing(
  drawingContent: DrawingContent,
  instruction: string,
  imageData?: string | null,
  useVision: boolean = false
): Promise<SVGModificationResult> {
  try {
    // Call the server endpoint
    const response = await fetch('/api/ai/modify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        drawingContent,
        instruction,
        imageData,
        useVision
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to modify drawing');
    }

    return await response.json();
  } catch (error) {
    console.error('Error modifying drawing:', error);
    return {
      success: false,
      message: `Sorry, I encountered an error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}