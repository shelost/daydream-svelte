/**
 * Utility functions for image manipulation and conversion
 */

import { Resvg } from '@resvg/resvg-js';

/**
 * Converts an SVG string to a PNG base64 data URL
 * This uses @resvg/resvg-js which can run on the server without a browser/canvas
 *
 * @param svgString - The SVG XML content as a string
 * @param width - Optional width for the output PNG (default: 1024)
 * @param height - Optional height for the output PNG (default: 1024)
 * @returns A data URL containing the PNG image as base64
 */
export function svgToPngDataUrl(svgString: string, width = 1024, height = 1024): string {
  try {
    console.log('[PNG] Converting SVG to PNG, SVG length:', svgString.length);

    // Ensure SVG has valid XML declaration
    if (!svgString.trim().startsWith('<?xml') && !svgString.trim().startsWith('<svg')) {
      console.error('[PNG] SVG string does not start with XML declaration or SVG tag');
      throw new Error('Invalid SVG format: missing XML declaration or SVG tag');
    }

    // Ensure SVG has proper namespace
    if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
      console.warn('[PNG] SVG missing proper namespace, attempting to add it');
      svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Ensure SVG has width and height attributes
    if (!svgString.includes('width=') || !svgString.includes('height=')) {
      console.log('[PNG] Adding width and height attributes to SVG');
      svgString = svgString.replace('<svg', `<svg width="${width}" height="${height}"`);
    }

    // Check for doctype and remove if present (resvg doesn't handle certain doctypes well)
    if (svgString.includes('<!DOCTYPE')) {
      console.log('[PNG] Removing DOCTYPE declaration for compatibility');
      svgString = svgString.replace(/<!DOCTYPE[^>]*>/i, '');
    }

    console.log('[PNG] Creating resvg instance with SVG of length:', svgString.length);

    // Create resvg instance
    const resvg = new Resvg(svgString, {
      fitTo: {
        mode: 'width',
        value: width
      },
      font: {
        loadSystemFonts: true
      },
      background: 'white' // Add white background to ensure transparency is handled properly
    });

    // Render to PNG
    console.log('[PNG] Rendering to PNG...');
    const pngData = resvg.render();
    console.log('[PNG] PNG rendered, size:', pngData.width, 'x', pngData.height);

    const pngBuffer = pngData.asPng();
    console.log('[PNG] PNG buffer created, length:', pngBuffer.length);

    // Convert to base64 data URL
    const base64Data = pngBuffer.toString('base64');
    console.log('[PNG] Base64 conversion complete, length:', base64Data.length);

    return `data:image/png;base64,${base64Data}`;
  } catch (error) {
    console.error('Error converting SVG to PNG:', error);

    // Log SVG preview for debugging
    console.error('SVG preview (first 500 chars):', svgString.substring(0, 500));
    console.error('SVG preview (last 100 chars):', svgString.substring(svgString.length - 100));

    throw new Error(`Failed to convert SVG to PNG: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Simple function to check if a data URL is valid and has the correct format
 * @param dataUrl The data URL to validate
 * @param allowedFormats Array of allowed mime types
 * @returns true if valid, false otherwise
 */
export function validateImageDataUrl(
  dataUrl: string,
  allowedFormats = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
): boolean {
  console.log('[Validate] Checking data URL validity');

  if (!dataUrl || typeof dataUrl !== 'string') {
    console.error('[Validate] Invalid: Not a string or empty');
    return false;
  }

  // Check if it's a valid data URL
  if (!dataUrl.startsWith('data:')) {
    console.error('[Validate] Invalid: Does not start with data:');
    return false;
  }

  // Extract the MIME type
  const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  if (!mimeMatch) {
    console.error('[Validate] Invalid: Cannot extract MIME type');
    console.error('[Validate] URL prefix:', dataUrl.substring(0, 30));
    return false;
  }

  const mimeType = mimeMatch[1];
  const isValidMime = allowedFormats.includes(mimeType);
  console.log('[Validate] MIME type:', mimeType, 'Valid?', isValidMime);

  // Check for base64 content after the comma
  const base64Data = dataUrl.split(',')[1];
  if (!base64Data || base64Data.length === 0) {
    console.error('[Validate] Invalid: No base64 data after comma');
    return false;
  }

  // Basic validation of base64 format (must contain only valid base64 characters)
  const validBase64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  const isValidBase64 = validBase64Regex.test(base64Data);

  if (!isValidBase64) {
    console.error('[Validate] Invalid: Base64 data format is invalid');
    console.error('[Validate] Base64 data length:', base64Data.length);
    // Log a small portion to see what might be wrong
    console.error('[Validate] Base64 preview:', base64Data.substring(0, 30), '...');
  }

  console.log('[Validate] Overall validation result:', isValidMime && isValidBase64);
  return isValidMime && isValidBase64;
}