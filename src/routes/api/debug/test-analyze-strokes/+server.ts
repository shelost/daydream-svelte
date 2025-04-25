import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Stroke } from '$lib/types';

/**
 * Debug endpoint to test the analyze-strokes API with sample stroke data
 */
export const GET: RequestHandler = async (event) => {
  try {
    // Create sample stroke data
    const sampleStrokes: Stroke[] = [
      // Draw a rectangle
      {
        tool: 'pen',
        points: [
          { x: 100, y: 100, pressure: 0.5 },
          { x: 300, y: 100, pressure: 0.5 },
          { x: 300, y: 200, pressure: 0.5 },
          { x: 100, y: 200, pressure: 0.5 },
          { x: 100, y: 100, pressure: 0.5 }
        ],
        color: '#000000',
        size: 5,
        opacity: 1
      },
      // Draw a circle
      {
        tool: 'pen',
        points: Array.from({ length: 20 }).map((_, i) => {
          const angle = (i / 20) * Math.PI * 2;
          return {
            x: 400 + Math.cos(angle) * 50,
            y: 150 + Math.sin(angle) * 50,
            pressure: 0.5
          };
        }),
        color: '#0000FF',
        size: 5,
        opacity: 1
      },
      // Draw a line
      {
        tool: 'pen',
        points: [
          { x: 150, y: 300, pressure: 0.5 },
          { x: 350, y: 350, pressure: 0.5 }
        ],
        color: '#FF0000',
        size: 8,
        opacity: 1
      }
    ];

    console.log('Sending request to analyze-strokes API with sample strokes');

    // Make a POST request to the analyze-strokes API
    const response = await fetch(new URL('/api/ai/analyze-strokes', event.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        strokes: sampleStrokes,
        enhancedAnalysis: true,
        context: 'Test drawing with a rectangle, circle, and line'
      })
    });

    // Handle API response
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API request failed:', response.status, errorText);
      return json({
        success: false,
        error: `API request failed: ${response.status} ${errorText}`
      }, { status: response.status });
    }

    // Parse the API response
    const result = await response.json();

    // Return the results for inspection
    return json({
      success: true,
      strokeCount: sampleStrokes.length,
      apiResponse: result
    });
  } catch (error) {
    console.error('Error in test-analyze-strokes endpoint:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};