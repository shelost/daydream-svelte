/**
 * CNN Models Entry Point
 *
 * This file serves as the entry point for loading our CNN models.
 * Later we will store pre-trained models in this directory.
 */

import { getSketchCNNModel } from '$lib/services/sketchCNN';

/**
 * Load the sketch recognition CNN model
 * @returns {Promise} The loaded model
 */
export async function loadSketchModel() {
  return await getSketchCNNModel();
}

/**
 * Model configuration with class names and properties
 */
export const MODEL_CONFIG = {
  inputSize: 128,
  classNames: [
    'eye', 'nose', 'mouth', 'ear', 'face',
    'head', 'body', 'hand', 'foot', 'hair',
    'circle', 'rectangle', 'triangle', 'line', 'arrow',
    'star', 'heart', 'cloud', 'tree', 'flower'
  ],
  version: '1.0'
};