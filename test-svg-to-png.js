/**
 * Test script to validate SVG to PNG conversion
 * Run with: node test-svg-to-png.js
 */

import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';

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
    console.log('Original SVG string length:', svgString.length);

    // Log SVG content for debugging
    console.log('SVG content preview:', svgString.substring(0, 200) + '...');

    // Ensure SVG has width and height attributes
    if (!svgString.includes('width=') || !svgString.includes('height=')) {
      svgString = svgString.replace('<svg', `<svg width="${width}" height="${height}"`);
    }

    console.log('SVG after width/height check, length:', svgString.length);

    // Create resvg instance
    console.log('Creating Resvg instance...');
    const resvg = new Resvg(svgString, {
      fitTo: {
        mode: 'width',
        value: width
      },
      font: {
        loadSystemFonts: true
      },
      logLevel: 'debug'
    });

    console.log('Resvg instance created, rendering to PNG...');

    // Render to PNG
    const pngData = resvg.render();
    console.log('PNG rendered, size:', pngData.width, 'x', pngData.height);

    const pngBuffer = pngData.asPng();
    console.log('PNG buffer created, length:', pngBuffer.length);

    // Save PNG to file for verification
    fs.writeFileSync('test-output.png', pngBuffer);
    console.log('PNG saved to test-output.png');

    // Convert to base64 data URL
    const base64Data = pngBuffer.toString('base64');
    console.log('Base64 data length:', base64Data.length);

    const dataUrl = `data:image/png;base64,${base64Data}`;
    return dataUrl;
  } catch (error) {
    console.error('Error converting SVG to PNG:', error);
    throw new Error('Failed to convert SVG to PNG: ' + error.message);
  }
}

/**
 * Simple function to check if a data URL is valid and has the correct format
 */
function validateImageDataUrl(
  dataUrl,
  allowedFormats = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    console.log('Invalid: Not a string or empty');
    return false;
  }

  // Check if it's a valid data URL
  if (!dataUrl.startsWith('data:')) {
    console.log('Invalid: Does not start with data:');
    return false;
  }

  // Extract the MIME type
  const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  if (!mimeMatch) {
    console.log('Invalid: Cannot extract MIME type');
    return false;
  }

  const mimeType = mimeMatch[1];
  const isValidMime = allowedFormats.includes(mimeType);
  console.log('MIME type:', mimeType, 'Valid?', isValidMime);

  return isValidMime;
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