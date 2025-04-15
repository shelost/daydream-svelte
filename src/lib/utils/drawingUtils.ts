import { getStroke } from 'perfect-freehand';
import type { StrokeOptions } from 'perfect-freehand';
import type { Stroke, StrokePoint } from '$lib/types';

/**
 * Convert perfect-freehand stroke points to SVG path data
 */
export function getSvgPathFromStroke(
  points: number[][],
  closed = true
): string {
  const len = points.length;

  if (len < 4) {
    return '';
  }

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(
    2
  )},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(
    b[1],
    c[1]
  ).toFixed(2)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(
      2
    )} `;
  }

  if (closed) {
    result += 'Z';
  }

  return result;
}

/**
 * Helper function to calculate the average of two numbers
 */
function average(a: number, b: number): number {
  return (a + b) / 2;
}

/**
 * Get perfect-freehand options based on stroke settings
 */
export function getPerfectFreehandOptions(
  size: number,
  thinning: number = 0.5,
  smoothing: number = 0.5,
  streamline: number = 0.5,
  simulatePressure: boolean = true,
  capStart: boolean = true,
  capEnd: boolean = true,
  taperStart: number = 0,
  taperEnd: number = 0
): StrokeOptions {
  return {
    size,
    thinning,
    smoothing,
    streamline,
    simulatePressure,
    last: true,
    start: {
      cap: capStart,
      taper: taperStart > 0 ? taperStart : false,
      easing: (t) => t,
    },
    end: {
      cap: capEnd,
      taper: taperEnd > 0 ? taperEnd : false,
      easing: (t) => t,
    },
  };
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
  const defaultOptions = getPerfectFreehandOptions(stroke.size);

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
 * Calculates a pressure value based on stroke velocity
 */
export function calculatePressureFromVelocity(
  points: StrokePoint[],
  index: number,
  maxVelocity: number = 10
): number {
  if (index <= 1 || index >= points.length - 1) {
    return 0.5; // Default pressure for endpoints
  }

  const currentPoint = points[index];
  const prevPoint = points[index - 1];

  // Calculate distance between points
  const dx = currentPoint.x - prevPoint.x;
  const dy = currentPoint.y - prevPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Simple velocity (distance without time factor)
  // For real velocity we would need time information
  const velocity = Math.min(distance, maxVelocity);

  // Convert velocity to pressure (inverse relationship)
  // Higher velocity = lower pressure
  return 1 - velocity / maxVelocity;
}