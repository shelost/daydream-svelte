/**
 * TensorFlow.js integration service for object detection and analysis
 */
import * as tf from '@tensorflow/tfjs';

// Model loading status
let modelLoaded = false;
let model = null;
let labels = [];

/**
 * Initialize TensorFlow.js and load the COCO-SSD model
 * @returns {Promise<boolean>} Success status
 */
export async function initializeTensorFlow() {
  try {
    // Load model if not already loaded
    if (!modelLoaded) {
      console.log('Loading TensorFlow COCO-SSD model...');

      // Load model from CDN
      model = await tf.loadGraphModel(
        'https://tfhub.dev/tensorflow/tfjs-model/ssd_mobilenet_v2/1/default/1',
        { fromTFHub: true }
      );

      // Load COCO class labels
      labels = [
        'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
        'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog',
        'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella',
        'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
        'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
        'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich',
        'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
        'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
        'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
        'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
      ];

      modelLoaded = true;
      console.log('TensorFlow COCO-SSD model loaded successfully');

      // Warm up the model
      const dummyInput = tf.zeros([1, 300, 300, 3]);
      await model.executeAsync(dummyInput);
      dummyInput.dispose();
    }

    return true;
  } catch (error) {
    console.error('Error initializing TensorFlow:', error);
    return false;
  }
}

/**
 * Detect objects in an image using TensorFlow COCO-SSD model
 * @param {HTMLImageElement|HTMLCanvasElement} image - Image or canvas element
 * @param {number} confidenceThreshold - Minimum confidence threshold (0-1)
 * @returns {Promise<Array>} Array of detected objects with bounding boxes
 */
export async function detectObjects(image, confidenceThreshold = 0.4) {
  try {
    // Ensure model is loaded
    if (!modelLoaded) {
      await initializeTensorFlow();
    }

    // Convert image to tensor
    const imageTensor = tf.browser.fromPixels(image);

    // Expand dimensions to match model input [1, height, width, 3]
    const expandedTensor = imageTensor.expandDims(0);

    // Run inference
    const predictions = await model.executeAsync(expandedTensor);

    // Extract results
    const boxes = await predictions[1].arraySync();
    const scores = await predictions[2].arraySync();
    const classes = await predictions[0].arraySync();

    // Clean up tensors
    tf.dispose(predictions);
    tf.dispose(expandedTensor);
    tf.dispose(imageTensor);

    // Format results
    const detections = [];

    for (let i = 0; i < scores[0].length; i++) {
      if (scores[0][i] >= confidenceThreshold) {
        // [y1, x1, y2, x2] -> [x1, y1, width, height]
        const bbox = [
          boxes[0][i][1], // x1
          boxes[0][i][0], // y1
          boxes[0][i][3] - boxes[0][i][1], // width
          boxes[0][i][2] - boxes[0][i][0]  // height
        ];

        detections.push({
          classId: classes[0][i],
          name: labels[classes[0][i]],
          score: scores[0][i],
          bbox: bbox
        });
      }
    }

    return detections;
  } catch (error) {
    console.error('Error detecting objects:', error);
    return [];
  }
}

/**
 * Generate detailed bounding boxes for objects in a drawing
 * @param {HTMLCanvasElement} canvas - The canvas element with drawing
 * @param {Array} strokes - Array of stroke data
 * @returns {Promise<Array>} Enhanced analysis objects with precise bounds
 */
export async function analyzeDrawing(canvas, strokes) {
  try {
    // Detect objects in the canvas
    const detections = await detectObjects(canvas);

    if (!detections || detections.length === 0) {
      return [];
    }

    // Normalize detection bounding boxes
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    return detections.map(detection => {
      const [x, y, width, height] = detection.bbox;

      // Normalize to 0-1 range
      const normalizedBox = {
        minX: x / canvasWidth,
        minY: y / canvasHeight,
        maxX: (x + width) / canvasWidth,
        maxY: (y + height) / canvasHeight,
        width: width / canvasWidth,
        height: height / canvasHeight,
        centerX: (x + width/2) / canvasWidth,
        centerY: (y + height/2) / canvasHeight
      };

      return {
        name: detection.name,
        confidence: detection.score,
        boundingBox: normalizedBox
      };
    });
  } catch (error) {
    console.error('Error analyzing drawing:', error);
    return [];
  }
}

/**
 * Extract contours from a canvas drawing
 * @param {HTMLCanvasElement} canvas - The canvas element with drawing
 * @param {number} threshold - Threshold for edge detection (0-255)
 * @returns {Promise<Array>} Array of contour points
 */
export async function extractContours(canvas, threshold = 50) {
  try {
    // Get canvas context and image data
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Convert to grayscale
    const grayscale = new Uint8Array(canvas.width * canvas.height);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      grayscale[i / 4] = gray;
    }

    // Find edges (simple implementation)
    const contours = [];

    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const idx = y * canvas.width + x;

        // Simple edge detection using neighbors
        const top = grayscale[idx - canvas.width];
        const right = grayscale[idx + 1];
        const bottom = grayscale[idx + canvas.width];
        const left = grayscale[idx - 1];

        const current = grayscale[idx];

        // Check if pixel is an edge
        if (
          current > threshold && (
            Math.abs(current - top) > threshold ||
            Math.abs(current - right) > threshold ||
            Math.abs(current - bottom) > threshold ||
            Math.abs(current - left) > threshold
          )
        ) {
          // Normalize coordinates
          contours.push({
            x: x / canvas.width,
            y: y / canvas.height
          });
        }
      }
    }

    return contours;
  } catch (error) {
    console.error('Error extracting contours:', error);
    return [];
  }
}

/**
 * Calculate the intersection over union (IoU) of two bounding boxes
 * @param {Object} boxA - First bounding box {minX, minY, maxX, maxY}
 * @param {Object} boxB - Second bounding box {minX, minY, maxX, maxY}
 * @returns {number} IoU score (0-1)
 */
export function calculateIoU(boxA, boxB) {
  // Calculate intersection area
  const xOverlap = Math.max(0, Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX));
  const yOverlap = Math.max(0, Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY));
  const intersectionArea = xOverlap * yOverlap;

  // Calculate union area
  const boxAArea = (boxA.maxX - boxA.minX) * (boxA.maxY - boxA.minY);
  const boxBArea = (boxB.maxX - boxB.minX) * (boxB.maxY - boxB.minY);
  const unionArea = boxAArea + boxBArea - intersectionArea;

  // Return IoU
  return intersectionArea / unionArea;
}

/**
 * Find the best matching detection for a named element
 * @param {Array} detections - TensorFlow.js detection results
 * @param {Object} element - Named element with position
 * @returns {Object|null} Best matching detection or null
 */
export function findBestMatch(detections, element) {
  if (!detections || detections.length === 0 || !element) {
    return null;
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const detection of detections) {
    // Calculate positional similarity
    const xDiff = Math.abs(detection.boundingBox.centerX - element.x);
    const yDiff = Math.abs(detection.boundingBox.centerY - element.y);
    const distanceScore = 1 - Math.sqrt(xDiff*xDiff + yDiff*yDiff);

    // Calculate name similarity
    let nameSimilarity = 0;

    if (element.name && detection.name) {
      const elementName = element.name.toLowerCase();
      const detectionName = detection.name.toLowerCase();

      // Simple string matching (could be improved with NLP)
      if (elementName === detectionName) {
        nameSimilarity = 1;
      } else if (elementName.includes(detectionName) || detectionName.includes(elementName)) {
        nameSimilarity = 0.7;
      } else {
        // Check for word overlap
        const elementWords = elementName.split(/\s+/);
        const detectionWords = detectionName.split(/\s+/);

        for (const word of elementWords) {
          if (word.length > 3 && detectionWords.includes(word)) {
            nameSimilarity = 0.5;
            break;
          }
        }
      }
    }

    // Combine scores (weighted)
    const score = (distanceScore * 0.6) + (nameSimilarity * 0.4);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = detection;
    }
  }

  // Return best match if score is above threshold
  return bestScore > 0.3 ? bestMatch : null;
}