import type { Stroke } from '$lib/types/drawing';

/**
 * Converts an array of strokes to an SVG string representation
 *
 * @param strokes The strokes to convert to SVG
 * @param width The width of the SVG canvas
 * @param height The height of the SVG canvas
 * @returns An SVG string representation of the strokes
 */
export function convertStrokesToSvg(strokes: Stroke[], width: number, height: number): string {
  if (!strokes || strokes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
  }

  const paths = strokes.map(stroke => {
    if (!stroke.points || stroke.points.length === 0) {
      return '';
    }

    const { points, color = '#000000', width = 2 } = stroke;

    // Start with a move to the first point
    let pathData = `M ${points[0].x} ${points[0].y}`;

    // Add line segments to each subsequent point
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i].x} ${points[i].y}`;
    }

    return `<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths}</svg>`;
}

/**
 * Extracts the viewBox dimensions from an SVG string
 *
 * @param svgString The SVG string to extract viewBox from
 * @returns An object with width and height, or null if not found
 */
export function extractSvgDimensions(svgString: string): { width: number; height: number } | null {
  const viewBoxMatch = svgString.match(/viewBox=["']([^"']*)["']/);
  if (viewBoxMatch && viewBoxMatch[1]) {
    const [_, __, width, height] = viewBoxMatch[1].split(/\s+/).map(Number);
    if (!isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
  }

  const widthMatch = svgString.match(/width=["']([^"']*)["']/);
  const heightMatch = svgString.match(/height=["']([^"']*)["']/);

  if (widthMatch && heightMatch) {
    const width = parseFloat(widthMatch[1]);
    const height = parseFloat(heightMatch[1]);
    if (!isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
  }

  return null;
}

/**
 * Optimizes an SVG string by removing unnecessary attributes and whitespace
 *
 * @param svgString The SVG string to optimize
 * @returns An optimized SVG string
 */
export function optimizeSvg(svgString: string): string {
  // Remove XML declaration
  svgString = svgString.replace(/<\?xml[^>]*\?>/, '');

  // Remove comments
  svgString = svgString.replace(/<!--[\s\S]*?-->/g, '');

  // Remove whitespace between tags
  svgString = svgString.replace(/>\s+</g, '><');

  // Trim whitespace
  svgString = svgString.trim();

  return svgString;
}