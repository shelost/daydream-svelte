import { writable, derived } from 'svelte/store';

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

// Layer-related interfaces and stores
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  strokes: any[];
  previewImage?: string;
}

// Store for managing layers
export const layers = writable<Layer[]>([
  {
    id: 'default-layer',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    strokes: []
  }
]);

// Active layer ID
export const activeLayerId = writable<string>('default-layer');

// Show layer panel flag
export const showLayerPanel = writable<boolean>(false);

// Derived store to get the active layer
export const activeLayer = derived(
  [layers, activeLayerId],
  ([$layers, $activeLayerId]) => $layers.find(layer => layer.id === $activeLayerId) || $layers[0]
);

// Function to create a new layer
export function createNewLayer() {
  const newLayerId = `layer-${Date.now()}`;
  const newLayerName = `Layer ${Math.floor(Math.random() * 1000)}`;

  layers.update(currentLayers => [
    ...currentLayers,
    {
      id: newLayerId,
      name: newLayerName,
      visible: true,
      opacity: 1,
      strokes: []
    }
  ]);

  // Set the new layer as active
  activeLayerId.set(newLayerId);

  return newLayerId;
}

// Function to delete a layer
export function deleteLayer(layerId: string) {
  layers.update(currentLayers => {
    // Filter out the layer to delete
    const filteredLayers = currentLayers.filter(layer => layer.id !== layerId);

    // If we deleted the last layer, create a new default layer
    if (filteredLayers.length === 0) {
      const defaultId = `layer-${Date.now()}`;
      filteredLayers.push({
        id: defaultId,
        name: 'Layer 1',
        visible: true,
        opacity: 1,
        strokes: []
      });

      // Update active layer ID
      activeLayerId.set(defaultId);
    }
    // If we deleted the active layer, make another layer active
    else if (layerId === currentLayers.find(l => l.id === layerId)?.id) {
      activeLayerId.set(filteredLayers[0].id);
    }

    return filteredLayers;
  });
}

// Function to update layer properties
export function updateLayer(layerId: string, properties: Partial<Layer>) {
  layers.update(currentLayers =>
    currentLayers.map(layer =>
      layer.id === layerId
        ? { ...layer, ...properties }
        : layer
    )
  );
}

// Function to reorder layers
export function reorderLayers(fromIndex: number, toIndex: number) {
  layers.update(currentLayers => {
    const result = [...currentLayers];
    const [removed] = result.splice(fromIndex, 1);
    result.splice(toIndex, 0, removed);
    return result;
  });
}

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
export const selectedTool = writable<'pen' | 'eraser' | 'select'>('pen');

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
    cap: true,              // Cap at the start
    taper: 30,              // Increased taper at start (was 0)
    easing: (t: number) => t, // Linear easing
  },
  end: {
    cap: false,              // Cap at the end
    taper: 30,              // Increased taper at end (was 0)
    easing: (t: number) => t, // Linear easing
  }
});
