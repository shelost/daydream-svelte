/**
 * Utilities for working with bounding boxes in different formats
 */

import type { BoundingBox } from '$lib/types/detectedObject';

/**
 * Normalize a bounding box from shape recognition format (x, y, width, height)
 * to standard normalized format (minX, minY, maxX, maxY, centerX, centerY)
 *
 * @param {BoundingBox} bbox - The bounding box to normalize
 * @param {number} canvasWidth - Canvas width for normalization
 * @param {number} canvasHeight - Canvas height for normalization
 * @returns {BoundingBox} Normalized bounding box
 */
export function normalizeBoundingBox(
  bbox: BoundingBox,
  canvasWidth: number,
  canvasHeight: number
): BoundingBox {
  if (!bbox) return null;

  // If already normalized, just return
  if (bbox.minX !== undefined && bbox.maxX !== undefined) {
    return bbox;
  }

  // Starting with x, y, width, height format
  const x = bbox.x !== undefined ? bbox.x : 0;
  const y = bbox.y !== undefined ? bbox.y : 0;

  // Convert to normalized format
  const minX = x / canvasWidth;
  const minY = y / canvasHeight;
  const maxX = (x + bbox.width) / canvasWidth;
  const maxY = (y + bbox.height) / canvasHeight;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    x: x,
    y: y,
    minX,
    minY,
    maxX,
    maxY,
    width: bbox.width / canvasWidth,
    height: bbox.height / canvasHeight,
    centerX,
    centerY
  };
}

/**
 * Convert a normalized bounding box to pixel coordinates
 *
 * @param {BoundingBox} bbox - The normalized bounding box
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {BoundingBox} Pixel-based bounding box
 */
export function denormalizeBoundingBox(
  bbox: BoundingBox,
  canvasWidth: number,
  canvasHeight: number
): BoundingBox {
  if (!bbox) return null;

  // If minX and maxX are not provided, try to use x and width
  const minX = bbox.minX !== undefined ? bbox.minX * canvasWidth : (bbox.x || 0);
  const minY = bbox.minY !== undefined ? bbox.minY * canvasHeight : (bbox.y || 0);

  // Calculate width and height from min/max values or use the original values
  const width = bbox.maxX !== undefined
    ? (bbox.maxX - bbox.minX) * canvasWidth
    : bbox.width * canvasWidth;

  const height = bbox.maxY !== undefined
    ? (bbox.maxY - bbox.minY) * canvasHeight
    : bbox.height * canvasHeight;

  // Calculate center
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    minX: Math.round(minX),
    minY: Math.round(minY),
    maxX: Math.round(minX + width),
    maxY: Math.round(minY + height),
    width: Math.round(width),
    height: Math.round(height),
    centerX: Math.round(centerX),
    centerY: Math.round(centerY)
  };
}

/**
 * Ensure a bounding box is complete with all properties
 *
 * @param {BoundingBox} bbox - The bounding box to complete
 * @returns {BoundingBox} Complete bounding box
 */
export function completeBoundingBox(bbox: BoundingBox): BoundingBox {
  if (!bbox) return null;

  // Get properties from the bounding box
  const width = bbox.width;
  const height = bbox.height;

  // Calculate minX, minY if not provided
  const minX = bbox.minX !== undefined ? bbox.minX : (bbox.x !== undefined ? bbox.x : 0);
  const minY = bbox.minY !== undefined ? bbox.minY : (bbox.y !== undefined ? bbox.y : 0);

  // Calculate maxX, maxY if not provided
  const maxX = bbox.maxX !== undefined ? bbox.maxX : minX + width;
  const maxY = bbox.maxY !== undefined ? bbox.maxY : minY + height;

  // Calculate centerX, centerY if not provided
  const centerX = bbox.centerX !== undefined ? bbox.centerX : (minX + maxX) / 2;
  const centerY = bbox.centerY !== undefined ? bbox.centerY : (minY + maxY) / 2;

  return {
    x: bbox.x !== undefined ? bbox.x : minX,
    y: bbox.y !== undefined ? bbox.y : minY,
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX,
    centerY
  };
}

/**
 * Calculate IoU (Intersection over Union) between two bounding boxes
 *
 * @param {BoundingBox} bbox1 - First bounding box
 * @param {BoundingBox} bbox2 - Second bounding box
 * @returns {number} IoU value (0-1)
 */
export function calculateIoU(bbox1: BoundingBox, bbox2: BoundingBox): number {
  if (!bbox1 || !bbox2) return 0;

  // Complete bounding boxes to ensure all properties are available
  const box1 = completeBoundingBox(bbox1);
  const box2 = completeBoundingBox(bbox2);

  // Calculate intersection
  const xOverlap = Math.max(0, Math.min(box1.maxX, box2.maxX) - Math.max(box1.minX, box2.minX));
  const yOverlap = Math.max(0, Math.min(box1.maxY, box2.maxY) - Math.max(box1.minY, box2.minY));
  const intersectionArea = xOverlap * yOverlap;

  // Calculate areas
  const box1Area = box1.width * box1.height;
  const box2Area = box2.width * box2.height;

  // Calculate union
  const unionArea = box1Area + box2Area - intersectionArea;

  // Return IoU
  return unionArea > 0 ? intersectionArea / unionArea : 0;
}