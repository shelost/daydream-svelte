import { writable } from 'svelte/store';

// Define the drawing tool settings store
export const drawingSettings = writable({
  // Tool selection
  selectedTool: 'pen' as 'pen' | 'select' | 'eraser' | 'pan',

  // Stroke settings
  strokeColor: '#000000',
  strokeSize: 3,
  opacity: 1,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  showPressure: true,
  capStart: true,
  capEnd: true,
  taperStart: 10,
  taperEnd: 0,

  // Selection settings
  selectedStrokes: [] as number[],
  isSelecting: false,
  selectionBox: null as {x1: number, y1: number, x2: number, y2: number} | null
});

// Store for active drawing ID
export const activeDrawingId = writable<string | null>(null);