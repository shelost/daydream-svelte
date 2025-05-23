import { getStroke } from 'perfect-freehand';
import { getSvgPathFromStroke as localGetSvgPathFromStroke } from './drawingUtils.js';

// Test data - a simple circle shape
const testPoints = [
  [100, 100, 0.5],
  [120, 80, 0.5],
  [150, 80, 0.5],
  [170, 100, 0.5],
  [170, 130, 0.5],
  [150, 150, 0.5],
  [120, 150, 0.5],
  [100, 130, 0.5]
];

// Apply perfect-freehand to get stroke points
const stroke = getStroke(testPoints);

// Use our custom function to get SVG path
const svgPathLocal = localGetSvgPathFromStroke(stroke);

console.log('SVG Path from local function:', svgPathLocal);

// Export function that tests if the output matches what we expect
export function testSvgPathFunction() {
  return {
    stroke,
    svgPath: svgPathLocal,
    isValid: svgPathLocal && svgPathLocal.startsWith('M') && svgPathLocal.includes('Q') && svgPathLocal.endsWith('Z')
  };
}