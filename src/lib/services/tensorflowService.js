/**
 * TensorFlow.js service for object detection and bounding box calculation
 * Provides enhanced image analysis capabilities to complement OpenAI Vision API
 */

import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as blazeface from '@tensorflow-models/blazeface';

// Models cache to prevent reloading
let cocoModel = null;
let faceModel = null;
let modelLoading = false;

/**
 * Initialize TensorFlow.js and load object detection models
 * @returns {Promise<{objectDetector: cocoSsd.ObjectDetection, faceDetector: blazeface.BlazeFaceModel}>}
 */
export async function initTensorflow() {
  if (modelLoading) {
    // Wait for models to load if already in progress
    console.log('TensorFlow models already loading, waiting...');
    while (modelLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (cocoModel && faceModel) {
      console.log('Using cached TensorFlow models');
      return { objectDetector: cocoModel, faceDetector: faceModel };
    }
  }

  try {
    modelLoading = true;
    console.log('Initializing TensorFlow.js...');

    // Wait for TF to be ready (especially important in browser environments)
    await tf.ready();
    console.log('TensorFlow.js runtime ready');

    // Load models in parallel
    console.log('Loading COCO-SSD and BlazeFace models...');
    const [objectDetector, faceDetector] = await Promise.all([
      cocoModel || cocoSsd.load({ base: 'lite_mobilenet_v2' }), // Lighter model for better performance
      faceModel || blazeface.load()
    ]);

    // Cache the models
    cocoModel = objectDetector;
    faceModel = faceDetector;

    console.log('TensorFlow.js models loaded successfully');
    return { objectDetector, faceDetector };
  } catch (error) {
    console.error('Error initializing TensorFlow.js:', error);
    throw error;
  } finally {
    modelLoading = false;
  }
}

/**
 * Detect objects in an image using COCO-SSD model
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement - The image or canvas element
 * @param {number} confidenceThreshold - Minimum confidence score (0-1)
 * @returns {Promise<Array<{bbox: number[], class: string, score: number}>>}
 */
export async function detectObjects(imageElement, confidenceThreshold = 0.5) {
  try {
    console.log('Running object detection with COCO-SSD...');
    const { objectDetector } = await initTensorflow();
    const predictions = await objectDetector.detect(imageElement);

    console.log(`COCO-SSD detected ${predictions.length} objects before filtering`);

    // Filter by confidence threshold
    const filteredPredictions = predictions.filter(pred => pred.score >= confidenceThreshold);
    console.log(`COCO-SSD detected ${filteredPredictions.length} objects after filtering (threshold: ${confidenceThreshold})`);

    return filteredPredictions;
  } catch (error) {
    console.error('Error detecting objects:', error);
    return [];
  }
}

/**
 * Detect faces in an image
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement - The image or canvas element
 * @param {number} confidenceThreshold - Minimum confidence score (0-1)
 * @returns {Promise<Array<{topLeft: number[], bottomRight: number[], landmarks: number[][], probability: number}>>}
 */
export async function detectFaces(imageElement, confidenceThreshold = 0.5) {
  try {
    console.log('Running face detection with BlazeFace...');
    const { faceDetector } = await initTensorflow();
    const predictions = await faceDetector.estimateFaces(imageElement);

    console.log(`BlazeFace detected ${predictions.length} faces before filtering`);

    // Filter by confidence threshold
    const filteredPredictions = predictions.filter(pred => pred.probability[0] >= confidenceThreshold);
    console.log(`BlazeFace detected ${filteredPredictions.length} faces after filtering (threshold: ${confidenceThreshold})`);

    return filteredPredictions;
  } catch (error) {
    console.error('Error detecting faces:', error);
    return [];
  }
}

/**
 * Convert TensorFlow.js predictions to a normalized format
 * @param {Array} detections - Array of detected objects
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Array<{name: string, confidence: number, boundingBox: Object}>}
 */
export function normalizeDetections(detections, canvasWidth, canvasHeight) {
  return detections.map(detection => {
    // Handle COCO-SSD format
    if (detection.bbox && detection.class) {
      const [x, y, width, height] = detection.bbox;

      return {
        name: detection.class,
        confidence: detection.score,
        boundingBox: {
          minX: x / canvasWidth,
          minY: y / canvasHeight,
          maxX: (x + width) / canvasWidth,
          maxY: (y + height) / canvasHeight,
          width: width / canvasWidth,
          height: height / canvasHeight,
          centerX: (x + width/2) / canvasWidth,
          centerY: (y + height/2) / canvasHeight
        }
      };
    }
    // Handle BlazeFace format
    else if (detection.topLeft && detection.bottomRight) {
      const [x1, y1] = detection.topLeft;
      const [x2, y2] = detection.bottomRight;

      return {
        name: 'face',
        confidence: detection.probability[0],
        boundingBox: {
          minX: x1 / canvasWidth,
          minY: y1 / canvasHeight,
          maxX: x2 / canvasWidth,
          maxY: y2 / canvasHeight,
          width: (x2 - x1) / canvasWidth,
          height: (y2 - y1) / canvasHeight,
          centerX: (x1 + (x2 - x1)/2) / canvasWidth,
          centerY: (y1 + (y2 - y1)/2) / canvasHeight
        }
      };
    }

    return null;
  }).filter(Boolean);
}

/**
 * Analyze an image and find enhanced bounding boxes using TensorFlow.js
 * @param {HTMLCanvasElement} canvas - The canvas element containing the drawing
 * @returns {Promise<Array>} Array of detected elements with precise bounds
 */
export async function analyzeTensorflowBoundingBoxes(canvas) {
  try {
    console.log('Analyzing image with TensorFlow.js...');
    console.log(`Canvas dimensions: ${canvas.width}x${canvas.height}`);

    // Check if canvas is empty (all white/transparent)
    const isCanvasEmpty = isEmptyCanvas(canvas);
    if (isCanvasEmpty) {
      console.log('Canvas appears to be empty, skipping TensorFlow analysis');
      return [];
    }

    // Create a tensor from the canvas
    const imageTensor = tf.browser.fromPixels(canvas);
    console.log('Created tensor from canvas:', imageTensor.shape);

    // Run object detection
    const objectDetections = await detectObjects(canvas);
    const faceDetections = await detectFaces(canvas);

    // Clean up
    imageTensor.dispose();

    // Normalize all detections
    const normalizedObjects = normalizeDetections(
      [...objectDetections, ...faceDetections],
      canvas.width,
      canvas.height
    );

    console.log(`Total normalized detections: ${normalizedObjects.length}`);
    console.log('Detection results:', normalizedObjects);

    return normalizedObjects;
  } catch (error) {
    console.error('Error analyzing image with TensorFlow:', error);
    return [];
  }
}

/**
 * Check if a canvas is empty (all white or transparent)
 * @param {HTMLCanvasElement} canvas - The canvas to check
 * @returns {boolean} True if canvas is empty
 */
function isEmptyCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Check a sample of pixels - look for non-white, non-transparent pixels
  const pixelCount = data.length / 4;
  const sampleSize = Math.min(1000, pixelCount); // Sample at most 1000 pixels
  const sampleInterval = Math.floor(pixelCount / sampleSize);

  for (let i = 0; i < pixelCount; i += sampleInterval) {
    const index = i * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];

    // If we find a non-white, non-transparent pixel, canvas is not empty
    if (a > 10 && (r < 240 || g < 240 || b < 240)) {
      return false;
    }
  }

  return true;
}

/**
 * Find the contours of objects in the image
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {Array} detections - Normalized detections
 * @returns {Promise<Array>} Enhanced detections with contour data
 */
export async function findContours(canvas, detections) {
  try {
    const ctx = canvas.getContext('2d');

    return await Promise.all(detections.map(async (detection) => {
      const { boundingBox } = detection;

      // Convert normalized coordinates back to pixel values
      const x = Math.floor(boundingBox.minX * canvas.width);
      const y = Math.floor(boundingBox.minY * canvas.height);
      const width = Math.floor(boundingBox.width * canvas.width);
      const height = Math.floor(boundingBox.height * canvas.height);

      // Skip if region is too small
      if (width < 5 || height < 5) return detection;

      // Get image data from the region
      const imageData = ctx.getImageData(x, y, width, height);

      // Simple edge detection (basic Sobel operator implementation)
      const edges = applySobelOperator(imageData);

      // Find the contour points
      const contourPoints = extractContourPoints(edges, width, height);

      // Normalize contour points and add to detection
      if (contourPoints.length > 0) {
        const normalizedContour = contourPoints.map(point => ({
          x: (point.x + x) / canvas.width,
          y: (point.y + y) / canvas.height
        }));

        return {
          ...detection,
          contour: simplifyContour(normalizedContour, 0.005) // Simplify the contour
        };
      }

      return detection;
    }));
  } catch (error) {
    console.error('Error finding contours:', error);
    return detections;
  }
}

/**
 * Apply Sobel operator for edge detection
 * @param {ImageData} imageData - The image data
 * @returns {Uint8ClampedArray} Edge detection result
 */
function applySobelOperator(imageData) {
  const { width, height, data } = imageData;
  const grayscale = new Uint8ClampedArray(width * height);
  const output = new Uint8ClampedArray(width * height);

  // Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    grayscale[i/4] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Sobel kernels
  const kernelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const kernelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  // Apply convolution
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let pixelX = 0;
      let pixelY = 0;

      // Apply kernel
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kernelIdx = (ky + 1) * 3 + (kx + 1);

          pixelX += grayscale[idx] * kernelX[kernelIdx];
          pixelY += grayscale[idx] * kernelY[kernelIdx];
        }
      }

      // Calculate gradient magnitude
      const magnitude = Math.sqrt(pixelX * pixelX + pixelY * pixelY);
      output[y * width + x] = magnitude > 50 ? 255 : 0; // Threshold
    }
  }

  return output;
}

/**
 * Extract contour points from edge data
 * @param {Uint8ClampedArray} edges - Edge detection result
 * @param {number} width - Width of the image
 * @param {number} height - Height of the image
 * @returns {Array<{x: number, y: number}>} Contour points
 */
function extractContourPoints(edges, width, height) {
  const contourPoints = [];

  // Simple contour extraction - get boundary pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] === 255) {
        // Check if this is an edge pixel
        let isEdge = false;

        // Check neighbors
        for (let dy = -1; dy <= 1 && !isEdge; dy++) {
          for (let dx = -1; dx <= 1 && !isEdge; dx++) {
            if (dx === 0 && dy === 0) continue;

            const nx = x + dx;
            const ny = y + dy;

            // Check if neighbor is outside the image or is a background pixel
            if (nx < 0 || nx >= width || ny < 0 || ny >= height ||
                edges[ny * width + nx] === 0) {
              isEdge = true;
            }
          }
        }

        if (isEdge) {
          contourPoints.push({ x, y });
        }
      }
    }
  }

  return contourPoints;
}

/**
 * Simplify a contour using the Ramer-Douglas-Peucker algorithm
 * @param {Array<{x: number, y: number}>} points - Contour points
 * @param {number} epsilon - Simplification threshold
 * @returns {Array<{x: number, y: number}>} Simplified contour
 */
function simplifyContour(points, epsilon) {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line between the first and last points
  let maxDistance = 0;
  let maxIndex = 0;

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], firstPoint, lastPoint);

    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If the maximum distance is greater than epsilon, recursively simplify the contour
  if (maxDistance > epsilon) {
    const leftSegment = simplifyContour(points.slice(0, maxIndex + 1), epsilon);
    const rightSegment = simplifyContour(points.slice(maxIndex), epsilon);

    // Combine the segments (avoiding duplicate point)
    return [...leftSegment.slice(0, leftSegment.length - 1), ...rightSegment];
  }

  // If the maximum distance is less than epsilon, return just the endpoints
  return [firstPoint, lastPoint];
}

/**
 * Calculate the perpendicular distance from a point to a line
 * @param {Object} point - The point
 * @param {Object} lineStart - Start point of the line
 * @param {Object} lineEnd - End point of the line
 * @returns {number} Distance
 */
function perpendicularDistance(point, lineStart, lineEnd) {
  const x = point.x;
  const y = point.y;
  const x1 = lineStart.x;
  const y1 = lineStart.y;
  const x2 = lineEnd.x;
  const y2 = lineEnd.y;

  // Handle case where line endpoints are the same point
  const lineLengthSquared = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (lineLengthSquared === 0) {
    return Math.sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));
  }

  // Calculate the perpendicular distance
  const t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lineLengthSquared;

  if (t < 0) {
    // Point is beyond the lineStart end of the line segment
    return Math.sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));
  }
  if (t > 1) {
    // Point is beyond the lineEnd end of the line segment
    return Math.sqrt((x - x2) * (x - x2) + (y - y2) * (y - y2));
  }

  // Point is within the line segment
  const projectionX = x1 + t * (x2 - x1);
  const projectionY = y1 + t * (y2 - y1);

  return Math.sqrt((x - projectionX) * (x - projectionX) + (y - projectionY) * (y - projectionY));
}
