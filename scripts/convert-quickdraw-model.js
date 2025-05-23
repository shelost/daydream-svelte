/**
 * Quick Draw Model Converter
 *
 * This script converts a pre-trained Quick Draw model to TensorFlow.js format.
 * Instead of training from scratch, this allows us to use existing models.
 *
 * Usage: node scripts/convert-quickdraw-model.js <input-model-path> <output-dir>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Categories (same as in the service)
const CATEGORIES = [
  'face', 'eye', 'nose', 'mouth', 'ear', 'hand', 'foot',
  'cat', 'dog', 'bird', 'fish', 'house', 'tree', 'flower',
  'car', 'airplane', 'boat', 'sun', 'moon', 'star',
  'circle', 'square', 'triangle', 'heart', 'arrow'
];

// Configuration
const CONFIG = {
  // Default paths (can be overridden by command line arguments)
  inputModelPath: './models/quickdraw-model.h5',
  outputDir: './public/models/quickdraw',

  // TensorFlow.js converter options
  tfjs_converter_options: '--input_format=keras'
};

/**
 * Convert Keras/TensorFlow model to TensorFlow.js format
 * @param {string} inputPath - Path to input model
 * @param {string} outputPath - Path for output model
 */
function convertModel(inputPath, outputPath) {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  console.log(`Converting model from ${inputPath} to ${outputPath}...`);

  try {
    // Use tensorflowjs_converter from TensorFlow.js
    const command = `tensorflowjs_converter ${CONFIG.tfjs_converter_options} ${inputPath} ${outputPath}`;
    console.log(`Executing: ${command}`);

    execSync(command, { stdio: 'inherit' });
    console.log('Model conversion completed successfully!');

    // Write categories file
    fs.writeFileSync(
      path.join(outputPath, 'categories.json'),
      JSON.stringify(CATEGORIES)
    );
    console.log('Categories file created');

  } catch (error) {
    console.error('Error converting model:', error);
    console.error('\nMake sure you have the necessary dependencies installed:');
    console.error('npm install @tensorflow/tfjs-node');
    console.error('pip install tensorflowjs');
    process.exit(1);
  }
}

/**
 * Download a pre-trained Quick Draw model
 * This is a placeholder - in a real scenario, you would download
 * from a specific URL or use a model you've trained elsewhere
 */
function downloadPretrainedModel() {
  console.log('This function would download a pre-trained model.');
  console.log('For this example, please place a pre-trained model at the inputModelPath');
  console.log('or specify the path to an existing model as a command-line argument.');
}

/**
 * Print usage information
 */
function printUsage() {
  console.log('Quick Draw Model Converter');
  console.log('=========================');
  console.log('');
  console.log('Usage: node convert-quickdraw-model.js [input-model-path] [output-dir]');
  console.log('');
  console.log('Arguments:');
  console.log('  input-model-path  Path to the input Keras/TensorFlow model (.h5 file)');
  console.log('                    Default: ' + CONFIG.inputModelPath);
  console.log('  output-dir        Path to the output directory for the TensorFlow.js model');
  console.log('                    Default: ' + CONFIG.outputDir);
  console.log('');
}

/**
 * Main function
 */
function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const inputPath = args[0] || CONFIG.inputModelPath;
  const outputPath = args[1] || CONFIG.outputDir;

  console.log('Quick Draw Model Converter');
  console.log('=========================');
  console.log('Input model path: ' + inputPath);
  console.log('Output directory: ' + outputPath);
  console.log('Categories: ' + CATEGORIES.length);

  // Check if input model exists
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input model not found at ${inputPath}`);
    console.log('Would you like to download a pre-trained model? (not implemented)');
    // downloadPretrainedModel(); // Uncomment to implement model downloading
    return;
  }

  // Convert the model
  convertModel(inputPath, outputPath);
}

// Run the script
main();