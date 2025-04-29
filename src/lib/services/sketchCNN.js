/**
 * Sketch CNN Service - A specialized CNN model for sketch recognition
 * Works alongside the existing TensorFlow service to provide enhanced
 * sketch-specific object detection and more precise bounding boxes
 */

import * as tf from '@tensorflow/tfjs';
import { findRelatedStrokes, calculateMultiStrokeBoundingBox } from '$lib/utils/drawingUtils.js';

// Model state management
let sketchModel = null;
let isModelLoading = false;
const CLASS_NAMES = [
  'eye', 'nose', 'mouth', 'ear', 'face',
  'head', 'body', 'hand', 'foot', 'hair',
  'circle', 'rectangle', 'triangle', 'line', 'arrow',
  'star', 'heart', 'cloud', 'tree', 'flower'
];

/**
 * Create a CNN model architecture specialized for sketch recognition
 * @returns {tf.LayersModel} The model
 */
function createSketchCNNModel() {
  // Create a model for 128x128 grayscale sketch images
  const model = tf.sequential();

  // First convolutional layer
  // Input shape: [128, 128, 1] - grayscale image
  model.add(tf.layers.conv2d({
    inputShape: [128, 128, 1],
    filters: 16,
    kernelSize: 3,
    strides: 1,
    padding: 'same',
    activation: 'relu',
    kernelInitializer: 'heNormal'
  }));
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  // Second convolutional layer - increasing filters
  model.add(tf.layers.conv2d({
    filters: 32,
    kernelSize: 3,
    strides: 1,
    padding: 'same',
    activation: 'relu',
    kernelInitializer: 'heNormal'
  }));
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  // Third convolutional layer with dropout
  model.add(tf.layers.conv2d({
    filters: 64,
    kernelSize: 3,
    strides: 1,
    padding: 'same',
    activation: 'relu'
  }));
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
  model.add(tf.layers.dropout({ rate: 0.25 }));

  // Flatten and dense layers
  model.add(tf.layers.flatten());
  model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.5 }));

  // Output layer - one unit per class
  model.add(tf.layers.dense({
    units: CLASS_NAMES.length,
    activation: 'softmax'
  }));

  // Compile the model
  model.compile({
    optimizer: 'adam',
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });

  return model;
}

/**
 * Initialize and return the sketch CNN model
 * Uses a pre-trained model if available, otherwise creates a new one
 * @returns {Promise<tf.LayersModel>} The CNN model
 */
export async function getSketchCNNModel() {
  if (sketchModel) {
    return sketchModel;
  }

  if (isModelLoading) {
    // Wait for model to finish loading
    while (isModelLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return sketchModel;
  }

  isModelLoading = true;

  try {
    console.log('Initializing Sketch CNN model...');

    // Ensure TensorFlow is ready
    await tf.ready();

    // Try to load pre-trained model from URL
    try {
      // In a production environment, you would load from a hosted URL
      sketchModel = await tf.loadLayersModel('/models/sketch-cnn/model.json');
      console.log('Loaded pre-trained sketch CNN model');
    } catch (e) {
      console.log('No pre-trained model available, creating new model:', e);
      // Create a new model
      sketchModel = createSketchCNNModel();
    }

    return sketchModel;
  } catch (error) {
    console.error('Error initializing Sketch CNN model:', error);
    throw error;
  } finally {
    isModelLoading = false;
  }
}

/**
 * Prepares a canvas image for inference by the CNN model
 * @param {HTMLCanvasElement|ImageData} canvas - The canvas or imageData to process
 * @returns {tf.Tensor4D} Processed tensor ready for model input
 */
export function preprocessCanvas(canvas) {
  return tf.tidy(() => {
    // Get image data if canvas was provided
    let imageData;
    if (canvas instanceof HTMLCanvasElement) {
      const ctx = canvas.getContext('2d');
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
      imageData = canvas;
    }

    // Convert to a tensor
    const imageTensor = tf.browser.fromPixels(imageData, 1); // Grayscale (1 channel)

    // Resize to model input size
    const resized = tf.image.resizeBilinear(imageTensor, [128, 128]);

    // Normalize values to [0, 1]
    const normalized = resized.div(255.0);

    // Add batch dimension
    return normalized.expandDims(0);
  });
}

/**
 * Analyzes regions of the canvas to identify sketch objects
 * This function slices the canvas into regions and runs each through the CNN
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Array} strokes - Stroke data from Perfect Freehand
 * @returns {Promise<Array>} Detected objects with precise bounding boxes
 */
export async function analyzeSketchRegions(canvas, strokes) {
  if (!canvas || !strokes || strokes.length === 0) {
    return [];
  }

  try {
    const model = await getSketchCNNModel();
    const detectedObjects = [];
    const ctx = canvas.getContext('2d');

    // Find potential regions of interest based on stroke clusters
    const regions = identifySketchRegions(strokes, canvas.width, canvas.height);

    // Analyze each region
    for (const region of regions) {
      // Extract the region from the canvas
      const { x, y, width, height } = region;

      // Skip regions that are too small
      if (width < 10 || height < 10) continue;

      // Get image data for the region
      const imageData = ctx.getImageData(x, y, width, height);

      // Preprocess and run through the model
      const inputTensor = preprocessCanvas(imageData);
      const predictions = await model.predict(inputTensor).data();

      // Find the class with highest probability
      let maxProb = 0;
      let bestClass = '';

      for (let i = 0; i < predictions.length; i++) {
        if (predictions[i] > maxProb) {
          maxProb = predictions[i];
          bestClass = CLASS_NAMES[i];
        }
      }

      // Only include predictions with confidence above threshold
      if (maxProb > 0.7) {
        // Calculate normalized coordinates
        const normalizedBox = {
          name: bestClass,
          confidence: maxProb,
          boundingBox: {
            minX: x / canvas.width,
            minY: y / canvas.height,
            maxX: (x + width) / canvas.width,
            maxY: (y + height) / canvas.height,
            width: width / canvas.width,
            height: height / canvas.height,
            centerX: (x + width/2) / canvas.width,
            centerY: (y + height/2) / canvas.height
          },
          source: 'sketch-cnn'
        };

        // Refine the bounding box using stroke data
        const refinedObject = refineObjectBoundary(normalizedBox, strokes, canvas.width, canvas.height);
        detectedObjects.push(refinedObject);
      }

      // Clean up tensor
      tf.dispose(inputTensor);
    }

    return detectedObjects;
  } catch (error) {
    console.error('Error analyzing sketch with CNN:', error);
    return [];
  }
}

/**
 * Identifies regions of interest in a sketch based on stroke clusters
 * @param {Array} strokes - Perfect Freehand stroke data
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Array<{x: number, y: number, width: number, height: number}>} Regions of interest
 */
function identifySketchRegions(strokes, canvasWidth, canvasHeight) {
  if (!strokes || strokes.length === 0) {
    return [];
  }

  // 1. Find isolated stroke clusters
  const clusters = [];
  const processedStrokes = new Set();

  // Process each stroke
  for (let i = 0; i < strokes.length; i++) {
    if (processedStrokes.has(i)) continue;

    // Start a new cluster with this stroke
    const cluster = [i];
    processedStrokes.add(i);

    // Find connected strokes using a breadth-first search
    const queue = [i];
    while (queue.length > 0) {
      const currentIdx = queue.shift();
      const currentStroke = strokes[currentIdx];

      // Check all other strokes for proximity
      for (let j = 0; j < strokes.length; j++) {
        if (processedStrokes.has(j)) continue;

        // Check if strokes are close to each other
        if (areStrokesConnected(currentStroke, strokes[j], canvasWidth, canvasHeight)) {
          cluster.push(j);
          processedStrokes.add(j);
          queue.push(j);
        }
      }
    }

    // Add cluster if it has strokes
    if (cluster.length > 0) {
      clusters.push(cluster);
    }
  }

  // 2. Convert clusters to regions
  return clusters.map(cluster => {
    // Get all strokes in this cluster
    const clusterStrokes = cluster.map(idx => strokes[idx]);

    // Calculate bounding box for the cluster
    const boundingBox = calculateMultiStrokeBoundingBox(clusterStrokes);

    // Add padding (10% of dimension)
    const paddingX = Math.max(5, boundingBox.width * 0.1);
    const paddingY = Math.max(5, boundingBox.height * 0.1);

    // Return region with padding, ensuring it stays within canvas
    return {
      x: Math.max(0, boundingBox.minX - paddingX),
      y: Math.max(0, boundingBox.minY - paddingY),
      width: Math.min(canvasWidth - boundingBox.minX, boundingBox.width + paddingX * 2),
      height: Math.min(canvasHeight - boundingBox.minY, boundingBox.height + paddingY * 2)
    };
  });
}

/**
 * Determines if two strokes are connected/close to each other
 * @param {Object} stroke1 - First stroke
 * @param {Object} stroke2 - Second stroke
 * @param {number} canvasWidth - Canvas width for distance normalization
 * @param {number} canvasHeight - Canvas height for distance normalization
 * @returns {boolean} True if strokes are connected
 */
function areStrokesConnected(stroke1, stroke2, canvasWidth, canvasHeight) {
  if (!stroke1.points || !stroke2.points) return false;

  // Calculate distance threshold as percentage of canvas size
  const threshold = Math.min(canvasWidth, canvasHeight) * 0.05; // 5% of smaller dimension

  // Find minimum distance between any points in the strokes
  let minDistance = Infinity;

  // Check a subset of points for performance
  for (let i = 0; i < stroke1.points.length; i += Math.max(1, Math.floor(stroke1.points.length / 10))) {
    const p1 = stroke1.points[i];
    const x1 = p1.x !== undefined ? p1.x : p1[0];
    const y1 = p1.y !== undefined ? p1.y : p1[1];

    for (let j = 0; j < stroke2.points.length; j += Math.max(1, Math.floor(stroke2.points.length / 10))) {
      const p2 = stroke2.points[j];
      const x2 = p2.x !== undefined ? p2.x : p2[0];
      const y2 = p2.y !== undefined ? p2.y : p2[1];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.sqrt(dx * dx + dy * dy);

      minDistance = Math.min(minDistance, distance);

      // Early exit if we find close points
      if (minDistance <= threshold) {
        return true;
      }
    }
  }

  return minDistance <= threshold;
}

/**
 * Refines an object's boundary using stroke data
 * @param {Object} object - Detected object with bounding box
 * @param {Array} strokes - All strokes
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Object} Object with refined bounding box
 */
function refineObjectBoundary(object, strokes, canvasWidth, canvasHeight) {
  // Find strokes related to this object
  const objCenterX = object.boundingBox.centerX * canvasWidth;
  const objCenterY = object.boundingBox.centerY * canvasHeight;

  // Use a larger search radius for initial detection
  const searchRadius = 0.1; // 10% of canvas

  // Get related strokes
  const relatedStrokes = findRelatedStrokes(
    strokes,
    objCenterX / canvasWidth,
    objCenterY / canvasHeight,
    canvasWidth,
    canvasHeight,
    searchRadius
  );

  if (relatedStrokes && relatedStrokes.length > 0) {
    // Calculate precise bounding box from actual stroke points
    const strokeBounds = calculateMultiStrokeBoundingBox(relatedStrokes);

    // Normalize to 0-1 range
    const normalizedBounds = {
      minX: strokeBounds.minX / canvasWidth,
      minY: strokeBounds.minY / canvasHeight,
      maxX: strokeBounds.maxX / canvasWidth,
      maxY: strokeBounds.maxY / canvasHeight,
      width: strokeBounds.width / canvasWidth,
      height: strokeBounds.height / canvasHeight,
      centerX: (strokeBounds.minX + strokeBounds.width/2) / canvasWidth,
      centerY: (strokeBounds.minY + strokeBounds.height/2) / canvasHeight
    };

    // Return enhanced object
    return {
      ...object,
      originalBoundingBox: object.boundingBox,
      boundingBox: normalizedBounds,
      strokeIds: relatedStrokes.map(s => s.id || ''),
      enhancedByStrokes: true
    };
  }

  return object;
}

/**
 * Enhances existing detection results with CNN-based sketch analysis
 * @param {Array} existingDetections - Previous detections from other models
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Array} strokes - All strokes
 * @returns {Promise<Array>} Enhanced detections
 */
export async function enhanceWithSketchCNN(existingDetections, canvas, strokes) {
  if (!canvas || !strokes || strokes.length === 0) {
    return existingDetections;
  }

  try {
    // Run CNN-based analysis
    const cnnDetections = await analyzeSketchRegions(canvas, strokes);

    // If no CNN detections, return existing
    if (!cnnDetections || cnnDetections.length === 0) {
      return existingDetections;
    }

    // If no existing detections, return CNN only
    if (!existingDetections || existingDetections.length === 0) {
      return cnnDetections;
    }

    // Merge results, preferring CNN for overlapping objects
    const mergedDetections = [...existingDetections];

    for (const cnnObject of cnnDetections) {
      // Look for matching object in existing detections
      const matchIdx = mergedDetections.findIndex(existing =>
        isSameObject(existing, cnnObject)
      );

      if (matchIdx >= 0) {
        // Update the existing detection with more precise bounding box
        mergedDetections[matchIdx] = {
          ...mergedDetections[matchIdx],
          confidence: Math.max(mergedDetections[matchIdx].confidence, cnnObject.confidence),
          boundingBox: cnnObject.boundingBox,
          enhancedByStrokes: true,
          enhancedByCNN: true,
          source: 'hybrid'
        };
      } else {
        // Add as new detection
        mergedDetections.push({
          ...cnnObject,
          source: 'sketch-cnn'
        });
      }
    }

    return mergedDetections;
  } catch (error) {
    console.error('Error enhancing with Sketch CNN:', error);
    return existingDetections;
  }
}

/**
 * Determines if two detected objects represent the same object
 * @param {Object} obj1 - First object
 * @param {Object} obj2 - Second object
 * @returns {boolean} True if objects are the same
 */
function isSameObject(obj1, obj2) {
  // Same name is a strong indicator
  const sameName = obj1.name && obj2.name &&
                  obj1.name.toLowerCase() === obj2.name.toLowerCase();

  // Check proximity
  const bb1 = obj1.boundingBox;
  const bb2 = obj2.boundingBox;

  if (!bb1 || !bb2) return sameName;

  // Calculate distance between centers
  const distance = Math.sqrt(
    Math.pow(bb1.centerX - bb2.centerX, 2) +
    Math.pow(bb1.centerY - bb2.centerY, 2)
  );

  // Calculate overlap between bounding boxes
  const overlapX = Math.max(0,
    Math.min(bb1.maxX, bb2.maxX) - Math.max(bb1.minX, bb2.minX)
  );
  const overlapY = Math.max(0,
    Math.min(bb1.maxY, bb2.maxY) - Math.max(bb1.minY, bb2.minY)
  );

  const overlap = overlapX * overlapY;
  const area1 = bb1.width * bb1.height;
  const area2 = bb2.width * bb2.height;

  // Calculate IoU (Intersection over Union)
  const iou = overlap / (area1 + area2 - overlap);

  // Consider same if name matches and sufficiently close
  if (sameName && (iou > 0.2 || distance < 0.15)) {
    return true;
  }

  // Consider same if significant overlap regardless of name
  return iou > 0.5;
}