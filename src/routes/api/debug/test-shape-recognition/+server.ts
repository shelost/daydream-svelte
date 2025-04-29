import { json } from '@sveltejs/kit';
import { detectShapes } from '$lib/services/shapeRecognition';
import type { Stroke } from '$lib/types/drawing';

// Basic test endpoint for shape recognition
export function GET() {
  // Generate test stroke data for various shapes
  const testShapes = createTestShapes();

  // Test shape recognition with the generated strokes
  const results = testShapes.map(shape => {
    try {
      const result = detectShapes(shape.strokes);
      return {
        name: shape.name,
        result: result,
        match: result.shapes.length > 0
          ? result.shapes[0].type === shape.name
            ? "✅ Correct match"
            : `❌ Matched as ${result.shapes[0].type} (confidence: ${result.shapes[0].confidence.toFixed(2)})`
          : "❌ No match"
      };
    } catch (error) {
      return {
        name: shape.name,
        error: `Error: ${error.message}`,
        match: "❌ Error occurred"
      };
    }
  });

  return json({
    success: true,
    results,
    timestamp: new Date().toISOString()
  });
}

// Create test strokes for various shapes
function createTestShapes() {
  return [
    createCircleTest(),
    createRectangleTest(),
    createTriangleTest(),
    createLineTest(),
    createArrowTest()
  ];
}

// Test data generators
function createCircleTest() {
  const id = "test-circle-" + Math.random().toString(36).substring(2, 9);
  const center = { x: 100, y: 100 };
  const radius = 50;
  const points: Array<{x: number, y: number}> = [];

  // Generate circle points
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }

  const stroke: Stroke = {
    id,
    points,
    color: "#000000",
    width: 2,
    opacity: 1
  };

  return {
    name: "circle",
    strokes: [stroke]
  };
}

function createRectangleTest() {
  const id = "test-rectangle-" + Math.random().toString(36).substring(2, 9);
  const startX = 50;
  const startY = 200;
  const width = 100;
  const height = 60;

  const points = [
    { x: startX, y: startY },                 // Top-left
    { x: startX + width, y: startY },         // Top-right
    { x: startX + width, y: startY + height }, // Bottom-right
    { x: startX, y: startY + height },        // Bottom-left
    { x: startX, y: startY }                  // Back to top-left
  ];

  const stroke: Stroke = {
    id,
    points,
    color: "#000000",
    width: 2,
    opacity: 1
  };

  return {
    name: "rectangle",
    strokes: [stroke]
  };
}

function createTriangleTest() {
  const id = "test-triangle-" + Math.random().toString(36).substring(2, 9);

  const points = [
    { x: 200, y: 50 },    // Top
    { x: 150, y: 125 },   // Bottom-left
    { x: 250, y: 125 },   // Bottom-right
    { x: 200, y: 50 }     // Back to top
  ];

  const stroke: Stroke = {
    id,
    points,
    color: "#000000",
    width: 2,
    opacity: 1
  };

  return {
    name: "triangle",
    strokes: [stroke]
  };
}

function createLineTest() {
  const id = "test-line-" + Math.random().toString(36).substring(2, 9);

  // Add more points to create a realistic line
  const points = [];
  const startX = 300;
  const startY = 100;
  const endX = 400;
  const endY = 150;

  // Generate more points along the line
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    points.push({
      x: startX + t * (endX - startX),
      y: startY + t * (endY - startY)
    });
  }

  const stroke: Stroke = {
    id,
    points,
    color: "#000000",
    width: 2,
    opacity: 1
  };

  return {
    name: "line",
    strokes: [stroke]
  };
}

function createArrowTest() {
  const id = "test-arrow-" + Math.random().toString(36).substring(2, 9);

  // Create a straight line for the arrow shaft
  const shaftPoints = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    shaftPoints.push({
      x: 300 + t * 100,
      y: 200
    });
  }

  // Add the arrowhead
  shaftPoints.push({ x: 400, y: 200 });  // End of shaft
  shaftPoints.push({ x: 380, y: 190 });  // Top of arrowhead
  shaftPoints.push({ x: 400, y: 200 });  // Back to end of shaft
  shaftPoints.push({ x: 380, y: 210 });  // Bottom of arrowhead

  const stroke: Stroke = {
    id,
    points: shaftPoints,
    color: "#000000",
    width: 2,
    opacity: 1
  };

  return {
    name: "arrow",
    strokes: [stroke]
  };
}