/**
 * Shape Recognition using TensorFlow.js
 * Specialized service for detecting geometric shapes in sketches
 * Complements the regular shapeRecognition.ts service with ML capabilities
 */

import * as tf from '@tensorflow/tfjs';
import { calculateMultiStrokeBoundingBox } from '$lib/utils/drawingUtils.js';
import { applySobelOperator, extractContourPoints, simplifyContour } from './tensorflowService';
import type { Stroke } from '$lib/types/drawing';

// Constants for shape detection
const SHAPE_CONFIDENCE_THRESHOLD = 0.7;
const MIN_POINTS_FOR_RECOGNITION = 5;

// Cache for loaded models
let shapeModel = null;
let modelLoading = false;

/**
 * Initialize the shape recognition model
 * @returns {Promise<tf.GraphModel|tf.LayersModel>} The loaded model
 */
export async function initShapeModel() {
  if (modelLoading) {
    // Wait for model to load if already in progress
    while (modelLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (shapeModel) {
      return shapeModel;
    }
  }

  try {
    modelLoading = true;
    console.log('Initializing Shape Recognition Model...');

    // Wait for TF to be ready
    await tf.ready();

    // For a real implementation, load a pre-trained model:
    // shapeModel = await tf.loadGraphModel('path/to/model/model.json');

    // For now, create a simple CNN architecture for shape recognition
    shapeModel = await createShapeCNN();

    console.log('Shape Recognition Model initialized successfully');
    return shapeModel;
  } catch (error) {
    console.error('Error initializing shape recognition model:', error);
    throw error;
  } finally {
    modelLoading = false;
  }
}

/**
 * Create a simple CNN for shape recognition
 * @returns {tf.LayersModel} Custom CNN model
 */
async function createShapeCNN() {
  try {
    // Create a sequential model
    const model = tf.sequential();

    // Input layer for 28x28 grayscale images
    model.add(tf.layers.conv2d({
      inputShape: [28, 28, 1],
      filters: 16,
      kernelSize: 3,
      strides: 1,
      padding: 'same',
      activation: 'relu'
    }));

    model.add(tf.layers.maxPooling2d({
      poolSize: [2, 2],
      strides: [2, 2]
    }));

    // Second convolutional block
    model.add(tf.layers.conv2d({
      filters: 32,
      kernelSize: 3,
      strides: 1,
      padding: 'same',
      activation: 'relu'
    }));

    model.add(tf.layers.maxPooling2d({
      poolSize: [2, 2],
      strides: [2, 2]
    }));

    // Flatten and dense layers
    model.add(tf.layers.flatten());
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.3 }));

    // Output layer for common shapes
    const NUM_SHAPES = 6; // circle, rectangle, triangle, line, arrow, star
    model.add(tf.layers.dense({ units: NUM_SHAPES, activation: 'softmax' }));

    // Compile the model
    model.compile({
      optimizer: 'adam',
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    // Note: In a real implementation, we would train this model on a shape dataset
    console.log('Created shape recognition CNN architecture');

    return model;
  } catch (error) {
    console.error('Error creating shape CNN:', error);
    throw error;
  }
}

/**
 * Preprocess a canvas for shape detection
 * @param {HTMLCanvasElement} canvas - Canvas with the drawing
 * @returns {tf.Tensor} Processed tensor ready for model input
 */
function preprocessCanvasForShapes(canvas) {
  return tf.tidy(() => {
    // Convert canvas to tensor
    let tensor = tf.browser.fromPixels(canvas, 1); // Grayscale (1 channel)

    // Resize to 28x28 (common size for shape recognition)
    tensor = tf.image.resizeBilinear(tensor, [28, 28]);

    // Normalize values to [0, 1]
    tensor = tensor.div(255.0);

    // Add batch dimension
    tensor = tensor.expandDims(0);

    return tensor;
  });
}

/**
 * Extract key geometric features from a shape
 * @param {Array<{x: number, y: number}>} contourPoints - Contour points of the shape
 * @returns {Object} Geometric features of the shape
 */
function extractGeometricFeatures(contourPoints) {
  if (!contourPoints || contourPoints.length < 3) {
    return null;
  }

  // Calculate centroid
  let centroidX = 0;
  let centroidY = 0;
  for (const point of contourPoints) {
    centroidX += point.x;
    centroidY += point.y;
  }
  centroidX /= contourPoints.length;
  centroidY /= contourPoints.length;

  // Calculate distances from centroid to each point
  const distances = contourPoints.map(point =>
    Math.sqrt(Math.pow(point.x - centroidX, 2) + Math.pow(point.y - centroidY, 2))
  );

  // Calculate perimeter (sum of distances between consecutive points)
  let perimeter = 0;
  for (let i = 0; i < contourPoints.length; i++) {
    const p1 = contourPoints[i];
    const p2 = contourPoints[(i + 1) % contourPoints.length];
    perimeter += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  // Calculate area using Shoelace formula
  let area = 0;
  for (let i = 0; i < contourPoints.length; i++) {
    const p1 = contourPoints[i];
    const p2 = contourPoints[(i + 1) % contourPoints.length];
    area += (p1.x * p2.y - p2.x * p1.y);
  }
  area = Math.abs(area) / 2;

  // Calculate shape descriptors
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
  const stdDevDistance = Math.sqrt(
    distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
  );

  // Calculate circularity (4π × area / perimeter²)
  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

  // Calculate rectangularity (area / bounding box area)
  let minX = Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxX = Number.MIN_VALUE;
  let maxY = Number.MIN_VALUE;

  for (const point of contourPoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const boundingBoxArea = (maxX - minX) * (maxY - minY);
  const rectangularity = area / boundingBoxArea;

  // Calculate triangularity based on vertices count and angles
  let triangularity = 0;
  if (contourPoints.length < 10) {
    // Likely a polygon with distinct vertices
    // For simple shapes, a triangle has 3 distinct vertices
    triangularity = contourPoints.length === 3 ? 0.9 : 0.3;
  }

  return {
    centroid: { x: centroidX, y: centroidY },
    area,
    perimeter,
    circularity,
    rectangularity,
    triangularity,
    boundingBox: { minX, minY, maxX, maxY },
    minDistance,
    maxDistance,
    avgDistance,
    stdDevDistance,
    pointCount: contourPoints.length
  };
}

/**
 * Analyze shape characteristics using both geometric features and CNN
 * @param {HTMLCanvasElement} canvas - Canvas with the shape
 * @param {Object} features - Geometric features of the shape
 * @returns {Promise<Object>} Shape recognition result
 */
async function analyzeShapeCharacteristics(canvas, features) {
  if (!features) {
    return { type: 'unknown', confidence: 0 };
  }

  // Preprocess canvas for CNN
  const input = preprocessCanvasForShapes(canvas);

  try {
    // Get model prediction
    const model = await initShapeModel();
    const predictions = await model.predict(input).data();

    // Clean up tensor
    input.dispose();

    // Shape classes
    const shapeClasses = ['circle', 'rectangle', 'triangle', 'line', 'arrow', 'star'];

    // Get CNN confidence for each shape
    const cnnConfidences = Array.from(predictions);

    // Combine CNN with geometric features for better accuracy
    const combinedConfidences = cnnConfidences.map((confidence, index) => {
      const shapeType = shapeClasses[index];
      let geometricConfidence = 0;

      // Adjust based on geometric features
      switch (shapeType) {
        case 'circle':
          // Circles have high circularity and consistent distance from center
          geometricConfidence =
            (features.circularity > 0.8 ? 0.8 : features.circularity * 0.5) +
            (features.stdDevDistance / features.avgDistance < 0.2 ? 0.2 : 0);
          break;

        case 'rectangle':
          // Rectangles have high rectangularity
          geometricConfidence = features.rectangularity > 0.8 ? 0.8 : features.rectangularity * 0.7;
          break;

        case 'triangle':
          // Triangles have specific properties
          geometricConfidence = features.triangularity > 0.7 ? 0.7 : features.triangularity;
          break;

        case 'line':
          // Lines have very low area-to-perimeter ratio
          const lineMetric = features.area / (features.perimeter * features.perimeter);
          geometricConfidence = lineMetric < 0.05 ? 0.8 : 0.3;
          break;

        default:
          geometricConfidence = 0.3; // Default for other shapes
      }

      // Weighted combination (60% CNN, 40% geometric features)
      return 0.6 * confidence + 0.4 * geometricConfidence;
    });

    // Find best match
    const bestMatchIndex = combinedConfidences.indexOf(Math.max(...combinedConfidences));
    const bestMatch = {
      type: shapeClasses[bestMatchIndex],
      confidence: combinedConfidences[bestMatchIndex],
      features
    };

    return bestMatch;
  } catch (error) {
    console.error('Error analyzing shape with CNN:', error);

    // Fallback to geometric analysis only
    return classifyShapeByGeometry(features);
  }
}

/**
 * Classify shape based on geometric features only (fallback method)
 * @param {Object} features - Geometric features of the shape
 * @returns {Object} Shape classification result
 */
function classifyShapeByGeometry(features) {
  if (!features) {
    return { type: 'unknown', confidence: 0 };
  }

  // Initialize confidence for each shape type
  const confidences = {
    circle: 0,
    rectangle: 0,
    triangle: 0,
    line: 0,
    arrow: 0,
    star: 0
  };

  // Circle: high circularity
  confidences.circle = features.circularity > 0.8 ?
    0.9 : (features.circularity > 0.7 ? 0.7 : features.circularity * 0.5);

  // Rectangle: high rectangularity
  confidences.rectangle = features.rectangularity > 0.8 ?
    0.9 : (features.rectangularity > 0.7 ? 0.7 : features.rectangularity * 0.5);

  // Triangle: based on triangularity
  confidences.triangle = features.triangularity > 0.7 ?
    0.9 : features.triangularity * 0.5;

  // Line: very low area-to-perimeter ratio
  const lineMetric = features.area / (features.perimeter * features.perimeter);
  confidences.line = lineMetric < 0.05 ? 0.85 : (lineMetric < 0.1 ? 0.5 : 0.1);

  // Find best match
  let bestType = 'unknown';
  let bestConfidence = 0;

  for (const [type, confidence] of Object.entries(confidences)) {
    if (confidence > bestConfidence) {
      bestType = type;
      bestConfidence = confidence;
    }
  }

  return {
    type: bestType,
    confidence: bestConfidence,
    features
  };
}

/**
 * Creates a temporary canvas from strokes for analysis
 * @param {Stroke[]} strokes - Stroke data
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {HTMLCanvasElement} Canvas element with strokes drawn
 */
function createCanvasFromStrokes(strokes, width = 300, height = 300) {
  // Create canvas in memory
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Draw strokes
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = 'black';
  ctx.strokeStyle = 'black';

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;

    ctx.beginPath();
    ctx.lineWidth = stroke.size || 3;

    const firstPoint = stroke.points[0];
    ctx.moveTo(firstPoint.x, firstPoint.y);

    for (let i = 1; i < stroke.points.length; i++) {
      const point = stroke.points[i];
      ctx.lineTo(point.x, point.y);
    }

    ctx.stroke();
  }

  return canvas;
}

/**
 * Analyze strokes using TensorFlow for advanced shape recognition
 * @param {Stroke[]} strokes - Array of strokes to analyze
 * @returns {Promise<Object>} Shape recognition result
 */
export async function analyzeShape(strokes) {
  if (!strokes || !Array.isArray(strokes) || strokes.length === 0) {
    return { type: 'unknown', confidence: 0 };
  }

  try {
    // Get bounding box of all strokes
    const boundingBox = calculateMultiStrokeBoundingBox(strokes);

    // Create a canvas from the strokes
    const canvas = createCanvasFromStrokes(strokes, 300, 300);

    // Get image data for edge detection
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Apply edge detection
    const edges = applySobelOperator(imageData);

    // Extract contour points
    const contourPoints = extractContourPoints(edges, canvas.width, canvas.height);

    // Simplify contour to reduce noise
    const simplifiedContour = simplifyContour(contourPoints, 0.01);

    // Extract geometric features
    const features = extractGeometricFeatures(
      simplifiedContour.map(p => ({ x: p.x, y: p.y }))
    );

    // Analyze shape using CNN and geometric features
    const result = await analyzeShapeCharacteristics(canvas, features);

    // Normalize bounding box to 0-1 range
    const normalizedBoundingBox = {
      minX: boundingBox.minX / canvas.width,
      minY: boundingBox.minY / canvas.height,
      maxX: boundingBox.maxX / canvas.width,
      maxY: boundingBox.maxY / canvas.height,
      width: boundingBox.width / canvas.width,
      height: boundingBox.height / canvas.height,
      centerX: boundingBox.centerX / canvas.width,
      centerY: boundingBox.centerY / canvas.height
    };

    // Return final result
    return {
      type: result.type,
      confidence: result.confidence,
      boundingBox: normalizedBoundingBox,
      strokeIds: strokes.map(stroke => stroke.id),
      features: result.features
    };
  } catch (error) {
    console.error('Error in TensorFlow shape analysis:', error);
    return { type: 'unknown', confidence: 0 };
  }
}

/**
 * Analyze multiple shapes in a drawing by grouping strokes
 * @param {Stroke[]} strokes - Array of all strokes
 * @returns {Promise<Array>} Array of shape recognition results
 */
export async function analyzeMultipleShapes(strokes) {
  if (!strokes || !Array.isArray(strokes) || strokes.length === 0) {
    return [];
  }

  try {
    // Group strokes into potential shapes (this could be enhanced with ML)
    // For now, use a simple approach - each continuous stroke is a shape
    const strokeGroups = [];
    let currentGroup = [];

    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i];

      // Start a new group if needed
      if (currentGroup.length === 0) {
        currentGroup.push(stroke);
        continue;
      }

      // Check if this stroke is close to the current group
      const lastStroke = currentGroup[currentGroup.length - 1];
      const timeDiff = stroke.timestamp && lastStroke.timestamp ?
        stroke.timestamp - lastStroke.timestamp : 1000;

      if (timeDiff < 500) { // 500ms threshold
        // Add to current group if drawn within 500ms
        currentGroup.push(stroke);
      } else {
        // Start a new group
        strokeGroups.push([...currentGroup]);
        currentGroup = [stroke];
      }
    }

    // Add the last group if not empty
    if (currentGroup.length > 0) {
      strokeGroups.push(currentGroup);
    }

    // Analyze each group
    const results = await Promise.all(
      strokeGroups.map(group => analyzeShape(group))
    );

    // Filter out low-confidence results
    return results.filter(result => result.confidence >= SHAPE_CONFIDENCE_THRESHOLD);
  } catch (error) {
    console.error('Error analyzing multiple shapes:', error);
    return [];
  }
}

/**
 * Main function to detect shapes in a drawing
 * @param {Stroke[]} strokes - Array of strokes to analyze
 * @returns {Object} Shape detection results
 */
export function detectShapesWithTensorflow(strokes) {
  return new Promise(async (resolve) => {
    try {
      // Initialize TensorFlow
      await tf.ready();

      // Analyze single shapes (treats all strokes as one shape)
      const singleShapeResult = await analyzeShape(strokes);

      // Analyze multiple shapes (separates strokes into different shapes)
      const multipleShapesResult = await analyzeMultipleShapes(strokes);

      resolve({
        shapes: [singleShapeResult].filter(shape => shape.confidence >= SHAPE_CONFIDENCE_THRESHOLD),
        multiStrokeShapes: multipleShapesResult
      });
    } catch (error) {
      console.error('Error in TensorFlow shape detection:', error);
      resolve({
        shapes: [],
        multiStrokeShapes: []
      });
    }
  });
}