import { GOOGLE_VISION_API_KEY } from '$env/static/private';

export interface VisionAnalysisResult {
  labels: string[];
  text: string;
  safeSearch: {
    adult: string;
    violence: string;
  };
  faces: Array<{
    joyLikelihood: string;
    sorrowLikelihood?: string;
    angerLikelihood?: string;
    surpriseLikelihood?: string;
    headwearLikelihood?: string;
    detectionConfidence?: number;
  }>;
  objects: Array<{
    name: string;
    score: number;
  }>;
  error: string | null;
  rawResults?: any; // Store full raw results for debugging
}

/**
 * Analyzes an image using Google Cloud Vision API
 * @param imageBase64 The base64 encoded image data (can include data URI scheme)
 * @returns Analysis results from Google Vision API
 */
export async function analyzeImageWithVision(imageBase64: string): Promise<VisionAnalysisResult> {
  // Create default result structure for error cases
  const defaultResult: VisionAnalysisResult = {
    labels: [],
    text: '',
    safeSearch: { adult: 'UNKNOWN', violence: 'UNKNOWN' },
    faces: [],
    objects: [],
    error: null
  };

  try {
    // Strip the data URI scheme if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // Prepare the request body according to Vision API requirements
    // Expanded with more features for better analysis
    const requestBody = {
      requests: [{
        image: {
          content: base64Data
        },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 15 },  // Increased from 10
          { type: 'TEXT_DETECTION' },
          { type: 'FACE_DETECTION' },
          { type: 'SAFE_SEARCH_DETECTION' },
          { type: 'OBJECT_LOCALIZATION', maxResults: 10 },  // Added object detection
          { type: 'IMAGE_PROPERTIES' }  // Added color analysis
        ]
      }]
    };

    // Make the API request
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    // Check if the request was successful
    if (!response.ok) {
      return {
        ...defaultResult,
        error: `API request failed with status: ${response.status} ${response.statusText}`
      };
    }

    const data = await response.json();
    const annotations = data.responses[0];

    // Process and extract the relevant data
    return {
      labels: annotations.labelAnnotations
        ? annotations.labelAnnotations.map((label: any) => label.description)
        : [],
      text: annotations.textAnnotations && annotations.textAnnotations.length > 0
        ? annotations.textAnnotations[0].description
        : '',
      safeSearch: annotations.safeSearchAnnotation || { adult: 'UNKNOWN', violence: 'UNKNOWN' },
      faces: annotations.faceAnnotations || [],
      objects: annotations.localizedObjectAnnotations
        ? annotations.localizedObjectAnnotations.map((obj: any) => ({
            name: obj.name,
            score: obj.score
          }))
        : [],
      error: null,
      rawResults: annotations // Store the full results for deeper analysis if needed
    };
  } catch (error) {
    // Handle any network or processing errors
    return {
      ...defaultResult,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Generates a human-readable description from the Vision API analysis results
 * @param results The Vision API analysis results
 * @returns A string describing the image content
 */
export function generateImageDescription(results: VisionAnalysisResult): string {
  if (results.error) {
    return `Error analyzing image: ${results.error}`;
  }

  if (results.labels.length === 0 && !results.text && results.objects.length === 0) {
    return "The contents of this image could not be identified.";
  }

  let description = "";

  // Get unique identifiers from both labels and objects for more comprehensive detection
  const allIdentifiedItems = [...results.labels];

  // Add objects if they're not already in labels
  results.objects.forEach(obj => {
    if (!allIdentifiedItems.includes(obj.name.toLowerCase())) {
      allIdentifiedItems.push(obj.name);
    }
  });

  // Check for human-related labels to better describe people
  const humanLabels = allIdentifiedItems.filter(label =>
    ['person', 'human', 'girl', 'boy', 'woman', 'man', 'child', 'face', 'portrait', 'people'].includes(label.toLowerCase())
  );

  const isHumanImage = humanLabels.length > 0 || results.faces.length > 0;

  // Determine the main subject(s)
  if (isHumanImage) {
    // It's a human/portrait
    const gender = getGenderFromLabels(allIdentifiedItems);
    const age = getAgeGroupFromLabels(allIdentifiedItems);

    description = `This appears to be a drawing of ${gender ? gender + ' ' : ''}${age ? age : 'a person'}`;

    // Add facial expression if available
    if (results.faces.length > 0) {
      const expressions = getFacialExpressions(results.faces[0]);
      if (expressions) {
        description += ` ${expressions}`;
      }
    }
  } else {
    // Not a human - use top labels
    const topItems = allIdentifiedItems.slice(0, 3);
    description = `This appears to be a drawing of ${topItems.join(", ")}`;
  }

  // Add object details if there are specific objects
  if (results.objects.length > 0) {
    const uniqueObjects = [...new Set(results.objects.map(obj => obj.name))];
    if (uniqueObjects.length > 0 && !isHumanImage) {
      description += `. The drawing contains ${uniqueObjects.join(", ")}.`;
    }
  }

  // Add text content if available
  if (results.text) {
    description += `. The image contains the text: "${results.text.trim()}"`;
  }

  // Add stylistic observations
  description += getStyleObservation(allIdentifiedItems);

  // Add content moderation info if concerning
  if (results.safeSearch.adult !== 'VERY_UNLIKELY' && results.safeSearch.adult !== 'UNLIKELY') {
    description += ". Note: The image may contain mature content";
  }

  if (results.safeSearch.violence !== 'VERY_UNLIKELY' && results.safeSearch.violence !== 'UNLIKELY') {
    description += ". Note: The image may contain violent content";
  }

  return description;
}

/**
 * Helper function to determine gender from labels
 */
function getGenderFromLabels(labels: string[]): string {
  const lowerLabels = labels.map(l => l.toLowerCase());

  if (lowerLabels.includes('woman') || lowerLabels.includes('girl') || lowerLabels.includes('female')) {
    return 'female';
  }

  if (lowerLabels.includes('man') || lowerLabels.includes('boy') || lowerLabels.includes('male')) {
    return 'male';
  }

  return '';
}

/**
 * Helper function to determine age group from labels
 */
function getAgeGroupFromLabels(labels: string[]): string {
  const lowerLabels = labels.map(l => l.toLowerCase());

  if (lowerLabels.includes('child') || lowerLabels.includes('kid') || lowerLabels.includes('boy') || lowerLabels.includes('girl')) {
    return 'child';
  }

  if (lowerLabels.includes('teenager') || lowerLabels.includes('teen') || lowerLabels.includes('youth')) {
    return 'teenager';
  }

  if (lowerLabels.includes('adult') || lowerLabels.includes('man') || lowerLabels.includes('woman')) {
    return 'adult';
  }

  if (lowerLabels.includes('elderly') || lowerLabels.includes('senior') || lowerLabels.includes('old person')) {
    return 'elderly person';
  }

  return 'person';
}

/**
 * Helper function to interpret facial expressions
 */
function getFacialExpressions(face: any): string {
  if (!face) return '';

  if (face.joyLikelihood === 'VERY_LIKELY' || face.joyLikelihood === 'LIKELY') {
    return 'who appears to be smiling or happy';
  }

  if (face.sorrowLikelihood === 'VERY_LIKELY' || face.sorrowLikelihood === 'LIKELY') {
    return 'who appears to be sad';
  }

  if (face.angerLikelihood === 'VERY_LIKELY' || face.angerLikelihood === 'LIKELY') {
    return 'who appears to be angry';
  }

  if (face.surpriseLikelihood === 'VERY_LIKELY' || face.surpriseLikelihood === 'LIKELY') {
    return 'who appears to be surprised';
  }

  return '';
}

/**
 * Helper function to determine artistic style
 */
function getStyleObservation(labels: string[]): string {
  const lowerLabels = labels.map(l => l.toLowerCase());
  let style = '';

  // Check for artistic styles
  if (lowerLabels.includes('cartoon') || lowerLabels.includes('animation')) {
    style = ' The drawing appears to be in a cartoon style';
  } else if (lowerLabels.includes('sketch') || lowerLabels.includes('drawing')) {
    style = ' The image appears to be a hand-drawn sketch';
  } else if (lowerLabels.includes('anime') || lowerLabels.includes('manga')) {
    style = ' The drawing appears to be in an anime or manga style';
  } else if (lowerLabels.includes('illustration')) {
    style = ' This appears to be an illustration';
  } else {
    style = ' This appears to be a drawing';
  }

  return style;
}