import { OPENAI_API_KEY } from '$env/static/private';

/**
 * Enhances shape recognition using OpenAI's vision capabilities
 *
 * @param imageDataUrl The image to analyze as a data URL
 * @param context Additional context about the drawing and basic shape detection
 * @param fetch The fetch function to use for making the request
 * @returns Enhanced analysis of the drawing
 */
export async function enhanceWithOpenAI(
  imageDataUrl: string,
  context: {
    context?: string;
    shapes?: Array<{ name: string; confidence: number; boundingBox?: any }>
  },
  fetch: any
) {
  // Extract the base64 part of the data URL
  const base64Image = imageDataUrl.split(',')[1];
  if (!base64Image) {
    throw new Error('Invalid image data URL');
  }

  // Prepare system message with instructions
  const systemMessage = `You are an expert at analyzing hand-drawn diagrams, sketches, and shapes.
Your task is to accurately identify what the user has drawn.
If basic shape detection has already been performed, use that as a starting point but improve upon it.
For each detected object, provide:
1. A descriptive name of what it is
2. A confidence score between 0 and 1
3. Any relevant properties that can be inferred

Always respond with valid JSON and format your response as follows:
{
  "analysis": {
    "type": string, // either "drawing", "diagram", or "text"
    "content": string, // a brief description of what was detected
    "confidence": number // between 0 and 1
  },
  "detectedObjects": [
    {
      "name": string, // e.g., "circle", "arrow", "rectangle", etc.
      "confidence": number, // between 0 and 1
      "properties": {} // any relevant properties
    }
  ]
}`;

  // Build the basic prompt with context about the drawing
  let userPrompt = 'Please analyze this drawing and tell me what shapes or objects you can identify.';

  // Add any additional context provided
  if (context.context) {
    userPrompt += ` Additional context: ${context.context}`;
  }

  // Add information about already detected shapes
  if (context.shapes && context.shapes.length > 0) {
    userPrompt += ` Basic shape detection already identified: ${JSON.stringify(context.shapes)}. Please verify and enhance this detection.`;
  }

  try {
    // Prepare the request to OpenAI
    const apiUrl = 'https://api.openai.com/v1/chat/completions';
    const payload = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.2
    };

    // Make the request to OpenAI using the imported API key from SvelteKit environment
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key not found in environment variables');
      throw new Error('OpenAI API key is not configured');
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Parse the response content
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    // Extract the JSON from the response
    try {
      // Try to parse the entire response as JSON first
      return JSON.parse(content);
    } catch (e) {
      // If that fails, try to extract JSON from the text
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) ||
                         content.match(/{[\s\S]*}/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }

      throw new Error('Could not parse JSON from OpenAI response');
    }
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    throw error;
  }
}