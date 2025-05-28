/**
 * Quick Draw Sketch Recognition Service
 *
 * Uses TensorFlow.js to recognize sketches based on Google's Quick, Draw! dataset.
 * Implements a sketch classifier that can identify multiple objects in a single drawing.
 */

import * as tf from '@tensorflow/tfjs';
import { normalizeBoundingBox } from '$lib/utils/boundingBoxUtils';

// Categories from Quick, Draw! dataset that we'll recognize
// Using a subset of common categories that are most likely to be drawn
const QUICK_DRAW_CATEGORIES = [
  'face', 'eye', 'nose', 'mouth', 'ear', 'hand', 'foot',
  'cat', 'dog', 'bird', 'fish', 'house', 'tree', 'flower',
  'car', 'airplane', 'boat', 'sun', 'moon', 'star',
  'circle', 'square', 'triangle', 'heart', 'arrow'
];

// Cache the model globally
let quickDrawModel = null;
let isModelLoading = false;

// Path to the model in public directory
const MODEL_URL = '/models/quickdraw/model.json';

/**
 * Load the Quick Draw recognition model
 * @returns {Promise<tf.LayersModel>} The loaded TensorFlow.js model
 */
export async function loadQuickDrawModel() {
  if (quickDrawModel) {
    return quickDrawModel;
  }

  if (isModelLoading) {
    // Wait for the model to finish loading if already in progress
    while (isModelLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return quickDrawModel;
  }

  try {
    isModelLoading = true;
    console.log('Loading Quick Draw recognition model...');

    // Ensure TensorFlow.js is ready
    await tf.ready();

    // Load model from the public directory
    // Note: The model needs to be placed in the public/models/quickdraw directory
    quickDrawModel = await tf.loadLayersModel(MODEL_URL);

    console.log('Quick Draw model loaded successfully');
    return quickDrawModel;
  } catch (error) {
    console.error('Error loading Quick Draw model:', error);
    throw new Error(`Failed to load Quick Draw model: ${error.message}`);
  } finally {
    isModelLoading = false;
  }
}

/**
 * Preprocess canvas for sketch recognition
 * @param {HTMLCanvasElement} canvas - Canvas containing the sketch
 * @returns {tf.Tensor} Preprocessed tensor ready for model input
 */
function preprocessCanvas(canvas) {
  return tf.tidy(() => {
    // Convert canvas to tensor
    let tensor = tf.browser.fromPixels(canvas, 1); // Grayscale

    // Resize to 28x28 (Quick Draw models typically use this size)
    tensor = tf.image.resizeBilinear(tensor, [28, 28]);

    // Normalize values to 0-1
    tensor = tensor.div(255.0);

    // Invert colors (Quick Draw uses white on black)
    tensor = tf.scalar(1.0).sub(tensor);

    // Reshape to match model input [batch, height, width, channels]
    return tensor.expandDims(0);
  });
}

/**
 * Extract image regions based on strokes to identify individual objects
 * @param {HTMLCanvasElement} canvas - Original canvas with the drawing
 * @param {Array} strokes - Array of strokes data
 * @returns {Array<{region: HTMLCanvasElement, boundingBox: Object}>} Extracted regions
 */
function extractRegionsFromStrokes(canvas, strokes) {
  if (!strokes || strokes.length === 0) {
    return [];
  }

  const regions = [];
  const ctx = canvas.getContext('2d');
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // Group strokes that are close together
  const strokeGroups = groupRelatedStrokes(strokes);

  // For each group, extract a region
  strokeGroups.forEach(group => {
    // Find bounding box of the stroke group
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;

    group.forEach(stroke => {
      stroke.points.forEach(point => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      });
    });

    // Add padding to the region
    const padding = 10;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvasWidth, maxX + padding);
    maxY = Math.min(canvasHeight, maxY + padding);

    const width = maxX - minX;
    const height = maxY - minY;

    // Skip tiny regions
    if (width < 20 || height < 20) {
      return;
    }

    // Create a new canvas for this region
    const regionCanvas = document.createElement('canvas');
    regionCanvas.width = 224; // Standard size for classification
    regionCanvas.height = 224;
    const regionCtx = regionCanvas.getContext('2d');

    // Extract the region from the original canvas
    regionCtx.drawImage(
      canvas,
      minX, minY, width, height,
      0, 0, 224, 224
    );

    // Create normalized bounding box
    const boundingBox = {
      minX: minX / canvasWidth,
      minY: minY / canvasHeight,
      width: width / canvasWidth,
      height: height / canvasHeight,
      maxX: maxX / canvasWidth,
      maxY: maxY / canvasHeight
    };

    // Add region to results
    regions.push({
      region: regionCanvas,
      boundingBox: normalizeBoundingBox(boundingBox, canvasWidth, canvasHeight),
      strokes: group
    });
  });

  return regions;
}

/**
 * Group strokes that are likely part of the same object
 * @param {Array} strokes - Array of strokes
 * @returns {Array<Array>} Grouped strokes
 */
function groupRelatedStrokes(strokes) {
  if (!strokes || strokes.length === 0) {
    return [];
  }

  // For single stroke, return as one group
  if (strokes.length === 1) {
    return [strokes];
  }

  // Clone strokes to avoid modifying the original
  const remainingStrokes = [...strokes];
  const groups = [];

  while (remainingStrokes.length > 0) {
    // Start a new group with the first stroke
    const currentGroup = [remainingStrokes.shift()];

    // Find related strokes
    let i = 0;
    while (i < remainingStrokes.length) {
      const stroke = remainingStrokes[i];

      // Check if this stroke is related to any in the current group
      const isRelated = currentGroup.some(groupStroke =>
        areStrokesRelated(groupStroke, stroke)
      );

      if (isRelated) {
        // Add to group and remove from remaining
        currentGroup.push(stroke);
        remainingStrokes.splice(i, 1);
      } else {
        i++;
      }
    }

    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Check if two strokes are related (close to each other)
 * @param {Object} stroke1 - First stroke
 * @param {Object} stroke2 - Second stroke
 * @returns {boolean} True if strokes are related
 */
function areStrokesRelated(stroke1, stroke2) {
  // Calculate centroids
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;

  stroke1.points.forEach(p => {
    x1 += p.x;
    y1 += p.y;
  });

  stroke2.points.forEach(p => {
    x2 += p.x;
    y2 += p.y;
  });

  x1 /= stroke1.points.length;
  y1 /= stroke1.points.length;
  x2 /= stroke2.points.length;
  y2 /= stroke2.points.length;

  // Calculate distance between centroids
  const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

  // Consider related if within threshold distance
  // Adjust this threshold based on your canvas size and use case
  return distance < 100;
}

/**
 * Recognize sketches in a drawing canvas
 * @param {HTMLCanvasElement} canvas - Canvas containing the drawing
 * @param {Array} strokes - Array of strokes data
 * @returns {Promise<Array>} Detected objects with bounding boxes and confidence scores
 */
export async function recognizeSketch(canvas, strokes) {
  if (!canvas || !strokes || strokes.length === 0) {
    return [];
  }

  try {
    // Make sure the model is loaded
    const model = await loadQuickDrawModel();

    // Extract regions from the drawing
    const regions = extractRegionsFromStrokes(canvas, strokes);
    console.log(`Extracted ${regions.length} regions from the sketch`);

    if (regions.length === 0) {
      return [];
    }

    // Process each region
    const results = await Promise.all(regions.map(async ({ region, boundingBox, strokes }) => {
      try {
        // Preprocess the region
        const input = preprocessCanvas(region);

        // Run inference
        const predictions = await model.predict(input).data();

        // Get the top prediction
        let maxProb = 0;
        let bestClass = -1;

        for (let i = 0; i < predictions.length; i++) {
          if (predictions[i] > maxProb) {
            maxProb = predictions[i];
            bestClass = i;
          }
        }

        // Clean up tensor
        input.dispose();

        // Get the class name
        const className = QUICK_DRAW_CATEGORIES[bestClass] || 'unknown';

        return {
          name: className,
          confidence: maxProb,
          boundingBox: boundingBox,
          source: 'quick-draw',
          strokeIds: strokes.map(s => s.id)
        };
      } catch (regionError) {
        console.error('Error processing region:', regionError);
        return null;
      }
    }));

    // Filter out failed regions and sort by confidence
    return results
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence);

  } catch (error) {
    console.error('Error in Quick Draw recognition:', error);
    return [];
  }
}

/**
 * Analyze a full sketch for objects using the Quick Draw model
 * @param {HTMLCanvasElement} canvas - Canvas with drawing
 * @param {Array} strokes - Array of strokes
 * @returns {Promise<Array>} Detected objects
 */
export async function analyzeQuickDraw(canvas, strokes) {
  try {
    // First, try to recognize the whole sketch as a single object
    let results = await recognizeSketch(canvas, strokes);

    // If confidence is low or no results, try individual regions
    if (results.length === 0 || (results.length === 1 && results[0].confidence < 0.6)) {
      console.log('Low confidence for whole sketch, trying region-based detection');
      results = await recognizeSketch(canvas, strokes);
    }

    // Process and format the results
    return results.map(result => ({
      name: result.name,
      confidence: result.confidence,
      boundingBox: result.boundingBox,
      source: 'quick-draw',
      detectionSource: 'quick-draw',
      strokeIds: result.strokeIds
    }));
  } catch (error) {
    console.error('Error in Quick Draw analysis:', error);
    return [];
  }
}