import { getStroke } from 'perfect-freehand';
import type { StrokeOptions } from 'perfect-freehand';
import type { Stroke, StrokePoint } from '$lib/types';

/**
 * Create a date formatter function
 */
export function formatDate(date: string | Date): string {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // If date is less than 24 hours ago, show relative time
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);

  if (diffHrs < 24) {
    if (diffHrs < 1) {
      const diffMins = Math.round(diffMs / (1000 * 60));
      return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    }

    const hours = Math.floor(diffHrs);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }

  // Otherwise show the date
  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: dateObj.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Create an SVG path from a Perfect Freehand stroke
 */
export function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];

      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );

  d.push('Z');
  return d.join(' ');
}

/**
 * Get options for Perfect Freehand strokes
 */
export function getPerfectFreehandOptions(
  size: number,
  thinning: number,
  smoothing: number,
  streamline: number,
  simulatePressure: boolean,
  capStart: boolean,
  capEnd: boolean,
  taperStart: number,
  taperEnd: number
): StrokeOptions {
  return {
    size,
    thinning,
    smoothing,
    streamline,
    easing: (t) => t,
    start: {
      taper: taperStart,
      cap: capStart
    },
    end: {
      taper: taperEnd,
      cap: capEnd
    },
    simulatePressure
  };
}

/**
 * Calculate pressure based on the velocity of a stroke
 */
export function calculatePressureFromVelocity(
  points: Array<{ x: number; y: number }>,
  index: number,
  velocityScale = 0.2
): number {
  // If we're at the first point or not enough points to calculate velocity
  if (index <= 0 || points.length < 2) {
    return 0.5;
  }

  // Get current and previous points
  const current = points[index];
  const prev = points[index - 1];

  // Calculate distance between points
  const dx = current.x - prev.x;
  const dy = current.y - prev.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Map distance to pressure (inverse relationship - faster = less pressure)
  // Range clamp between 0.2 and 0.8
  const velocity = Math.min(distance * velocityScale, 1.0);

  // Inverse relationship - fast velocity = lower pressure
  return Math.max(0.2, Math.min(0.8, 1 - velocity));
}

/**
 * Convert Stroke object to perfect-freehand points
 */
export function strokeToPerfectFreehand(
  stroke: Stroke,
  options: Partial<StrokeOptions> = {}
): number[][] {
  // Map points from our format to perfect-freehand's format [x, y, pressure]
  const points = stroke.points.map((point: StrokePoint) => [
    point.x,
    point.y,
    point.pressure || 0.5,
  ]);

  // Get default options
  const defaultOptions = getPerfectFreehandOptions(stroke.size, 0.5, 0.5, 0.5, true, true, true, 0, 0);

  // Merge with custom options
  const mergedOptions = { ...defaultOptions, ...options };

  // Generate the stroke with perfect-freehand
  return getStroke(points, mergedOptions);
}

/**
 * Check if a point is inside an eraser stroke
 */
export function isPointInStroke(
  point: StrokePoint,
  stroke: Stroke,
  eraserSize: number
): boolean {
  // Simple distance check for now
  for (const strokePoint of stroke.points) {
    const dx = point.x - strokePoint.x;
    const dy = point.y - strokePoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < eraserSize / 2) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a complete SVG document from an array of strokes
 * @param strokes - Array of stroke objects
 * @param width - Width of the SVG (default: 800)
 * @param height - Height of the SVG (default: 600)
 * @param background - Background color (default: transparent)
 * @param options - Additional options for SVG generation
 * @returns SVG document as a string
 */
export function svgFromStrokes(
  strokes: Stroke[],
  width: number = 800,
  height: number = 600,
  background: string = 'transparent',
  options: {
    decimals?: number;           // Decimal precision for path coordinates
    optimizeViewBox?: boolean;   // Calculate optimal viewBox based on content
    metadata?: boolean;          // Include metadata in the SVG
    title?: string;              // Title of the drawing
  } = {}
): { svg: string; error?: undefined } | { svg?: undefined; error: string } {
  try {
    // Set defaults for options
    const decimals = options.decimals ?? 2;
    const optimizeViewBox = options.optimizeViewBox ?? true;
    const includeMetadata = options.metadata ?? true;
    const title = options.title ?? 'Drawing';

    // Initialize SVG bounds for viewBox calculation
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasContent = false;

    // Prepare arrays to hold optimized paths
    const pathElements: string[] = [];

    // Process each stroke and track drawing bounds
    for (const stroke of strokes) {
      // Skip strokes with less than 2 points and eraser strokes
      if (!stroke.points || stroke.points.length < 2 || stroke.tool === 'eraser') continue;

      hasContent = true;

      // Convert points to perfect-freehand format
      const points = stroke.points.map(point => [
        point.x,
        point.y,
        point.pressure || 0.5
      ]);

      // Generate options based on stroke type
      const perfectOptions = getPerfectFreehandOptions(
        stroke.size,
        stroke.tool === 'highlighter' ? -0.5 : 0.5, // Negative thinning for highlighter
        0.5, // Smoothing
        0.5, // Streamline
        true, // Simulate pressure
        true, // Cap start
        true, // Cap end
        0,   // Taper start
        0    // Taper end
      );

      // Generate the stroke
      const freehandStroke = getStroke(points, perfectOptions);

      // Skip if stroke couldn't be generated
      if (!freehandStroke.length) continue;

      // Update bounds for viewBox calculation
      for (const [x, y] of freehandStroke) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }

      // Convert to SVG path with optimized precision
      const pathData = getSvgPathFromStroke(freehandStroke)
        // Optimize path data by reducing precision
        .replace(/([0-9]*\.[0-9]+)/g, (match) => {
          return parseFloat(match).toFixed(decimals);
        });

      // Skip if path couldn't be generated
      if (!pathData) continue;

      // Set opacity based on stroke type and opacity property
      const opacity = stroke.tool === 'highlighter' ? 0.4 : stroke.opacity;

      // Add path to pathElements array
      pathElements.push(`  <path d="${pathData}" fill="${stroke.color}" opacity="${opacity}" />`);
    }

    // Handle case where there are no valid strokes
    if (!hasContent) {
      return {
        svg: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
  xmlns="http://www.w3.org/2000/svg" version="1.1">
  ${background !== 'transparent' ? `<rect width="${width}" height="${height}" fill="${background}" />` : ''}
</svg>`
      };
    }

    // Calculate optimized viewBox with padding
    let viewBoxValues: string;
    if (optimizeViewBox && hasContent) {
      // Add 10% padding around the content
      const padding = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 10);
      minX = Math.max(0, minX - padding);
      minY = Math.max(0, minY - padding);
      maxX = maxX + padding;
      maxY = maxY + padding;
      viewBoxValues = `${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}`;

      // Update width and height based on the viewBox ratio
      const aspectRatio = (maxX - minX) / (maxY - minY);
      if (aspectRatio > width / height) {
        // Width is the limiting factor
        height = width / aspectRatio;
      } else {
        // Height is the limiting factor
        width = height * aspectRatio;
      }
    } else {
      viewBoxValues = `0 0 ${width} ${height}`;
    }

    // Start the SVG document with appropriate namespace
    let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="${viewBoxValues}"
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  version="1.1">
`;

    // Add metadata if requested
    if (includeMetadata) {
      svg += `
  <title>${title}</title>
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
             xmlns:dc="http://purl.org/dc/elements/1.1/">
      <rdf:Description dc:title="${title}" dc:creator="Daydream SVG Export" dc:date="${new Date().toISOString()}"/>
    </rdf:RDF>
  </metadata>
`;
    }

    // Add a background rectangle if not transparent
    if (background !== 'transparent') {
      svg += `  <rect width="100%" height="100%" fill="${background}" />\n`;
    }

    // Add a group for all strokes
    svg += `  <g>\n`;

    // Add all path elements
    svg += pathElements.join('\n');

    // Close the group and SVG document
    svg += `
  </g>
</svg>`;

    return { svg };
  } catch (error) {
    // Return detailed error information
    return {
      error: `Error generating SVG: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}