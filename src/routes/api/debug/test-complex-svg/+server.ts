import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import { svgToPngDataUrl, validateImageDataUrl } from '$lib/utils/imageUtils';
import type { Stroke } from '$lib/types';

/**
 * Debug endpoint to test complex SVG to PNG conversion with generated stroke data
 */
export const GET: RequestHandler = async () => {
  try {
    // Create some sample stroke data that resembles a simple sketch
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

    console.log('Generating SVG from sample strokes');

    // Generate SVG with debug logging enabled
    const svgResult = svgFromStrokes(sampleStrokes, 800, 600, 'white', {
      debug: true,
      optimizeViewBox: true,
      metadata: true,
      title: 'Debug Test Drawing'
    });

    if (svgResult.error) {
      console.error('Error generating SVG:', svgResult.error);
      return json({
        success: false,
        error: `SVG generation failed: ${svgResult.error}`
      }, { status: 500 });
    }

    console.log('SVG generation succeeded, length:', svgResult.svg.length);

    // Convert to PNG
    const pngDataUrl = svgToPngDataUrl(svgResult.svg, 1024, 768);

    // Validate the result
    const isValid = validateImageDataUrl(pngDataUrl);

    // Return the results for inspection
    return json({
      success: true,
      strokeCount: sampleStrokes.length,
      svgLength: svgResult.svg.length,
      svgPreview: svgResult.svg.substring(0, 200) + '...',
      pngDataUrlLength: pngDataUrl.length,
      pngDataUrlPreview: pngDataUrl.substring(0, 100) + '...',
      isValid,
      // Include the full SVG and PNG for testing
      svg: svgResult.svg,
      pngDataUrl: pngDataUrl
    });
  } catch (error) {
    console.error('Error in test-complex-svg endpoint:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};