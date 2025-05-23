/**
 * Quick Draw Model Training Script
 *
 * This script demonstrates how to train a model on the Quick Draw dataset.
 * For actual deployment, we'll use a pre-trained model or train on a larger cluster.
 *
 * Usage: node scripts/train-quickdraw-model.js
 */

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');
const ndjson = require('ndjson');

// Categories to include in the model (same as in the service)
const CATEGORIES = [
  'face', 'eye', 'nose', 'mouth', 'ear', 'hand', 'foot',
  'cat', 'dog', 'bird', 'fish', 'house', 'tree', 'flower',
  'car', 'airplane', 'boat', 'sun', 'moon', 'star',
  'circle', 'square', 'triangle', 'heart', 'arrow'
];

// Model configuration
const MODEL_CONFIG = {
  inputSize: 28,         // Input image size (28x28 pixels)
  batchSize: 128,        // Training batch size
  epochs: 15,            // Number of training epochs
  samplesPerCategory: 1000, // Number of samples to use per category
  validationSplit: 0.15, // Percentage of data to use for validation
  outputPath: path.join(__dirname, '../public/models/quickdraw')
};

/**
 * Create a CNN model for sketch recognition
 * @returns {tf.Sequential} TensorFlow.js Sequential model
 */
function createModel() {
  // Create a sequential model
  const model = tf.sequential();

  // Add convolutional layers
  model.add(tf.layers.conv2d({
    inputShape: [MODEL_CONFIG.inputSize, MODEL_CONFIG.inputSize, 1],
    filters: 16,
    kernelSize: 3,
    activation: 'relu',
    padding: 'same'
  }));

  model.add(tf.layers.maxPooling2d({
    poolSize: 2,
    strides: 2
  }));

  model.add(tf.layers.conv2d({
    filters: 32,
    kernelSize: 3,
    activation: 'relu',
    padding: 'same'
  }));

  model.add(tf.layers.maxPooling2d({
    poolSize: 2,
    strides: 2
  }));

  model.add(tf.layers.conv2d({
    filters: 64,
    kernelSize: 3,
    activation: 'relu',
    padding: 'same'
  }));

  // Flatten the output
  model.add(tf.layers.flatten());

  // Add dense layers
  model.add(tf.layers.dense({
    units: 128,
    activation: 'relu'
  }));

  model.add(tf.layers.dropout({ rate: 0.3 }));

  // Output layer with softmax activation
  model.add(tf.layers.dense({
    units: CATEGORIES.length,
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
 * Load and preprocess data from Quick Draw dataset files
 * @returns {Promise<{xs: tf.Tensor, ys: tf.Tensor}>} Training data tensors
 */
async function loadData() {
  console.log('Loading Quick Draw dataset...');

  const inputs = [];
  const labels = [];

  // Process each category
  for (let i = 0; i < CATEGORIES.length; i++) {
    const category = CATEGORIES[i];
    console.log(`Processing category: ${category} (${i+1}/${CATEGORIES.length})`);

    try {
      // Path to the ndjson file for this category
      const filePath = path.join(__dirname, `../data/quickdraw/${category}.ndjson`);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
      }

      // Read and parse the ndjson file
      const parser = fs.createReadStream(filePath).pipe(ndjson.parse());

      let count = 0;
      for await (const drawing of parser) {
        if (count >= MODEL_CONFIG.samplesPerCategory) break;

        // Convert drawing to image tensor
        const tensor = convertDrawingToTensor(drawing);
        if (tensor) {
          inputs.push(tensor);

          // Create one-hot encoded label
          const label = new Array(CATEGORIES.length).fill(0);
          label[i] = 1;
          labels.push(label);

          count++;
        }
      }

      console.log(`Loaded ${count} samples for "${category}"`);
    } catch (error) {
      console.error(`Error loading data for category "${category}":`, error);
    }
  }

  // Convert to tensors
  const xs = tf.stack(inputs);
  const ys = tf.tensor2d(labels);

  return { xs, ys };
}

/**
 * Convert drawing data to tensor
 * @param {Object} drawing - Drawing data from Quick Draw dataset
 * @returns {tf.Tensor3D|null} Tensor representation of drawing or null if invalid
 */
function convertDrawingToTensor(drawing) {
  try {
    // Create empty canvas
    const imageSize = MODEL_CONFIG.inputSize;
    const canvas = tf.buffer([imageSize, imageSize, 1], 'float32');

    // Fill with white (background)
    canvas.values.fill(0);

    // Draw the strokes
    for (const stroke of drawing.drawing) {
      const [xs, ys] = stroke;

      for (let i = 0; i < xs.length - 1; i++) {
        // Scale coordinates to image size
        const x1 = Math.floor((xs[i] / 255) * (imageSize - 1));
        const y1 = Math.floor((ys[i] / 255) * (imageSize - 1));
        const x2 = Math.floor((xs[i+1] / 255) * (imageSize - 1));
        const y2 = Math.floor((ys[i+1] / 255) * (imageSize - 1));

        // Draw line using Bresenham's algorithm
        drawLine(canvas, x1, y1, x2, y2);
      }
    }

    return tf.tensor3d(canvas.values, [imageSize, imageSize, 1]);
  } catch (error) {
    console.error('Error converting drawing to tensor:', error);
    return null;
  }
}

/**
 * Draw a line using Bresenham's algorithm
 * @param {tf.TensorBuffer} canvas - Canvas buffer
 * @param {number} x1 - Start x-coordinate
 * @param {number} y1 - Start y-coordinate
 * @param {number} x2 - End x-coordinate
 * @param {number} y2 - End y-coordinate
 */
function drawLine(canvas, x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;

  const imageSize = canvas.shape[0];

  while (true) {
    // Set pixel if within bounds
    if (x1 >= 0 && x1 < imageSize && y1 >= 0 && y1 < imageSize) {
      canvas.set(1, y1, x1, 0); // Value 1 for white
    }

    if (x1 === x2 && y1 === y2) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x1 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y1 += sy;
    }
  }
}

/**
 * Train model and save it
 */
async function trainAndSaveModel() {
  try {
    console.log('Creating model...');
    const model = createModel();

    console.log('Loading data...');
    const { xs, ys } = await loadData();

    console.log('Starting training...');
    console.log(`Training with ${xs.shape[0]} samples`);

    // Train the model
    await model.fit(xs, ys, {
      batchSize: MODEL_CONFIG.batchSize,
      epochs: MODEL_CONFIG.epochs,
      validationSplit: MODEL_CONFIG.validationSplit,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`Epoch ${epoch+1}/${MODEL_CONFIG.epochs}: loss=${logs.loss.toFixed(4)}, accuracy=${logs.acc.toFixed(4)}, val_accuracy=${logs.val_acc.toFixed(4)}`);
        }
      }
    });

    // Create output directory if it doesn't exist
    if (!fs.existsSync(MODEL_CONFIG.outputPath)) {
      fs.mkdirSync(MODEL_CONFIG.outputPath, { recursive: true });
    }

    // Save the model
    const saveResult = await model.save(`file://${MODEL_CONFIG.outputPath}`);
    console.log('Model saved successfully:', saveResult);

    // Save categories list
    fs.writeFileSync(
      path.join(MODEL_CONFIG.outputPath, 'categories.json'),
      JSON.stringify(CATEGORIES)
    );

    // Clean up tensors
    xs.dispose();
    ys.dispose();

  } catch (error) {
    console.error('Error training model:', error);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Quick Draw Model Training Script');
  console.log('================================');
  console.log(`Categories: ${CATEGORIES.length}`);
  console.log(`Samples per category: ${MODEL_CONFIG.samplesPerCategory}`);
  console.log(`Total samples: ${CATEGORIES.length * MODEL_CONFIG.samplesPerCategory}`);
  console.log(`Output path: ${MODEL_CONFIG.outputPath}`);

  await trainAndSaveModel();

  console.log('Done!');
}

// Run the script
main().catch(console.error);