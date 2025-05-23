/**
 * Custom edge path generation utilities
 *
 * This module provides functions for generating SVG path data for different
 * types of edges in a flow chart or diagram.
 */

// Type definitions (simplified for compatibility)
interface EdgePathParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: string;
  targetPosition?: string;
}

/**
 * Creates a straight path between two points
 *
 * @param params - The parameters for generating the path
 * @returns An array containing the SVG path string and null values for other path elements
 */
export function getStraightPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgePathParams): [string, null, null, null] {
  // Simple straight line from source to target
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;

  // Return in the same format as the original function: [path, null, null, null]
  return [path, null, null, null];
}

/**
 * Calculates the center point of a straight edge
 * Useful for edge labels or decorations
 *
 * @param params - The parameters for the edge
 * @returns The center point coordinates
 */
export function getStraightEdgeCenter({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgePathParams): { x: number; y: number } {
  return {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };
}