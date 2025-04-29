/**
 * Dataset utilities for CNN model training
 * These functions help prepare and process sketch data for training
 */

import * as tf from '@tensorflow/tfjs';
import { MODEL_CONFIG } from './index';

/**
 * Converts a canvas or image to a tensor for model input
 * @param {HTMLCanvasElement|HTMLImageElement} element - Canvas or image
 * @returns {tf.Tensor4D} Processed tensor
 */
export function imageToTensor(element) {
  return tf.tidy(() => {
    // Convert to tensor
    const tensor = tf.browser.fromPixels(element, 1); // grayscale, 1 channel

    // Resize to model input size
    const resized = tf.image.resizeBilinear(tensor, [
      MODEL_CONFIG.inputSize,
      MODEL_CONFIG.inputSize
    ]);

    // Normalize pixel values to [0,1]
    const normalized = resized.div(255.0);

    // Add batch dimension
    return normalized.expandDims(0);
  });
}

/**
 * Creates a one-hot encoded tensor for a class label
 * @param {string} className - Class name
 * @returns {tf.Tensor} One-hot encoded tensor
 */
export function classToTensor(className) {
  const classIndex = MODEL_CONFIG.classNames.indexOf(className.toLowerCase());
  if (classIndex === -1) {
    console.warn(`Unknown class: ${className}`);
    return tf.zeros([1, MODEL_CONFIG.classNames.length]);
  }

  return tf.tidy(() => {
    return tf.oneHot(tf.tensor1d([classIndex], 'int32'), MODEL_CONFIG.classNames.length).as1D();
  });
}

/**
 * Prepares a dataset for training from an array of examples
 * @param {Array<{canvas: HTMLCanvasElement, label: string}>} examples - Training examples
 * @returns {Object} TensorFlow.js dataset
 */
export function prepareDataset(examples) {
  const xs = [];
  const ys = [];

  for (const example of examples) {
    const imageTensor = imageToTensor(example.canvas);
    const labelTensor = classToTensor(example.label);

    xs.push(imageTensor);
    ys.push(labelTensor);
  }

  // Stack all tensors into batches
  const xDataset = tf.concat(xs);
  const yDataset = tf.stack(ys);

  return {
    xs: xDataset,
    ys: yDataset
  };
}

/**
 * Saves training examples for future model training
 * @param {Array} examples - Training examples
 * @param {string} key - Storage key
 */
export function saveTrainingExamples(examples, key = 'sketch-cnn-training-data') {
  const data = examples.map(example => {
    // Convert canvas to data URL
    const dataUrl = example.canvas.toDataURL('image/png');
    return {
      dataUrl,
      label: example.label,
      timestamp: Date.now()
    };
  });

  // Save to localStorage for now, in a real app this would go to a server
  try {
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`Saved ${data.length} training examples`);
    return true;
  } catch (error) {
    console.error('Error saving training examples:', error);
    return false;
  }
}

/**
 * Data augmentation for sketch training data
 * @param {HTMLCanvasElement} canvas - Input canvas
 * @returns {HTMLCanvasElement[]} Array of augmented canvases
 */
export function augmentSketch(canvas) {
  const augmentedCanvases = [];
  const size = MODEL_CONFIG.inputSize;

  // Create temporary canvas for augmentation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = size;
  tempCanvas.height = size;
  const ctx = tempCanvas.getContext('2d');

  // Original (resized)
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(canvas, 0, 0, size, size);
  augmentedCanvases.push(cloneCanvas(tempCanvas));

  // Horizontal flip
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0, size, size);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  augmentedCanvases.push(cloneCanvas(tempCanvas));

  // Slight rotation (15 degrees clockwise)
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size/2, size/2);
  ctx.rotate(15 * Math.PI / 180);
  ctx.drawImage(canvas, -size/2, -size/2, size, size);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  augmentedCanvases.push(cloneCanvas(tempCanvas));

  // Slight rotation (15 degrees counter-clockwise)
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size/2, size/2);
  ctx.rotate(-15 * Math.PI / 180);
  ctx.drawImage(canvas, -size/2, -size/2, size, size);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  augmentedCanvases.push(cloneCanvas(tempCanvas));

  return augmentedCanvases;
}

/**
 * Helper to clone a canvas
 * @param {HTMLCanvasElement} canvas - Canvas to clone
 * @returns {HTMLCanvasElement} Cloned canvas
 */
function cloneCanvas(canvas) {
  const newCanvas = document.createElement('canvas');
  newCanvas.width = canvas.width;
  newCanvas.height = canvas.height;

  const ctx = newCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0);

  return newCanvas;
}