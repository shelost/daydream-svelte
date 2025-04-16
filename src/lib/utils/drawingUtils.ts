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