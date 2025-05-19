import { writable } from 'svelte/store';

// Store for the dynamically generated prompt for GPT-Image-1
export const gptImagePrompt = writable<string>('');

// Store for the dynamically generated prompt for GPT-Image-1 Edit (edit-image endpoint)
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

// Store for selected model
export const selectedModel = writable<string>('gpt-image-1');

// Store for analysis technology options - controls which technologies are used
export const analysisOptions = writable({
  useGPTVision: true,        // Controls GPT-4 Vision API usage (Sketch tab)
  useStrokeAnalysis: true,   // Controls stroke analysis (Strokes tab)
  useTensorFlow: true,       // Controls TensorFlow object detection
  useShapeRecognition: true, // Controls shape recognition algorithms
  useCNN: true               // Controls CNN-based recognition
});

// Add a store to track if Apple Pencil (or similar stylus) is active
export const isApplePencilActive = writable<boolean>(false);

// Store for the selected drawing tool
export const selectedTool = writable<'pen' | 'eraser' | 'select' | 'text' | 'shape' | 'image'>('pen');

// Store for PerfectFreehand stroke options
export const strokeOptions = writable({
  // Basic stroke appearance
  color: '#000000',
  size: 15,
  opacity: 1,

  // PerfectFreehand options
  thinning: 0.7,            // Increased thinning for more pronounced pressure effect
  smoothing: 0.5,           // How much to smooth the stroke
  streamline: 0.5,          // How much to streamline the stroke
  easing: (t: number) => t, // Linear easing
  pressureIntensity: 10,   // Lower value with new algorithm for more sensitive pressure response

  // Start and end settings
  start: {
    cap: false,              // Cap at the start
    taper: 10,              // Increased taper at start (was 0)
    easing: (t: number) => t, // Linear easing
  },
  end: {
    cap: false,              // Cap at the end
    taper: 10,              // Increased taper at end (was 0)
    easing: (t: number) => t, // Linear easing
  }
});

// Fabric.js specific stores
export const fabricCanvas = writable<any>(null);
export const currentFabricObject = writable<any>(null);
export const fabricObjects = writable<any[]>([]);
export const isEraserMode = writable<boolean>(false);
export const fabricCanvasState = writable({
  isDrawing: false,
  isDragging: false,
  lastPosX: 0,
  lastPosY: 0
});
