/**
 * Analysis integration service combining TensorFlow.js object detection with OpenAI Vision
 * and CNN-based sketch recognition
 */

import { analyzeTensorflowBoundingBoxes, findContours } from './tensorflowService';
import { enhanceWithSketchCNN, analyzeSketchRegions } from './sketchCNN';
import {
  calculateMultiStrokeBoundingBox,
  findRelatedStrokes,
  normalizeBoundingBox
} from '$lib/utils/drawingUtils.js';

/**
 * Combines all available analysis techniques including CNN-based sketch recognition
 * @param {HTMLCanvasElement} canvas - Canvas element with the drawing
 * @param {Array} openAiElements - Elements detected by OpenAI Vision API
 * @param {Array} strokes - Drawing strokes data
 * @returns {Promise<Array>} Enhanced elements with precise bounding boxes
 */
export async function enhanceBoundingBoxes(canvas, openAiElements, strokes) {
  if (!canvas || !openAiElements || !openAiElements.length) {
    return openAiElements;
  }

  try {
    // Run TensorFlow.js detection
    const tfDetections = await analyzeTensorflowBoundingBoxes(canvas);

    // Enhance OpenAI detections with TensorFlow results
    const tfEnhancedElements = await mergeDetections(
      openAiElements,
      tfDetections,
      strokes,
      canvas.width,
      canvas.height
    );

    // Further enhance with CNN-based sketch recognition
    const cnnEnhancedElements = await enhanceWithSketchCNN(
      tfEnhancedElements,
      canvas,
      strokes
    );

    // Find contours for the enhanced elements
    const elementsWithContours = await findContours(canvas, cnnEnhancedElements);

    return elementsWithContours;
  } catch (error) {
    console.error('Error enhancing bounding boxes:', error);

    // Fallback to stroke-based bounding boxes
    const enhancedWithStrokes = enhanceWithStrokes(openAiElements, strokes, canvas.width, canvas.height);

    // Try to use CNN as a final fallback
    try {
      return await enhanceWithSketchCNN(enhancedWithStrokes, canvas, strokes);
    } catch (cnnError) {
      console.error('CNN enhancement failed as fallback:', cnnError);
      return enhancedWithStrokes;
    }
  }
}

/**
 * Merge OpenAI Vision analysis results with TensorFlow.js detections
 * @param {Array} openAiElements - Elements from OpenAI
 * @param {Array} tfDetections - Detections from TensorFlow.js
 * @param {Array} strokes - Drawing strokes
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Array} Merged and enhanced elements
 */
async function mergeDetections(openAiElements, tfDetections, strokes, canvasWidth, canvasHeight) {
  return openAiElements.map(oaiElement => {
    // Try to find matching TensorFlow detection
    const matchingTf = findMatchingDetection(oaiElement, tfDetections);

    if (matchingTf) {
      // Use TensorFlow's more precise bounding box
      return {
        ...oaiElement,
        boundingBox: matchingTf.boundingBox,
        confidence: matchingTf.confidence,
        detectionSource: 'tensorflow'
      };
    }

    // If no TensorFlow match, try to find related strokes
    const relatedStrokes = findRelatedStrokes(
      strokes,
      oaiElement.position?.x || 0.5,
      oaiElement.position?.y || 0.5,
      canvasWidth,
      canvasHeight,
      0.15 // Search radius
    );

    if (relatedStrokes && relatedStrokes.length > 0) {
      // Calculate precise bounding box from strokes
      const strokeBounds = calculateMultiStrokeBoundingBox(relatedStrokes);

      // Normalize to 0-1 range
      const normalizedBounds = normalizeBoundingBox(
        strokeBounds,
        canvasWidth,
        canvasHeight
      );

      return {
        ...oaiElement,
        boundingBox: normalizedBounds,
        detectionSource: 'strokes',
        strokeIds: relatedStrokes.map(s => s.id || ''),
        enhancedByStrokes: true
      };
    }

    // Fallback to a default bounding box based on the position
    return createFallbackBoundingBox(oaiElement);
  });
}

/**
 * Find a matching TensorFlow.js detection for an OpenAI element
 * @param {Object} oaiElement - Element from OpenAI
 * @param {Array} tfDetections - Detections from TensorFlow.js
 * @returns {Object|null} Matching detection or null
 */
function findMatchingDetection(oaiElement, tfDetections) {
  if (!tfDetections || !tfDetections.length) return null;

  // Get the position of the OpenAI element
  const oaiX = oaiElement.position?.x || 0.5;
  const oaiY = oaiElement.position?.y || 0.5;

  // Try to find a match by position and name
  const positionMatches = tfDetections.filter(tf => {
    // Check if positions are close
    const centerX = tf.boundingBox.centerX;
    const centerY = tf.boundingBox.centerY;

    const distanceX = Math.abs(centerX - oaiX);
    const distanceY = Math.abs(centerY - oaiY);

    // Position is within 15% of canvas dimensions
    const isClose = distanceX < 0.15 && distanceY < 0.15;

    // Check if names match (case insensitive)
    const nameMatch = tf.name && oaiElement.name &&
      tf.name.toLowerCase() === oaiElement.name.toLowerCase();

    // Match by position if names don't match
    return isClose && (nameMatch || !nameMatch);
  });

  // If multiple matches, prefer the one with matching name
  if (positionMatches.length > 1) {
    const nameMatch = positionMatches.find(
      tf => tf.name &&
      oaiElement.name &&
      tf.name.toLowerCase() === oaiElement.name.toLowerCase()
    );

    if (nameMatch) return nameMatch;
  }

  // Return the first match or null
  return positionMatches[0] || null;
}

/**
 * Enhance OpenAI elements with stroke-based bounding boxes
 * @param {Array} elements - Elements to enhance
 * @param {Array} strokes - Drawing strokes
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Array} Enhanced elements
 */
function enhanceWithStrokes(elements, strokes, canvasWidth, canvasHeight) {
  if (!elements || !elements.length || !strokes || !strokes.length) {
    return elements;
  }

  return elements.map(element => {
    // Skip if already has a bounding box
    if (element.boundingBox && element.enhancedByStrokes) return element;

    // Get the position of the element
    const elementX = element.position?.x || 0.5;
    const elementY = element.position?.y || 0.5;

    // Find related strokes
    const relatedStrokes = findRelatedStrokes(
      strokes,
      elementX,
      elementY,
      canvasWidth,
      canvasHeight,
      0.15 // Search radius
    );

    if (relatedStrokes && relatedStrokes.length > 0) {
      // Calculate bounding box from strokes
      const strokeBounds = calculateMultiStrokeBoundingBox(relatedStrokes);

      // Normalize to 0-1 range
      const normalizedBounds = normalizeBoundingBox(
        strokeBounds,
        canvasWidth,
        canvasHeight
      );

      return {
        ...element,
        boundingBox: normalizedBounds,
        strokeIds: relatedStrokes.map(s => s.id || ''),
        enhancedByStrokes: true,
        detectionSource: 'strokes'
      };
    }

    // Fallback
    return createFallbackBoundingBox(element);
  });
}

/**
 * Create a fallback bounding box for an element
 * @param {Object} element - Element to create a bounding box for
 * @returns {Object} Element with a fallback bounding box
 */
function createFallbackBoundingBox(element) {
  // Use the element's position, or center if not available
  const position = element.position || { x: 0.5, y: 0.5 };

  // Size based on element type
  let width = 0.1;
  let height = 0.1;

  // Adjust size based on element type
  const name = (element.name || '').toLowerCase();

  if (name.includes('face') || name.includes('head')) {
    width = 0.15;
    height = 0.15;
  } else if (name.includes('body') || name.includes('person')) {
    width = 0.2;
    height = 0.4;
  } else if (name.includes('eye')) {
    width = 0.05;
    height = 0.03;
  } else if (name.includes('nose')) {
    width = 0.05; // Made smaller for more precise detection
    height = 0.08;
  } else if (name.includes('mouth')) {
    width = 0.08;
    height = 0.04;
  } else if (name.includes('hair')) {
    width = 0.2;
    height = 0.1;
  }

  // Calculate bounding box
  const minX = Math.max(0, position.x - width / 2);
  const minY = Math.max(0, position.y - height / 2);
  const maxX = Math.min(1, position.x + width / 2);
  const maxY = Math.min(1, position.y + height / 2);

  return {
    ...element,
    boundingBox: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: position.x,
      centerY: position.y
    },
    detectionSource: 'fallback'
  };
}

/**
 * Directly run sketch recognition using CNN without other detectors
 * Useful for initial sketch analysis before OpenAI Vision
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Array} strokes - Stroke data
 * @returns {Promise<Array>} Detected objects
 */
export async function analyzeSketchWithCNN(canvas, strokes) {
  if (!canvas || !strokes || strokes.length === 0) {
    return [];
  }

  try {
    // Run direct CNN analysis
    return await analyzeSketchRegions(canvas, strokes);
  } catch (error) {
    console.error('Error in direct CNN sketch analysis:', error);
    return [];
  }
}

/**
 * Prepare structural details for OpenAI image generation
 * @param {Array} elements - Enhanced elements with precise bounds
 * @returns {Object} Formatted structural information
 */
export function prepareStructuralDetails(elements) {
  if (!elements || elements.length === 0) {
    return null;
  }

  // Create a hierarchical structure for parent/child elements
  const hierarchicalElements = buildElementHierarchy(elements);

  return {
    elementCount: elements.length,
    elements: hierarchicalElements
  };
}

/**
 * Build a hierarchical structure of elements with parent/child relationships
 * @param {Array} elements - List of elements
 * @returns {Array} Elements with hierarchy information
 */
function buildElementHierarchy(elements) {
  if (!elements || elements.length === 0) return [];

  // First pass: identify potential parent-child relationships
  const elementsWithRelations = elements.map(element => {
    const containedElements = findContainedElements(element, elements);

    return {
      ...element,
      id: element.id || generateId(),
      children: containedElements.map(e => e.id || generateId()),
      isContainer: containedElements.length > 0
    };
  });

  // Second pass: add parent references
  return elementsWithRelations.map(element => {
    const parentElement = findParentElement(element, elementsWithRelations);

    return {
      ...element,
      parentId: parentElement ? parentElement.id : null,
      isChild: parentElement !== null
    };
  });
}

/**
 * Find elements contained within another element
 * @param {Object} container - Potential container element
 * @param {Array} elements - All elements
 * @returns {Array} Contained elements
 */
function findContainedElements(container, elements) {
  if (!container.boundingBox) return [];

  return elements.filter(element => {
    // Skip self
    if (element === container) return false;

    // Check if element is contained within container
    return isElementContained(element, container);
  });
}

/**
 * Check if an element is contained within another element
 * @param {Object} element - Element to check
 * @param {Object} container - Potential container
 * @returns {boolean} True if contained
 */
function isElementContained(element, container) {
  if (!element.boundingBox || !container.boundingBox) return false;

  const eBB = element.boundingBox;
  const cBB = container.boundingBox;

  // Check if element's center is within container
  const elementCenterX = eBB.centerX || (eBB.minX + eBB.width / 2);
  const elementCenterY = eBB.centerY || (eBB.minY + eBB.height / 2);

  // Element is contained if its center is within container and
  // element's area is smaller than container's
  return (
    elementCenterX >= cBB.minX &&
    elementCenterX <= cBB.maxX &&
    elementCenterY >= cBB.minY &&
    elementCenterY <= cBB.maxY &&
    eBB.width * eBB.height < cBB.width * cBB.height * 0.9 // Element is at least 10% smaller
  );
}

/**
 * Find the parent element of an element
 * @param {Object} element - Element to find parent for
 * @param {Array} elements - All elements
 * @returns {Object|null} Parent element or null
 */
function findParentElement(element, elements) {
  if (!element.boundingBox) return null;

  // Find all potential parents (elements that contain this element)
  const potentialParents = elements.filter(potential => {
    // Skip self
    if (potential === element) return false;

    return isElementContained(element, potential);
  });

  if (!potentialParents.length) return null;

  // If multiple potential parents, choose the smallest one
  return potentialParents.reduce((smallest, current) => {
    const smallestArea = smallest.boundingBox.width * smallest.boundingBox.height;
    const currentArea = current.boundingBox.width * current.boundingBox.height;

    return currentArea < smallestArea ? current : smallest;
  }, potentialParents[0]);
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}