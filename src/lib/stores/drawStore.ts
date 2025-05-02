import { writable } from 'svelte/store';

// Store for the dynamically generated prompt for GPT-Image-1
export const gptImagePrompt = writable<string>('');

// Store for the edit image prompt
export const gptEditPrompt = writable<string>('');

// Store for the URL of the generated image
export const generatedImageUrl = writable<string | null>(null);

// Store for the name of the model that generated the image
export const generatedByModel = writable<string | null>(null);

// Store for the image generation status
export const isGenerating = writable<boolean>(false);

// Stores for the edited image
export const editedImageUrl = writable<string | null>(null);
export const editedByModel = writable<string | null>(null);
export const isEditing = writable<boolean>(false);

// Store for analysis technology options - controls which technologies are used
export const analysisOptions = writable({
  useGPTVision: true,        // Controls GPT-4 Vision API usage (Sketch tab)
  useStrokeAnalysis: true,   // Controls stroke analysis (Strokes tab)
  useTensorFlow: true,       // Controls TensorFlow object detection
  useShapeRecognition: true, // Controls shape recognition algorithms
  useCNN: true               // Controls CNN-based recognition
});
