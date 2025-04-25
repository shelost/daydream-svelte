import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';
import type { Stroke } from '$lib/types';
import { svgFromStrokes } from '$lib/utils/drawingUtils.js';
import { svgToPngDataUrl, validateImageDataUrl } from '$lib/utils/imageUtils';

// Constants for shape recognition
const SHAPE_CONFIDENCE_THRESHOLD = 0.7;
const MIN_POINTS_FOR_RECOGNITION = 3;

/**
 * API endpoint to analyze sketch strokes directly using our custom implementation
 * Processes stroke data instead of images, inspired by Google's Digital Ink Recognition
 */
export const POST: RequestHandler = async (event) => {
  try {
    console.log('Received request to analyze-strokes endpoint');
    const { strokes, enhancedAnalysis = false, context = '' } = await event.request.json();

    if (!strokes || !Array.isArray(strokes) || strokes.length === 0) {
      console.error('Invalid request: No valid stroke data provided');
      return json({
        error: 'Valid stroke data is required'
      }, { status: 400 });
    }

    // Basic validation - make sure strokes have points
    const validStrokes = strokes.filter(stroke =>
      stroke && stroke.points && Array.isArray(stroke.points) && stroke.points.length > 0
    );

    if (validStrokes.length === 0) {
      console.error('Invalid request: No valid strokes found in data');
      return json({
        error: 'No valid strokes found in the data'
      }, { status: 400 });
    }

    // Extract stroke data
    console.log(`Analyzing ${validStrokes.length} strokes with ${validStrokes.reduce((sum, s) => sum + s.points.length, 0)} total points`);

    // Generate SVG from the strokes for visualization and analysis
    const svgResult = svgFromStrokes(validStrokes, 1024, 1024, 'white', {
      debug: true,
      optimizeViewBox: true
    });

    // Check if we have valid SVG data
    if (svgResult.error) {
      console.error('Error generating SVG:', svgResult.error);
      return json({
        error: `Failed to generate SVG for analysis: ${svgResult.error}`
      }, { status: 500 });
    }

    // First, perform simple shape detection based on stroke patterns
    const shapeAnalysis = analyzeStrokePatterns(validStrokes);

    // For enhanced analysis, use OpenAI to get deeper insights
    let enhancedShapeRecognition = null;
    let detectedShapes = [];

    if (enhancedAnalysis) {
      try {
        // Check if OpenAI API key is available
        if (!OPENAI_API_KEY) {
          console.warn('Enhanced analysis requested but OpenAI API key is not configured');
          return json({
            analysis: {
              type: 'drawing',
              content: shapeAnalysis.bestMatch?.name || 'unrecognized shape',
              confidence: shapeAnalysis.bestMatch?.confidence || 0.5
            },
            debug: {
              strokeCount: validStrokes.length,
              pointCount: validStrokes.reduce((sum, s) => sum + s.points.length, 0),
              shapeRecognition: shapeAnalysis,
              enhancedRecognition: null
            },
            error: 'OpenAI API key is not configured for enhanced analysis'
          });
        }

        // Convert SVG to PNG format accepted by OpenAI's vision API
        console.log('SVG content length:', svgResult.svg.length);

        let pngDataUrl;
        try {
          pngDataUrl = svgToPngDataUrl(svgResult.svg, 1024, 1024);

          // Validate the PNG data URL
          if (!validateImageDataUrl(pngDataUrl)) {
            throw new Error('Generated PNG data URL failed validation');
          }

          console.log('PNG data URL generated successfully, length:', pngDataUrl.length);
        } catch (error) {
          console.error('Error in SVG to PNG conversion:', error);

          // Fall back to basic shape recognition
          return json({
            analysis: {
              type: 'drawing',
              content: shapeAnalysis.bestMatch?.name || 'unrecognized shape',
              confidence: shapeAnalysis.bestMatch?.confidence || 0.5
            },
            debug: {
              strokeCount: validStrokes.length,
              pointCount: validStrokes.reduce((sum, s) => sum + s.points.length, 0),
              shapeRecognition: shapeAnalysis,
              enhancedRecognition: null
            },
            error: `Image conversion failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }

        console.log('Initializing OpenAI client for enhanced analysis');
        const openai = new OpenAI({
          apiKey: OPENAI_API_KEY
        });

        // Use OpenAI Vision to analyze the PNG
        console.log('Sending PNG image to OpenAI Vision API for analysis...');
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are an expert at analyzing drawings and identifying shapes, objects, and their components.
                       Your task is to identify what objects are present in this stroke-based drawing and their hierarchical relationships.

                       The drawing appears to be a ${shapeAnalysis.bestMatch?.name || 'drawing'}. ${context ? `The user says it's supposed to be: "${context}".` : ''}

                       For each detected object:
                       1. Identify the main objects in the drawing
                       2. Break down each object into its components (e.g., a human has a head, body, arms, legs)
                       3. Estimate the position of each component (using values from 0-1 for both x and y coordinates)

                       Provide your response as a structured JSON object with a "detectedShapes" array containing objects with:
                       - id: unique identifier string
                       - name: element name (e.g., "head", "eye")
                       - category: type category (e.g., "human", "animal", "geometric", "abstract")
                       - x: horizontal position (0-1, from left to right)
                       - y: vertical position (0-1, from top to bottom)
                       - children: array of child object ids (if any)
                       - isChild: boolean indicating if this is a child element
                       - parentId: id of parent element if isChild is true`
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this stroke-based drawing and identify all objects and their components. Format your response as JSON with a detectedShapes array."
                },
                {
                  type: "image_url",
                  image_url: { url: pngDataUrl }
                }
              ]
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 1500
        });

        const analysisResult = response.choices[0].message.content;
        console.log('Received analysis from OpenAI');

        try {
          // Parse the JSON response
          const parsedResult = JSON.parse(analysisResult || '{}');

          // Extract detected shapes if available
          if (parsedResult.detectedShapes && Array.isArray(parsedResult.detectedShapes)) {
            detectedShapes = parsedResult.detectedShapes;

            // Assign colors if not provided
            const categoryColors = {
              'human': '#FF5733',
              'person': '#FF5733',
              'face': '#FF7F50',
              'head': '#FF7F50',
              'body': '#FF7F50',
              'animal': '#FF33A5',
              'building': '#3357FF',
              'nature': '#33FF57',
              'geometric': '#33A5FF',
              'abstract': '#9C27B0',
              'default': '#9C27B0'
            };

            detectedShapes.forEach(shape => {
              if (!shape.color) {
                shape.color = categoryColors[shape.category?.toLowerCase()] ||
                              categoryColors[shape.name?.toLowerCase()] ||
                              categoryColors.default;
              }

              // Ensure position values are valid
              if (typeof shape.x !== 'number' || shape.x < 0 || shape.x > 1) {
                shape.x = 0.5; // Default to center if invalid
              }
              if (typeof shape.y !== 'number' || shape.y < 0 || shape.y > 1) {
                shape.y = 0.5; // Default to center if invalid
              }

              // Ensure children array exists
              if (!Array.isArray(shape.children)) {
                shape.children = [];
              }
            });
          }

          enhancedShapeRecognition = parsedResult;
          console.log('Enhanced shape recognition processed successfully');
        } catch (error) {
          console.error('Error parsing JSON response from shape analysis:', error);
          // Continue with basic recognition
        }
      } catch (error) {
        console.error('Error calling OpenAI for enhanced shape recognition:', error);
        // Continue with basic recognition
      }
    }

    // Determine the analysis result
    const analysisType = determineAnalysisType(shapeAnalysis, enhancedShapeRecognition);

    // Format the response
    return json({
      analysis: {
        type: analysisType.type,
        content: analysisType.content,
        confidence: analysisType.confidence
      },
      debug: {
        strokeCount: validStrokes.length,
        pointCount: validStrokes.reduce((sum, s) => sum + s.points.length, 0),
        shapeRecognition: shapeAnalysis,
        enhancedRecognition: enhancedShapeRecognition
      },
      detectedShapes: detectedShapes
    });
  } catch (error) {
    console.error('Error analyzing strokes:', error);
    return json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
};

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