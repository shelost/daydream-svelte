import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { svgToPngDataUrl, validateImageDataUrl } from '$lib/utils/imageUtils';

/**
 * Debug endpoint to test the SVG to PNG conversion functionality
 */
export const GET: RequestHandler = async () => {
  try {
    // Simple test SVG
    const testSvg = `
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="800" height="600" viewBox="0 0 800 600"
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  version="1.1">
  <rect x="50" y="50" width="100" height="100" fill="black" />
  <circle cx="200" cy="200" r="50" fill="blue" />
</svg>
    `.trim();

    console.log('Testing SVG to PNG conversion with a simple SVG');

    // Convert to PNG
    const pngDataUrl = svgToPngDataUrl(testSvg, 800, 600);

    // Validate the result
    const isValid = validateImageDataUrl(pngDataUrl);

    // Return the results for inspection
    return json({
      success: true,
      svgLength: testSvg.length,
      pngDataUrlLength: pngDataUrl.length,
      pngDataUrlPreview: pngDataUrl.substring(0, 100) + '...',
      isValid,
      // Include the full PNG data URL for testing
      pngDataUrl: pngDataUrl
    });
  } catch (error) {
    console.error('Error in test-svg-to-png endpoint:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};