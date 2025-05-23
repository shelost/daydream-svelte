/**
 * Enhanced pressure sensitivity utilities for perfect-freehand integration
 * Provides tools to detect hardware pressure, calculate pressure from velocity,
 * and integrate seamlessly with perfect-freehand drawing library
 */

import { getStroke } from 'perfect-freehand';
import { calculatePressureFromVelocity } from './drawingUtils.js';

/**
 * Check if device supports pressure sensitivity
 * @returns {Promise<boolean>} Whether pressure is supported
 */
export async function detectPressureSupport() {
  // Check if Pointer Events are supported
  if (typeof window === 'undefined' || !window.PointerEvent) return false;

  return new Promise(resolve => {
    // Create a test element to check for pressure
    const testElement = document.createElement('div');
    let hasPressure = false;
    let checkCount = 0;

    // Handler for pointer events
    const pointerHandler = (e) => {
      // If pressure exists and is not the default 0.5 value
      if (e.pressure !== undefined && e.pressure !== 0 && e.pressure !== 0.5) {
        hasPressure = true;
        cleanup();
        resolve(true);
      }

      // Increment check count and resolve after a few checks
      checkCount++;
      if (checkCount >= 5) {
        cleanup();
        resolve(hasPressure);
      }
    };

    // Cleanup function
    const cleanup = () => {
      testElement.removeEventListener('pointermove', pointerHandler);
      testElement.removeEventListener('pointerdown', pointerHandler);
      if (document.body.contains(testElement)) {
        document.body.removeChild(testElement);
      }
    };

    // Add event listeners
    testElement.addEventListener('pointermove', pointerHandler);
    testElement.addEventListener('pointerdown', pointerHandler);

    // Add to DOM temporarily
    testElement.style.position = 'fixed';
    testElement.style.top = '0';
    testElement.style.left = '0';
    testElement.style.width = '100px';
    testElement.style.height = '100px';
    testElement.style.opacity = '0.01';
    testElement.style.pointerEvents = 'auto';
    document.body.appendChild(testElement);

    // Resolve after timeout in case no events are triggered
    setTimeout(() => {
      cleanup();
      resolve(hasPressure);
    }, 1000);
  });
}

/**
 * Get perfect-freehand options with optimal pressure settings
 * @param {Object} options - Override options
 * @param {boolean} hasPressureSupport - Whether device has pressure support
 * @returns {Object} Configuration for perfect-freehand
 */
export function getPressureSensitiveOptions(options = {}, hasPressureSupport = false) {
  return {
    size: 8,
    thinning: 0.5,              // Thinning allows pressure to affect stroke width
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => t * t,       // Quadratic easing for more natural feel
    start: {
      taper: 10,                // Gradually taper the start
      cap: true
    },
    end: {
      taper: 10,
      cap: true
    },
    // Only simulate pressure if hardware doesn't support it
    simulatePressure: !hasPressureSupport,
    // Blend hardware pressure with velocity-based when available
    pressureEnabled: true,
    ...options
  };
}

/**
 * Process stroke points with pressure data
 * Combines hardware pressure (if available) with velocity-based calculation
 * for consistent pressure-sensitive drawing across all devices
 *
 * @param {Array} points - Raw input points
 * @param {boolean} hasPressureSupport - Whether device has pressure support
 * @param {Object} options - Additional options
 * @returns {Array} Processed points with enhanced pressure data
 */
export function processPointsWithPressure(points, hasPressureSupport = false, options = {}) {
  const {
    velocityScale = 0.2,
    minPressure = 0.2,
    maxPressure = 0.8,
    blendFactor = 0.7 // How much to blend hardware vs. calculated pressure (0-1)
  } = options;

  if (!points || points.length === 0) return points;

  const processedPoints = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    let finalPressure;

    // Calculate velocity-based pressure
    const velocityPressure = calculatePressureFromVelocity(
      points,
      i,
      velocityScale
    );

    if (hasPressureSupport && point.pressure !== undefined && point.pressure > 0) {
      // Hardware pressure is available - normalize it to our range
      const normalizedHardwarePressure =
        minPressure + (point.pressure * (maxPressure - minPressure));

      // Blend hardware and velocity-based pressure for best results
      finalPressure = (normalizedHardwarePressure * blendFactor) +
                      (velocityPressure * (1 - blendFactor));
    } else {
      // No hardware pressure - use velocity-based only
      finalPressure = velocityPressure;
    }

    // Clamp to ensure pressure stays in valid range
    finalPressure = Math.max(minPressure, Math.min(maxPressure, finalPressure));

    // Create a new point with the calculated pressure
    processedPoints.push([
      point.x,
      point.y,
      finalPressure
    ]);
  }

  return processedPoints;
}

/**
 * Generate SVG path data from stroke points using perfect-freehand
 * @param {Array} points - Processed points with pressure
 * @param {Object} options - Options for perfect-freehand
 * @returns {string} SVG path data
 */
export function getSvgPathFromStrokeWithPressure(points, options = {}) {
  // Get stroke outline from perfect-freehand
  const stroke = getStroke(points, {
    size: 8,
    thinning: 0.5,
    smoothing: 0.5,
    ...options
  });

  // Return empty string if no stroke
  if (!stroke || stroke.length === 0) return '';

  // Convert to SVG path
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
 * Debug pressure data by visualizing it
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} points - Points with pressure data
 */
export function visualizePressureData(ctx, points) {
  if (!ctx || !points || points.length === 0) return;

  ctx.save();

  // Draw points with colors based on pressure
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const pressure = Array.isArray(point) ? point[2] : (point.pressure || 0.5);

    // Calculate color (red for low pressure, green for high)
    const r = Math.floor(255 * (1 - pressure));
    const g = Math.floor(255 * pressure);
    const b = 50;

    // Draw pressure point
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    const size = 4 + (pressure * 8); // Size based on pressure

    // Determine coordinates based on point format
    const x = Array.isArray(point) ? point[0] : point.x;
    const y = Array.isArray(point) ? point[1] : point.y;

    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // Draw pressure value
    ctx.fillStyle = 'white';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pressure.toFixed(2), x, y - 10);
  }

  ctx.restore();
}