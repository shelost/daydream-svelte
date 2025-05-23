import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * API endpoint to analyze a sketch using OpenAI's Vision capabilities
 * Takes an image data URL and returns a description of what's in the sketch
 */
export const POST: RequestHandler = async (event) => {
  try {
    // Extract request data
    const {
      imageData,
      enhancedAnalysis = false,
      requestHierarchy = false,
      requestPositions = false,
      excludeTrivialElements = false,
      context = ''
    } = await event.request.json();

    if (!imageData) {
      return json({
        error: 'Image data is required'
      }, { status: 400 });
    }

    if (!OPENAI_API_KEY) {
      return json({
        error: 'OpenAI API key is not configured'
      }, { status: 500 });
    }

    // Extract the base64 image data
    const base64Data = imageData.split(',')[1];

    // Initialize OpenAI API client
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY
    });

    // Construct system message based on analysis type
    let systemMessage = '';

    if (enhancedAnalysis) {
      systemMessage = `You are an expert sketch and drawing analyzer with expertise in computer vision, art analysis, and object recognition. Your task is to analyze a sketch and:

1. Identify all objects and elements in the sketch
2. Describe the sketch in detail
${requestHierarchy ? `3. Identify hierarchical relationships (e.g., a human has a head, the head has eyes)
4. Categorize objects by type (human, animal, building, nature, etc.)` : ''}
${requestPositions ? `5. Specify the exact position of each element (top, bottom, left, right, center)
6. Pay attention to spatial relationships between elements` : ''}
${excludeTrivialElements ? `7. Focus on meaningful elements, not trivial ones like individual lines` : ''}

${requestHierarchy && requestPositions ? `Return your analysis as a JSON object with:
1. A "description" field containing a text description
2. A "detectedObjects" array with objects having these properties:
   - id: unique identifier string
   - name: element name (e.g., "head", "eye")
   - category: type category (e.g., "human", "animal")
   - x: horizontal position (0-1, from left to right)
   - y: vertical position (0-1, from top to bottom)
   - width: width of the element (0-1, from left to right)
   - height: height of the element (0-1, from top to bottom)
   - children: array of ids of child elements
   - isChild: boolean indicating if this is a child element
   - parentId: id of parent element if isChild is true` : ''}

Provide a clear, detailed analysis that helps understand the structure and content of the drawing.`;
    } else {
      systemMessage = `You are an expert at analyzing sketches and drawings. Your task is to describe what you see in a user's sketch, focusing on the main elements, their arrangement, and any notable characteristics. Keep your description clear and informative.`;
    }

    // Create a special user message for requesting detailed object detection
    let userMessage = enhancedAnalysis
      ? "Analyze this sketch in detail. Identify all objects, their components, and their positions. " +
        (context ? `The drawing is supposed to be: "${context}". ` : '') +
        "Include all important elements but exclude trivial features like basic lines."
      : "Please analyze this sketch and describe what you see.";

    // Add specific instructions for hierarchical JSON response if needed
    if (enhancedAnalysis && requestHierarchy && requestPositions) {
      userMessage += " Format your response as a valid JSON object with 'description' and 'detectedObjects' fields as specified.";
    }

    // Prepare messages with proper typing
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: systemMessage
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userMessage
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Data}`
            }
          }
        ]
      }
    ];

    // Set up response format - simplified to match OpenAI API requirements
    const responseFormat = enhancedAnalysis && requestHierarchy && requestPositions
      ? { type: "json_object" as const }
      : undefined;

    // Make request to OpenAI API for analysis
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      response_format: responseFormat,
      max_tokens: 2000
    });

    // Extract results
    const analysisResult = response.choices[0].message.content;

    // Return simple text description for basic analysis
    if (!enhancedAnalysis || !requestHierarchy || !requestPositions) {
      return json({
        description: analysisResult,
        // Add analysis object for consistency with ShapeRecognitionDialog expectations
        analysis: {
          content: analysisResult || 'No analysis available',
          confidence: 0.8 // Default confidence for text analysis
        },
        detectedObjects: [] // Empty array to avoid null/undefined
      });
    }

    // Return structured JSON response for enhanced analysis
    try {
      const parsedResult = JSON.parse(analysisResult || '{}');

      // Ensure we have the expected fields
      if (!parsedResult.detectedObjects) {
        parsedResult.detectedObjects = [];
      }

      // Add analysis object for consistency with ShapeRecognitionDialog expectations
      if (!parsedResult.analysis) {
        parsedResult.analysis = {
          content: parsedResult.description || 'No analysis available',
          confidence: 0.8 // Default confidence
        };
      }

      // Set default colors for categories if not provided
      if (Array.isArray(parsedResult.detectedObjects)) {
        const categoryColors = {
          'human': '#FF5733',
          'animal': '#FF33A5',
          'building': '#3357FF',
          'nature': '#33FF57',
          'object': '#33A5FF',
          'vehicle': '#FF9900',
          'face': '#FF7F50',
          'head': '#FFA07A',
          'body': '#E9967A',
          'default': '#9C27B0'
        };

        // Process each object to ensure it has all required properties
        parsedResult.detectedObjects.forEach((obj: any, index: number) => {
          // Ensure object has an ID
          if (!obj.id) {
            obj.id = `obj_${index}`;
          }

          // Ensure position values are valid numbers between 0 and 1
          if (typeof obj.x !== 'number' || obj.x < 0 || obj.x > 1) {
            obj.x = 0.5; // Default to center if invalid
          }
          if (typeof obj.y !== 'number' || obj.y < 0 || obj.y > 1) {
            obj.y = 0.5; // Default to center if invalid
          }

          // Set colors based on category
          if (!obj.color) {
            const category = (obj.category || '').toLowerCase();
            const name = (obj.name || '').toLowerCase();

            obj.color = categoryColors[category] ||
                        categoryColors[name] ||
                        categoryColors.default;
          }

          // Ensure children array exists
          if (!Array.isArray(obj.children)) {
            obj.children = [];
          }
        });
      }

      console.log('Processed detected objects:', parsedResult.detectedObjects.length);
      return json(parsedResult);
    } catch (error) {
      console.error('Error parsing JSON response from OpenAI:', error);
      // Fall back to text response if JSON parsing fails
      return json({ description: analysisResult });
    }
  } catch (error) {
    console.error('Error analyzing sketch:', error);
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
};