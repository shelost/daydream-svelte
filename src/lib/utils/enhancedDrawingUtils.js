/**
 * Enhanced drawing utilities for pressure-sensitive, manga-like strokes
 * Built on top of perfect-freehand for beautiful, tapered strokes
 */

import { getStroke } from 'perfect-freehand';

/**
 * Enhanced options for manga-style drawing with pressure sensitivity
 * @param {Object} options - Custom options to override defaults
 * @returns {Object} Perfect-freehand options
 */
export function getMangaDrawingOptions(options = {}) {
  return {
    size: 8,                     // Base size of the stroke
    thinning: 0.5,               // How much to thin the stroke based on pressure (0 to 1)
    smoothing: 0.5,              // How much to smooth the stroke (0 to 1)
    streamline: 0.5,             // How much to streamline the stroke (0 to 1)
    easing: (t) => t * t,        // Easing function for stroke tapering - quadratic for manga feel
    start: {                     // Start of stroke cap
      taper: 20,                 // Tapering at the start
      cap: true,                 // Round cap
    },
    end: {                       // End of stroke cap
      taper: 20,                 // Tapering at the end
      cap: true,                 // Round cap
    },
    simulatePressure: true,      // Use simulated pressure if no pressure data available
    last: true,                  // Whether this is the last point (for proper end caps)
    ...options                   // Override with any custom options
  };
}

/**
 * Create enhanced highlighter options for manga-style highlights
 * @param {Object} options - Custom options to override defaults
 * @returns {Object} Perfect-freehand options for highlighter
 */
export function getMangaHighlighterOptions(options = {}) {
  return {
    size: 20,                    // Highlighters are thicker
    thinning: 0.1,               // Less thinning for consistent highlighting
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => t,            // Linear easing for consistent thickness
    start: {
      taper: 0,                  // No tapering for highlighter
      cap: true,
    },
    end: {
      taper: 0,
      cap: true,
    },
    simulatePressure: false,     // No pressure simulation for highlighter
    ...options
  };
}

/**
 * Create pen options optimized for sketching/drawing
 * @param {Object} options - Custom options to override defaults
 * @returns {Object} Perfect-freehand options for sketching
 */
export function getMangaSketchOptions(options = {}) {
  return {
    size: 5,                     // Thinner for sketching
    thinning: 0.6,               // More thinning for expressive lines
    smoothing: 0.2,              // Less smoothing for more natural look
    streamline: 0.4,
    easing: (t) => Math.sin(t * Math.PI/2), // Sinusoidal easing for manga-like tapering
    start: {
      taper: 5,                  // Light tapering at start
      cap: true,
    },
    end: {
      taper: 5,                  // Light tapering at end
      cap: true,
    },
    simulatePressure: true,
    ...options
  };
}

/**
 * Create perfect-freehand stroke with pressure sensitivity
 * @param {Array} points - Array of points with pressure data
 * @param {Object} options - Options for the stroke
 * @returns {Array} Stroke points for rendering
 */
export function getPressureSensitiveStroke(points, options = {}) {
  // Apply default manga options if not specified
  const strokeOptions = {
    ...getMangaDrawingOptions(),
    ...options
  };

  // Make sure we have points
  if (!points || points.length === 0) return [];

  // Get stroke from perfect-freehand
  return getStroke(points, strokeOptions);
}

/**
 * Generate SVG path data from a stroke
 * @param {Array} stroke - Stroke points from perfect-freehand
 * @returns {string} SVG path data
 */
export function getSvgPathFromStroke(stroke) {
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
 * Process drawing input with proper pressure and tapers
 * @param {Object} point - The point with x, y coordinates and pressure
 * @param {Array} currentPoints - Current points array
 * @param {string} drawingMode - 'pen', 'highlighter', or 'sketch'
 * @returns {Array} Updated points array with pressure data
 */
export function processDrawingInput(point, currentPoints = [], drawingMode = 'pen') {
  // Ensure we have a point with proper pressure data
  const processedPoint = [
    point.x,
    point.y,
    // Use actual pressure if available, otherwise use 0.5 as default
    typeof point.pressure === 'number' ? point.pressure : 0.5
  ];

  // Add the point to our current points
  const newPoints = [...currentPoints, processedPoint];

  // Get the appropriate options based on drawing mode
  let options;
  switch (drawingMode) {
    case 'highlighter':
      options = getMangaHighlighterOptions();
      break;
    case 'sketch':
      options = getMangaSketchOptions();
      break;
    case 'pen':
    default:
      options = getMangaDrawingOptions();
      break;
  }

  // Create a stroke with these points and options
  const stroke = getPressureSensitiveStroke(newPoints, options);

  // Generate SVG path data
  const pathData = getSvgPathFromStroke(stroke);

  return {
    points: newPoints,
    stroke,
    pathData
  };
}

/**
 * Draw to canvas with pressure sensitivity
 * @param {CanvasRenderingContext2D} context - Canvas context
 * @param {Array} points - Points with pressure data
 * @param {Object} options - Drawing options
 */
export function drawPressureSensitiveStroke(context, points, options = {}) {
  const stroke = getPressureSensitiveStroke(points, options);

  if (!stroke.length) return;

  const firstPoint = stroke[0];

  // Begin a new path
  context.beginPath();
  context.moveTo(firstPoint[0], firstPoint[1]);

  // For each point in the stroke, draw a curve to the midpoint between it and the next point
  for (let i = 1; i < stroke.length; i++) {
    const point = stroke[i];
    const nextPoint = stroke[(i + 1) % stroke.length];

    // If we have a next point, draw a quadratic curve to it,
    // with the current point as a control point
    if (nextPoint) {
      const midPoint = [(point[0] + nextPoint[0]) / 2, (point[1] + nextPoint[1]) / 2];
      context.quadraticCurveTo(point[0], point[1], midPoint[0], midPoint[1]);
    } else {
      // For the last point
      context.lineTo(point[0], point[1]);
    }
  }

  // Close the path if this is a complete stroke
  if (options.isComplete) {
    context.closePath();
  }

  // Fill and/or stroke the path
  if (options.fill) {
    context.fillStyle = options.fillStyle || 'black';
    context.fill();
  }

  if (options.stroke || !options.fill) {
    context.strokeStyle = options.strokeStyle || 'black';
    context.lineWidth = options.lineWidth || 1;
    context.stroke();
  }
}

/**
 * Detect if pressure input is available on the device
 * @returns {Promise<boolean>} True if pressure input is available
 */
export async function detectPressureSupport() {
  // Check if Pointer Events are supported
  if (!window.PointerEvent) return false;

  // Create a temporary element to test pressure
  const testElement = document.createElement('div');
  let hasPressure = false;

  const pointerDownHandler = (e) => {
    // Check if pressure property exists and is not 0
    if (e.pressure && e.pressure !== 0 && e.pressure !== 0.5) {
      hasPressure = true;
    }
  };

  // Add the event listener
  testElement.addEventListener('pointerdown', pointerDownHandler);

  // Append to document temporarily
  document.body.appendChild(testElement);

  // Wait for any pointer events (with a timeout)
  await new Promise(resolve => {
    // Resolve after a short delay even if no events occur
    setTimeout(resolve, 500);
  });

  // Clean up
  testElement.removeEventListener('pointerdown', pointerDownHandler);
  document.body.removeChild(testElement);

  return hasPressure;
}