/**
 * Drawing utility functions
 */

import { getStroke } from 'perfect-freehand';

/**
 * Create an SVG path from a Perfect Freehand stroke
 * This function takes the output of perfect-freehand's getStroke() and converts it into SVG path data
 *
 * @param {number[][]} stroke - Array of points from perfect-freehand's getStroke function
 * @returns {string} SVG path data string
 */
export function getSvgPathFromStroke(stroke) {
  if (!stroke || !stroke.length) return '';

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
 *
 * @param {number} size - Stroke size
 * @param {number} thinning - Thinning factor (0-1)
 * @param {number} smoothing - Smoothing factor (0-1)
 * @param {number} streamline - Streamline factor (0-1)
 * @param {boolean} simulatePressure - Whether to simulate pressure
 * @param {boolean} capStart - Whether to cap the start of the stroke
 * @param {boolean} capEnd - Whether to cap the end of the stroke
 * @param {number} taperStart - How much to taper the start (0-1)
 * @param {number} taperEnd - How much to taper the end (0-1)
 * @returns {Object} Perfect freehand options object
 */
export function getPerfectFreehandOptions(
  size = 8,
  thinning = 0.5,
  smoothing = 0.5,
  streamline = 0.5,
  simulatePressure = true,
  capStart = true,
  capEnd = true,
  taperStart = 0,
  taperEnd = 0
) {
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
 * Find related strokes within a given radius of a position
 * @param {Array} strokes - Array of stroke data
 * @param {number} x - X coordinate (0-1 range)
 * @param {number} y - Y coordinate (0-1 range)
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @param {number} radius - Search radius (0-1 range)
 * @param {boolean} useAggressive - Whether to use aggressive search to find more strokes
 * @returns {Array} Related strokes
 */
export function findRelatedStrokes(strokes, x, y, canvasWidth, canvasHeight, radius = 0.1, useAggressive = false) {
  if (!strokes || !strokes.length) return [];

  // Convert normalized position to canvas coordinates
  const posX = x * canvasWidth;
  const posY = y * canvasHeight;
  const searchRadius = radius * Math.max(canvasWidth, canvasHeight);

  // First pass: find strokes close to the center point
  const closeStrokes = strokes.filter(stroke => {
    if (!stroke.points || stroke.points.length === 0) return false;

    // Check if any point of the stroke is within the search radius
    return stroke.points.some(point => {
      const distanceSquared = Math.pow(point.x - posX, 2) + Math.pow(point.y - posY, 2);
      return distanceSquared <= Math.pow(searchRadius, 2);
    });
  });

  // If not using aggressive search or no strokes found, return what we have
  if (!useAggressive || closeStrokes.length === 0) {
    return closeStrokes;
  }

  // Second pass (aggressive): expand to include nearby strokes
  const relatedStrokes = [...closeStrokes];
  const checkedStrokeIds = new Set(closeStrokes.map(s => s.id));

  // Iteratively find strokes close to our current set
  let foundMore = true;
  let iterations = 0;
  const maxIterations = 3; // Prevent infinite loops

  while (foundMore && iterations < maxIterations) {
    foundMore = false;
    iterations++;

    // Calculate current bounding box
    const currentBBox = calculateMultiStrokeBoundingBox(relatedStrokes);

    // Expand search area
    const expandedSearch = {
      minX: currentBBox.minX - searchRadius / 2,
      minY: currentBBox.minY - searchRadius / 2,
      maxX: currentBBox.maxX + searchRadius / 2,
      maxY: currentBBox.maxY + searchRadius / 2
    };

    // Check all strokes
    for (const stroke of strokes) {
      // Skip strokes we've already checked
      if (checkedStrokeIds.has(stroke.id)) continue;

      // Check if this stroke overlaps with expanded area
      const strokeBBox = calculateStrokeBoundingBox(stroke);
      if (
        strokeBBox.maxX >= expandedSearch.minX &&
        strokeBBox.minX <= expandedSearch.maxX &&
        strokeBBox.maxY >= expandedSearch.minY &&
        strokeBBox.minY <= expandedSearch.maxY
      ) {
        relatedStrokes.push(stroke);
        checkedStrokeIds.add(stroke.id);
        foundMore = true;
      }
    }
  }

  return relatedStrokes;
}

/**
 * Calculate the bounding box for a single stroke
 * @param {Object} stroke - Stroke data with points
 * @param {boolean} includePadding - Whether to include padding based on stroke size
 * @returns {Object} Bounding box {minX, minY, maxX, maxY, width, height, centerX, centerY}
 */
export function calculateStrokeBoundingBox(stroke, includePadding = true) {
  if (!stroke.points || stroke.points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  // Initialize with the first point
  let minX = stroke.points[0].x;
  let minY = stroke.points[0].y;
  let maxX = stroke.points[0].x;
  let maxY = stroke.points[0].y;

  // Calculate the stroke thickness
  const maxThickness = stroke.size || 4; // Default to 4 if size not specified

  // Find min/max coordinates
  stroke.points.forEach(point => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  // Add padding based on stroke thickness if requested
  if (includePadding) {
    const halfThickness = maxThickness / 2;
    minX -= halfThickness;
    minY -= halfThickness;
    maxX += halfThickness;
    maxY += halfThickness;
  }

  // Calculate width and height
  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  return { minX, minY, maxX, maxY, width, height, centerX, centerY };
}

/**
 * Calculate the bounding box for multiple strokes
 * @param {Array} strokes - Array of stroke data
 * @param {boolean} includePadding - Whether to include padding based on stroke size
 * @returns {Object} Bounding box {minX, minY, maxX, maxY, width, height, centerX, centerY}
 */
export function calculateMultiStrokeBoundingBox(strokes, includePadding = true) {
  if (!strokes || strokes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  // Start with the bounding box of the first stroke
  const firstBbox = calculateStrokeBoundingBox(strokes[0], includePadding);

  let minX = firstBbox.minX;
  let minY = firstBbox.minY;
  let maxX = firstBbox.maxX;
  let maxY = firstBbox.maxY;

  // Expand to include all other strokes
  for (let i = 1; i < strokes.length; i++) {
    const bbox = calculateStrokeBoundingBox(strokes[i], includePadding);
    minX = Math.min(minX, bbox.minX);
    minY = Math.min(minY, bbox.minY);
    maxX = Math.max(maxX, bbox.maxX);
    maxY = Math.max(maxY, bbox.maxY);
  }

  // Calculate dimensions
  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  return { minX, minY, maxX, maxY, width, height, centerX, centerY };
}

/**
 * Normalize a bounding box to 0-1 range
 * @param {Object} boundingBox - Bounding box in pixel coordinates
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @returns {Object} Normalized bounding box (0-1 range)
 */
export function normalizeBoundingBox(boundingBox, canvasWidth, canvasHeight) {
  if (!boundingBox) return null;

  // Normalize all coordinates to 0-1 range
  const normalizedBox = {
    minX: boundingBox.minX / canvasWidth,
    minY: boundingBox.minY / canvasHeight,
    maxX: boundingBox.maxX / canvasWidth,
    maxY: boundingBox.maxY / canvasHeight
  };

  // Calculate width and height in normalized space
  normalizedBox.width = normalizedBox.maxX - normalizedBox.minX;
  normalizedBox.height = normalizedBox.maxY - normalizedBox.minY;

  // Calculate center point
  normalizedBox.centerX = (normalizedBox.minX + normalizedBox.maxX) / 2;
  normalizedBox.centerY = (normalizedBox.minY + normalizedBox.maxY) / 2;

  return normalizedBox;
}

/**
 * Calculate pressure based on the velocity of a stroke
 * This function converts movement speed into pressure values:
 * - Slow movement = higher pressure (thicker line)
 * - Fast movement = lower pressure (thinner line)
 * If the device supports pressure sensitivity (e.g., Apple Pencil, Wacom),
 * the hardware pressure can be provided and this function will be skipped.
 *
 * @param {Array<{x: number, y: number}>} points - Array of stroke points
 * @param {number} index - Index of the current point
 * @param {number} velocityScale - Factor to adjust sensitivity (lower = less sensitive to speed)
 * @param {boolean} useTimeBased - Whether to use time-based velocity if timestamps are available
 * @param {Array<number>} timestamps - Optional array of timestamps for time-based velocity
 * @returns {number} Pressure value between 0.2 and 0.8
 */
export function calculatePressureFromVelocity(
  points,
  index,
  velocityScale = 0.2,
  useTimeBased = false,
  timestamps = []
) {
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

  // Calculate velocity based on time or distance
  let velocity;

  if (useTimeBased && timestamps && timestamps.length > index) {
    const timeElapsed = timestamps[index] - timestamps[index - 1];
    // Avoid division by zero
    if (timeElapsed <= 0) {
      velocity = Math.min(distance * velocityScale, 1.0);
    } else {
      // Calculate pixels per millisecond
      velocity = Math.min((distance / timeElapsed) * velocityScale * 10, 1.0);
    }
  } else {
    // Use distance-based velocity (original method)
    velocity = Math.min(distance * velocityScale, 1.0);
  }

  // Apply easing curve to make transitions more natural
  const easedVelocity = 1 - Math.pow(1 - velocity, 3); // Cubic ease-out

  // Map to pressure (0.2 to 0.8 range)
  // Inverse relationship - fast velocity = lower pressure
  const pressure = 0.8 - (easedVelocity * 0.6);

  // Ensure result is within bounds
  return Math.max(0.2, Math.min(0.8, pressure));
}

/**
 * Convert a stroke to perfect-freehand points and generate the stroke outline
 *
 * @param {Object} stroke - Stroke object with points, size, etc.
 * @param {Object} options - Additional options for perfect-freehand
 * @returns {Array} Array of points forming the stroke outline
 */
export function strokeToPerfectFreehand(stroke, options = {}) {
  if (!stroke || !stroke.points || stroke.points.length === 0) {
    return [];
  }

  // Convert points to format expected by perfect-freehand [x, y, pressure]
  const points = stroke.points.map(point => [
    point.x,
    point.y,
    point.pressure || 0.5
  ]);

  // Create default options
  const defaultOptions = getPerfectFreehandOptions(
    stroke.size || 8,
    0.5,
    0.5,
    0.5,
    true,
    true,
    true,
    0,
    0
  );

  // Merge with custom options
  const mergedOptions = { ...defaultOptions, ...options };

  // Use perfect-freehand's getStroke function directly
  return getStroke(points, mergedOptions);
}

/**
 * Generate SVG from an array of strokes
 *
 * @param {Array} strokes - Array of stroke objects
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {string} background - Background color
 * @param {Object} options - Additional options
 * @returns {Object} Object containing SVG string or error message
 */
export function svgFromStrokes(
  strokes,
  width = 800,
  height = 600,
  background = 'transparent',
  options = {}
) {
  try {
    if (!Array.isArray(strokes) || strokes.length === 0) {
      return {
        svg: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
  xmlns="http://www.w3.org/2000/svg" version="1.1">
  ${background !== 'transparent' ? `<rect width="${width}" height="${height}" fill="${background}" />` : ''}
</svg>`
      };
    }

    // Process strokes to SVG paths
    const pathElements = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasContent = false;

    // Process each stroke
    for (const stroke of strokes) {
      if (!stroke || !stroke.points || !Array.isArray(stroke.points) || stroke.points.length < 2) {
        continue;
      }

      // Extract stroke data points
      const points = stroke.points.map(point => ({
        x: point.x,
        y: point.y,
        pressure: typeof point.pressure === 'number' ? point.pressure : 0.5
      }));

      // Update bounding box
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }

      // We have at least one valid stroke
      hasContent = true;

      // Create stroke options for perfect-freehand
      const size = typeof stroke.size === 'number' ? stroke.size : 5;
      const freehandOptions = {
        size: size,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        easing: (t) => t,
        simulatePressure: false
      };

      // Generate the freehand stroke
      const freehandPoints = points.map(p => [p.x, p.y, p.pressure]);
      const freehandStroke = getStroke(freehandPoints, freehandOptions);

      // Convert to SVG path
      const pathData = getSvgPathFromStroke(freehandStroke);
      if (!pathData) continue;

      // Set opacity based on stroke type and opacity property
      const opacity = stroke.tool === 'highlighter' ? 0.4 : (stroke.opacity || 1);

      // Add path to pathElements array
      pathElements.push(`  <path d="${pathData}" fill="${stroke.color || '#000000'}" opacity="${opacity}" />`);
    }

    // Calculate optimized viewBox with padding if requested
    let viewBoxValues = `0 0 ${width} ${height}`;
    if (options.optimizeViewBox && hasContent) {
      const padding = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 10);
      minX = Math.max(0, minX - padding);
      minY = Math.max(0, minY - padding);
      maxX = maxX + padding;
      maxY = maxY + padding;
      viewBoxValues = `${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}`;
    }

    // Generate SVG document
    let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="${viewBoxValues}"
  xmlns="http://www.w3.org/2000/svg">
`;

    // Add background if not transparent
    if (background !== 'transparent') {
      svg += `  <rect width="100%" height="100%" fill="${background}" />\n`;
    }

    // Add all paths
    svg += `  <g>\n${pathElements.join('\n')}\n  </g>\n</svg>`;

    return { svg };
  } catch (error) {
    console.error('Error generating SVG:', error);
    return { error: `Error generating SVG: ${error.message || error}` };
  }
}

/**
 * Create a stroke point with pressure data
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} pressure - Pressure value (0-1)
 * @param {number} time - Timestamp
 * @returns {Object} Stroke point
 */
export function createStrokePoint(x, y, pressure = 0.5, time = Date.now()) {
  return { x, y, pressure, time };
}

/**
 * Calculate the distance between two points
 * @param {Object} pointA - First point {x, y}
 * @param {Object} pointB - Second point {x, y}
 * @returns {number} Distance
 */
export function calculateDistance(pointA, pointB) {
  return Math.sqrt(
    Math.pow(pointB.x - pointA.x, 2) +
    Math.pow(pointB.y - pointA.y, 2)
  );
}

/**
 * Check if a point is inside a polygon
 * @param {Object} point - Point {x, y}
 * @param {Array} polygon - Array of points {x, y}
 * @returns {boolean} True if point is inside polygon
 */
export function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // Check if point is on an edge
    if (
      (yi === point.y && xi === point.x) ||
      (yj === point.y && xj === point.x) ||
      (yi === yj && yi === point.y && xi < point.x && xj > point.x) ||
      (xi === xj && xi === point.x && yi < point.y && yj > point.y)
    ) {
      return true;
    }

    // Check if ray from point crosses segment
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Simplify a stroke path (reduce points) using Ramer-Douglas-Peucker algorithm
 * @param {Array} points - Array of points
 * @param {number} epsilon - Epsilon value (higher = more simplification)
 * @returns {Array} Simplified path
 */
export function simplifyStroke(points, epsilon = 1) {
  if (!points || points.length <= 2) return points;

  function pointDistance(p, p1, p2) {
    if (p1.x === p2.x && p1.y === p2.y) return calculateDistance(p, p1);

    const A = p2.y - p1.y;
    const B = p1.x - p2.x;
    const C = p2.x * p1.y - p1.x * p2.y;

    return Math.abs(A * p.x + B * p.y + C) / Math.sqrt(A * A + B * B);
  }

  function rdpRecursive(startIndex, endIndex) {
    if (endIndex <= startIndex + 1) return [];

    let maxDist = 0;
    let maxDistIndex = 0;

    // Find point with max distance from line
    for (let i = startIndex + 1; i < endIndex; i++) {
      const dist = pointDistance(
        points[i],
        points[startIndex],
        points[endIndex]
      );

      if (dist > maxDist) {
        maxDist = dist;
        maxDistIndex = i;
      }
    }

    // If max distance is greater than epsilon, recursively simplify
    const result = [];

    if (maxDist > epsilon) {
      const leftPart = rdpRecursive(startIndex, maxDistIndex);
      const rightPart = rdpRecursive(maxDistIndex, endIndex);

      result.push(...leftPart, maxDistIndex);
      result.push(...rightPart);
    }

    return result;
  }

  const indices = [0, ...rdpRecursive(0, points.length - 1), points.length - 1];

  return indices.map(i => points[i]);
}