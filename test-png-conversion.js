/**
 * Test script to validate SVG to PNG conversion
 *
 * Run with: node test-png-conversion.js
 */

import { Resvg } from '@resvg/resvg-js';

// Sample SVG for testing
const testSvg = `
<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="50" y="50" width="100" height="100" fill="black"/>
  <circle cx="200" cy="200" r="50" fill="blue"/>
</svg>
`;

/**
 * Converts an SVG string to a PNG base64 data URL
 */
function svgToPngDataUrl(svgString, width = 1024, height = 1024) {
  try {
    // Ensure SVG has width and height attributes
    if (!svgString.includes('width=') || !svgString.includes('height=')) {
      svgString = svgString.replace('<svg', `<svg width="${width}" height="${height}"`);
    }

    // Create resvg instance
    const resvg = new Resvg(svgString, {
      fitTo: {
        mode: 'width',
        value: width
      }
    });

    // Render to PNG
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Convert to base64 data URL
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
  } catch (error) {
    console.error('Error converting SVG to PNG:', error);
    throw new Error('Failed to convert SVG to PNG');
  }
}

/**
 * Validates image data URL
 */
function validateImageDataUrl(dataUrl, allowedFormats = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return false;
  }

  // Check if it's a valid data URL
  if (!dataUrl.startsWith('data:')) {
    return false;
  }

  // Extract the MIME type
  const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  if (!mimeMatch) {
    return false;
  }

  const mimeType = mimeMatch[1];
  return allowedFormats.includes(mimeType);
}

// Test the conversion
try {
  console.log('Converting SVG to PNG...');
  const pngDataUrl = svgToPngDataUrl(testSvg);

  console.log('PNG Data URL preview:');
  // Show just the start to avoid cluttering the console
  console.log(pngDataUrl.substring(0, 150) + '...');

  console.log(`\nData URL length: ${pngDataUrl.length} characters`);

  // Validate the PNG
  const isValid = validateImageDataUrl(pngDataUrl);
  console.log(`PNG validation result: ${isValid ? 'VALID' : 'INVALID'}`);

  // Additional validation
  console.log('\nChecking data URL format:');
  console.log('Starts with "data:image/png;base64,": ', pngDataUrl.startsWith('data:image/png;base64,'));

  // Check if there might be character encoding issues
  const base64Part = pngDataUrl.split(',')[1];
  const validBase64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  console.log('Base64 format is valid: ', validBase64Regex.test(base64Part));

  console.log('\nTest completed successfully!');
} catch (error) {
  console.error('Test failed with error:', error);
}