import { json } from '@sveltejs/kit';
import { detectShapes } from '$lib/services/shapeRecognition';
import { svgToPngDataUrl } from '$lib/utils/imageUtils';
import { convertStrokesToSvg } from '$lib/utils/svgUtils';
import type { Stroke } from '$lib/types/drawing';
import type { DetectedObject } from '$lib/types/detectedObject';
import { validateImageDataUrl } from '$lib/utils/imageUtils';
import { enhanceWithOpenAI } from '$lib/services/openai';
import { analyzeSketchWithCNN } from '$lib/services/analysisService';
import { normalizeBoundingBox, completeBoundingBox } from '$lib/utils/boundingBoxUtils';
import { analyzeQuickDraw } from '$lib/services/quickDrawRecognition';
import { analyzeTensorflowBoundingBoxes } from '$lib/services/tensorflowService.js';

// Constants for shape recognition
const SHAPE_CONFIDENCE_THRESHOLD = 0.7;
const MIN_POINTS_FOR_RECOGNITION = 3;

/**
 * API endpoint to analyze sketch strokes directly using our custom implementation
 * Processes stroke data instead of images, inspired by Google's Digital Ink Recognition
 */
export async function POST({ request, fetch }) {
  try {
    // Parse and validate the request body
    const body = await request.json();

    if (!body || !body.strokes || !Array.isArray(body.strokes) || body.strokes.length === 0) {
      console.error('Invalid request: Missing or empty strokes data');
      return json({ error: 'Invalid request: Missing or empty strokes' }, { status: 400 });
    }

    const {
      strokes,
      enhancedAnalysis = false,
      context = '',
      options = {
        useCNN: true,
        useShapeRecognition: true,
        useStrokeAnalysis: true,
        useTensorFlow: true
      }
    } = body;

    // Input validation
    try {
      validateStrokes(strokes);
    } catch (error) {
      console.error('Stroke validation error:', error instanceof Error ? error.message : error);
      return json({ error: `Invalid stroke data: ${error instanceof Error ? error.message : error}` }, { status: 400 });
    }

    console.log(`Processing ${strokes.length} strokes for analysis with options:`, options);

    // First, generate an SVG from the strokes
    let svgString;
    try {
      svgString = convertStrokesToSvg(strokes, 600, 600);
      if (!svgString || svgString.length < 100) {
        throw new Error('Generated SVG is too small or empty');
      }
    } catch (svgError) {
      console.error('Error generating SVG from strokes:', svgError);
      return json({
        error: 'Failed to convert strokes to SVG',
        debug: { error: svgError instanceof Error ? svgError.message : String(svgError) }
      }, { status: 500 });
    }

    // Basic shape detection using our improved shape recognition service - only if enabled
    let shapeRecognitionResult = { shapes: [], multiStrokeShapes: [] };
    if (options.useShapeRecognition) {
      shapeRecognitionResult = detectShapes(strokes);
    } else {
      console.log('Shape recognition disabled by options');
    }

    // Create a temporary canvas to use for CNN and Quick Draw analysis
    let canvas = null;
    let pngDataUrl = null;

    try {
      // Convert SVG to PNG for analysis - needed regardless of options
      pngDataUrl = await svgToPngDataUrl(svgString, 600, 600);
      console.log('Generated PNG data URL successfully');

      // Check if we're in a browser environment
      const isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';

      if (isBrowser) {
        console.log('Creating canvas for TensorFlow analysis in browser environment');
        // Create a canvas element to work with TensorFlow
        canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 600;

        // Load the PNG into the canvas
        const img = new Image();

        // Add error handling for image loading
        img.onerror = (err) => {
          console.error('Error loading image into canvas:', err);
        };

        img.onload = () => {
          console.log('Image loaded into canvas successfully');
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        };

        img.src = pngDataUrl;

        // Wait for image to load
        await new Promise((resolve, reject) => {
          if (img.complete) {
            console.log('Image was already complete');
            resolve(null);
          } else {
            img.onload = () => {
              console.log('Image loaded asynchronously');
              resolve(null);
            };
            img.onerror = (err) => {
              console.error('Error loading image:', err);
              reject(new Error('Failed to load image'));
            };

            // Set a timeout in case the image never loads
            setTimeout(() => {
              if (!img.complete) {
                console.warn('Image load timed out, continuing anyway');
                resolve(null);
              }
            }, 3000);
          }
        });

        // Verify canvas has content
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasContent = Array.from(imageData.data).some(val => val !== 0);

        if (!hasContent) {
          console.warn('Canvas appears to be empty after drawing image');
        } else {
          console.log('Canvas contains image data, proceeding with analysis');
        }
      } else {
        console.log('Skipping canvas creation - running in server environment');
      }
    } catch (canvasError) {
      console.error('Error creating canvas for analysis:', canvasError);
      // Continue with basic shape recognition
    }

    // Extract recognized shapes with high confidence - only if shape recognition is enabled
    let recognizedShapes = [];
    if (options.useShapeRecognition) {
      recognizedShapes = [
      ...shapeRecognitionResult.shapes.filter(shape => shape.confidence >= SHAPE_CONFIDENCE_THRESHOLD),
      ...(shapeRecognitionResult.multiStrokeShapes || []).filter(shape => shape.confidence >= SHAPE_CONFIDENCE_THRESHOLD - 0.1)
    ].sort((a, b) => b.confidence - a.confidence);

    // Check if we need to detect a house or building specifically
    const maybeHouse = checkForHouseOrBuildingPattern(strokes);
    if (maybeHouse) {
      console.log('Detected house-like pattern in strokes');
      recognizedShapes.unshift({
        type: 'house',
        confidence: 0.85,
        properties: { isRegular: true },
        boundingBox: maybeHouse.boundingBox,
        strokeIds: maybeHouse.strokeIds
      });
      }
    }

    // Find the best match (highest confidence)
    const bestMatch = recognizedShapes.length > 0 ? recognizedShapes[0] : null;

    // Initialize analysis with basic shape recognition
    let analysis = {
      type: 'drawing',
      content: bestMatch?.type || 'unrecognized shape',
      confidence: bestMatch?.confidence || 0
    };

    // Convert recognized shapes to a format suitable for the UI
    let detectedShapes: (DetectedObject & {
      enhancedByQuickDraw?: boolean;
      enhancedByCNN?: boolean;
      enhancedByTensorFlow?: boolean;
      enhancedByStrokes?: boolean;
    })[] = recognizedShapes.map(shape => {
      // Normalize the bounding box format
      const normalizedBox = shape.boundingBox ?
        normalizeBoundingBox(shape.boundingBox, 600, 600) : null;

      return {
        name: shape.type,
        confidence: shape.confidence,
        boundingBox: normalizedBox,
        properties: shape.properties,
        strokeIds: shape.strokeIds,
        source: 'shape-recognition'
      };
    });

    // Try direct TensorFlow analysis first if we have a canvas and TF is enabled
    if (canvas && options.useTensorFlow) {
      try {
        console.log('Running TensorFlow direct analysis on canvas');
        const tensorflowResults = await analyzeTensorflowBoundingBoxes(canvas);

        if (tensorflowResults && tensorflowResults.length > 0) {
          console.log(`TensorFlow detected ${tensorflowResults.length} objects: ${tensorflowResults.map(obj => obj.name).join(', ')}`);

          // Add TensorFlow results to detected shapes
          for (const tfObject of tensorflowResults) {
            const existingIndex = detectedShapes.findIndex(shape =>
              shape.name.toLowerCase() === tfObject.name.toLowerCase());

            if (existingIndex >= 0) {
              // If we already have this object, update if TensorFlow has higher confidence
              if (tfObject.confidence > detectedShapes[existingIndex].confidence) {
                detectedShapes[existingIndex] = {
                  ...detectedShapes[existingIndex],
                  name: tfObject.name,
                  confidence: tfObject.confidence,
                  boundingBox: tfObject.boundingBox || detectedShapes[existingIndex].boundingBox,
                  source: "tensorflow",
                  enhancedByTensorFlow: true
                };
              }
            } else {
              // Add new object from TensorFlow
              detectedShapes.push({
                name: tfObject.name,
                confidence: tfObject.confidence,
                boundingBox: tfObject.boundingBox,
                source: "tensorflow",
                enhancedByTensorFlow: true
              });
            }
          }

          // Sort by confidence
          detectedShapes.sort((a, b) => b.confidence - a.confidence);
        } else {
          console.log('TensorFlow did not detect any objects');
        }
      } catch (tfError) {
        console.error('TensorFlow analysis failed:', tfError);
        // Continue with other methods
      }
    } else if (!options.useTensorFlow) {
      console.log('TensorFlow analysis skipped due to options settings');
    }

    // Variable to store Quick Draw results
    let quickDrawResults: {
      name: string;
      confidence: number;
      boundingBox?: any;
      source: "tensorflow" | "cnn" | "shape-recognition" | "strokes" | "openai" | "fallback" | "hybrid";
    }[] | null = null;

    // Run Quick Draw analysis if canvas is available and CNN is enabled
    if (canvas && options.useCNN) {
      try {
        console.log('Running Quick Draw CNN analysis');
        const quickDrawResponse = await analyzeQuickDraw(canvas);

        if (quickDrawResponse && quickDrawResponse.success) {
          quickDrawResults = quickDrawResponse.results.map(result => ({
            name: result.className,
            confidence: result.probability,
            source: 'cnn',
            boundingBox: {
              minX: 0.1,
              minY: 0.1,
              width: 0.8,
              height: 0.8,
              // Add derived properties
              maxX: 0.9,
              maxY: 0.9
            }
          }));

          console.log('Quick Draw recognized:', quickDrawResults.map(r => r.name).join(', '));

          // Add to detected shapes if confidence is high enough
          quickDrawResults.forEach(qdr => {
            if (qdr.confidence > 0.7) {
              // Check if already exists
            const existingIndex = detectedShapes.findIndex(shape =>
                shape.name.toLowerCase() === qdr.name.toLowerCase());

            if (existingIndex >= 0) {
                // Only update if Quick Draw has higher confidence
                if (qdr.confidence > detectedShapes[existingIndex].confidence) {
                detectedShapes[existingIndex] = {
                  ...detectedShapes[existingIndex],
                    confidence: qdr.confidence,
                    source: 'cnn',
                  enhancedByQuickDraw: true
                };
              }
            } else {
                // Add as new object
              detectedShapes.push({
                  ...qdr,
                enhancedByQuickDraw: true
              });
            }
          }
          });
        }
      } catch (qdError) {
        console.error('Quick Draw analysis failed:', qdError);
      }
    } else if (!options.useCNN) {
      console.log('CNN/QuickDraw analysis skipped due to options settings');
          }

    // Continue with the remaining function, which will use the detected shapes...

    // Enhanced analysis with OpenAI if requested
    if (enhancedAnalysis) {
      try {
        // Convert SVG to PNG for OpenAI analysis
        if (!pngDataUrl) {
          pngDataUrl = await svgToPngDataUrl(svgString, 1024, 1024);
        }

        // Validate the data URL before sending to OpenAI
        if (!validateImageDataUrl(pngDataUrl)) {
          throw new Error('Generated PNG data URL is invalid');
        }

        // Include shape recognition results in the context for OpenAI
        const enhancedContext = context + (detectedShapes.length > 0
          ? `\nDetected shapes: ${detectedShapes.map(s => s.name).join(', ')}. Best match: ${bestMatch?.type} with confidence ${bestMatch?.confidence.toFixed(2)}.`
          : '');

        // Get enhanced analysis from OpenAI
        const enhancedResult = await enhanceWithOpenAI(
          pngDataUrl,
          {
            context: enhancedContext,
            shapes: detectedShapes
          },
          fetch
        );

        // If OpenAI provided better analysis, use it
        if (enhancedResult && enhancedResult.analysis) {
          analysis = enhancedResult.analysis;
          if (enhancedResult.detectedObjects && Array.isArray(enhancedResult.detectedObjects)) {
            // Merge AI-detected objects with our shape recognition and CNN results
            const aiObjects = enhancedResult.detectedObjects.filter(obj =>
              !detectedShapes.some(shape =>
                shape.name.toLowerCase() === obj.name.toLowerCase() &&
                Math.abs(shape.confidence - obj.confidence) < 0.2));

            // For objects already detected, use the one with higher confidence
            // and better bounding box precision (preferring CNN and stroke-based)
            for (const shape of detectedShapes) {
              const aiMatch = enhancedResult.detectedObjects.find(obj =>
                obj.name.toLowerCase() === shape.name.toLowerCase());

              if (aiMatch) {
                // Prefer our precise bounding boxes if they were enhanced by CNN or strokes
                if (shape.enhancedByCNN || shape.enhancedByStrokes || shape.enhancedByQuickDraw || shape.enhancedByTensorFlow) {
                  // Keep our precise bounding box but take OpenAI's confidence if higher
                  if (aiMatch.confidence > shape.confidence) {
                    shape.confidence = aiMatch.confidence;
                  }
                } else if (aiMatch.confidence > shape.confidence) {
                  // Otherwise use OpenAI's if it has higher confidence
                  shape.confidence = aiMatch.confidence;
                  if (aiMatch.boundingBox) {
                    shape.boundingBox = completeBoundingBox(aiMatch.boundingBox);
                  }
                }
              }
            }

            // Add new objects from AI
            detectedShapes = [...detectedShapes, ...aiObjects];
          }
        }
      } catch (aiError) {
        // Log the error but don't fail - we'll fall back to basic shape recognition
        console.error('OpenAI enhancement failed:', aiError);

        // Add debugging information but continue with basic recognition
        return json({
          analysis,
          detectedShapes,
          debug: {
            error: `AI enhancement failed: ${aiError instanceof Error ? aiError.message : String(aiError)}`,
            shapeRecognition: shapeRecognitionResult
          }
        });
      }
    }

    // Return an object with the detected shapes and analysis
    return json({
      detectedShapes,
      analysis,
      usedOptions: options
    });
  } catch (error) {
    console.error('Error in analyze-strokes endpoint:', error);
    return json({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No details available'
    }, { status: 500 });
  }
}

// Helper function to validate stroke data
function validateStrokes(strokes: any[]): asserts strokes is Stroke[] {
  if (!Array.isArray(strokes)) {
    throw new Error('Strokes must be an array');
  }

  if (strokes.length === 0) {
    throw new Error('No strokes provided');
  }

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];

    if (!stroke || typeof stroke !== 'object') {
      throw new Error(`Stroke at index ${i} is not an object`);
    }

    if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
      throw new Error(`Stroke at index ${i} has no valid points`);
    }

    for (let j = 0; j < stroke.points.length; j++) {
      const point = stroke.points[j];
      if (!point || typeof point !== 'object' ||
          typeof point.x !== 'number' ||
          typeof point.y !== 'number') {
        throw new Error(`Invalid point at stroke ${i}, point ${j}`);
      }
    }
  }
}

// Function to analyze stroke patterns for simple shape detection
function analyzeStrokePatterns(strokes: Stroke[]) {
  // Basic shape detection logic
  // This is a simplified version - in a real app, you'd use more sophisticated algorithms

  // Count total points across all strokes
  const totalPoints = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);

  // Check if the strokes form a closed shape
  const isClosedShape = strokes.some(stroke => {
    if (stroke.points.length < 3) return false;

    const firstPoint = stroke.points[0];
    const lastPoint = stroke.points[stroke.points.length - 1];

    // Calculate distance between first and last point
    const distance = Math.sqrt(
      Math.pow(lastPoint.x - firstPoint.x, 2) +
      Math.pow(lastPoint.y - firstPoint.y, 2)
    );

    // Consider it closed if the start and end points are close
    return distance < 20;
  });

  // Basic shape matching based on number of strokes and points
  const matches = [];

  // Check for simple circle/oval
  if (isClosedShape && strokes.length <= 2 && totalPoints > 10) {
    matches.push({ name: 'circle', confidence: 0.8 });
  }

  // Check for simple rectangle/square
  if (strokes.length <= 4 && isClosedShape) {
    matches.push({ name: 'rectangle', confidence: 0.7 });
  }

  // Check for triangle
  if (strokes.length <= 3 && isClosedShape) {
    matches.push({ name: 'triangle', confidence: 0.7 });
  }

  // Check for line
  if (strokes.length === 1 && strokes[0].points.length > 2 && !isClosedShape) {
    matches.push({ name: 'line', confidence: 0.9 });
  }

  // Check for complex drawing (many strokes and points)
  if (strokes.length > 5 || totalPoints > 50) {
    const humanConfidence = strokes.length > 10 ? 0.7 : 0.5;
    matches.push({ name: 'human', confidence: humanConfidence });
    matches.push({ name: 'drawing', confidence: 0.8 });
  }

  // Sort matches by confidence
  const sortedMatches = matches.sort((a, b) => b.confidence - a.confidence);

  return {
    isClosedShape,
    strokeCount: strokes.length,
    pointCount: totalPoints,
    allMatches: sortedMatches,
    bestMatch: sortedMatches.length > 0 ? sortedMatches[0] : null,
  };
}

// Function to determine the final analysis type based on shape recognition
function determineAnalysisType(basicAnalysis, enhancedAnalysis) {
  // If we have enhanced analysis with high confidence, use it
  if (enhancedAnalysis?.detectedShapes?.length > 0 && enhancedAnalysis.detectedShapes[0].name) {
    return {
      type: 'drawing',
      content: enhancedAnalysis.detectedShapes[0].name,
      confidence: 0.9
    };
  }

  // Otherwise use basic analysis
  if (basicAnalysis.bestMatch && basicAnalysis.bestMatch.confidence > SHAPE_CONFIDENCE_THRESHOLD) {
    return {
      type: 'drawing',
      content: basicAnalysis.bestMatch.name,
      confidence: basicAnalysis.bestMatch.confidence
    };
  }

  // Default fallback
  return {
    type: 'drawing',
    content: 'unrecognized shape',
    confidence: 0.5
  };
}

// Helper function to check for house or building patterns in strokes
function checkForHouseOrBuildingPattern(strokes: Stroke[]) {
  if (strokes.length < 2) return null;

  // A typical house consists of a rectangular body and a triangular roof
  // Look for a triangle on top of a rectangle

  // First, find the overall bounding box of all strokes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const allStrokeIds: string[] = [];

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;
    if (stroke.id) allStrokeIds.push(stroke.id);

    for (const point of stroke.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  // Check if we have a reasonable bounding box
  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
    return null;
  }

  // Analyze shape - typical house proportions
  const width = maxX - minX;
  const height = maxY - minY;
  const ratio = width / height;

  // Houses typically have a width to height ratio around 1.0 to 1.5
  if (ratio >= 0.8 && ratio <= 2.0) {
    // Check for triangular shape in the top portion
    let hasTriangularTop = false;

    // Look for triangular shapes or diagonal lines in the top third
    for (const stroke of strokes) {
      if (!stroke.points || stroke.points.length < 3) continue;

      // Count points in top third
      const topThirdPoints = stroke.points.filter(p =>
        p.y < minY + height / 3 &&
        p.x > minX &&
        p.x < maxX
      );

      if (topThirdPoints.length >= 3) {
        // Check for diagonal patterns (roof-like)
        let hasDiagonal = false;
        for (let i = 1; i < topThirdPoints.length; i++) {
          const dx = Math.abs(topThirdPoints[i].x - topThirdPoints[i-1].x);
          const dy = Math.abs(topThirdPoints[i].y - topThirdPoints[i-1].y);

          // If we have a sufficient diagonal component
          if (dx > 5 && dy > 5) {
            hasDiagonal = true;
            break;
          }
        }

        if (hasDiagonal) {
          hasTriangularTop = true;
          break;
        }
      }
    }

    // Check for rectangular shape in the bottom portion
    let hasRectangularBottom = false;

    // Count horizontal and vertical lines in bottom two-thirds
    let horizontalLines = 0;
    let verticalLines = 0;

    for (const stroke of strokes) {
      if (!stroke.points || stroke.points.length < 2) continue;

      // Filter points in bottom two-thirds
      const bottomPoints = stroke.points.filter(p =>
        p.y >= minY + height / 3 &&
        p.x >= minX &&
        p.x <= maxX
      );

      if (bottomPoints.length >= 2) {
        // Check for horizontal or vertical lines
        for (let i = 1; i < bottomPoints.length; i++) {
          const dx = Math.abs(bottomPoints[i].x - bottomPoints[i-1].x);
          const dy = Math.abs(bottomPoints[i].y - bottomPoints[i-1].y);

          if (dx > 5 && dy < 3) {
            horizontalLines++;
          } else if (dy > 5 && dx < 3) {
            verticalLines++;
          }
        }
      }
    }

    // If we have enough horizontal and vertical lines, it's rectangular
    if (horizontalLines >= 2 && verticalLines >= 2) {
      hasRectangularBottom = true;
    }

    // If we have a triangular top and rectangular bottom, it's likely a house
    if ((hasTriangularTop && hasRectangularBottom) ||
        (strokes.length >= 3 && ratio >= 0.8 && ratio <= 1.7)) {
      // Simple house pattern detected
      return {
        boundingBox: {
          x: minX,
          y: minY,
          width: width,
          height: height
        },
        strokeIds: allStrokeIds
      };
    }
  }

  return null;
}