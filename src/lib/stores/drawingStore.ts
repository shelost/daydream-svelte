import { writable } from 'svelte/store';

// Define standard paper sizes in pixels (at 72 dpi)
export const PAPER_SIZES = {
  A4_PORTRAIT: { width: 595, height: 842, name: 'A4 Portrait' },
  A4_LANDSCAPE: { width: 842, height: 595, name: 'A4 Landscape' },
  A3_PORTRAIT: { width: 842, height: 1191, name: 'A3 Portrait' },
  A3_LANDSCAPE: { width: 1191, height: 842, name: 'A3 Landscape' },
  LETTER_PORTRAIT: { width: 612, height: 792, name: 'Letter Portrait' },
  LETTER_LANDSCAPE: { width: 792, height: 612, name: 'Letter Landscape' },
  CUSTOM: { width: 800, height: 600, name: 'Custom' }
};

// Max canvas dimensions
export const MAX_CANVAS_WIDTH = 4000;
export const MAX_CANVAS_HEIGHT = 4000;

// Define the drawing tool settings store
export const drawingSettings = writable({
  // Tool selection
  selectedTool: 'pen' as 'pen' | 'select' | 'eraser' | 'pan',

  // Stroke settings
  strokeColor: '#000000',
  strokeSize: 3,
  opacity: 1,
  thinning: 0.5,
  smoothing: 2,
  streamline: 0.5,
  showPressure: true,
  capStart: true,
  capEnd: true,
  taperStart: 10,
  taperEnd: 0,

  // Selection settings
  selectedStrokes: [] as number[],
  isSelecting: false,
  selectionBox: null as {x1: number, y1: number, x2: number, y2: number} | null,

  // Canvas settings
  canvasWidth: PAPER_SIZES.A4_LANDSCAPE.width,
  canvasHeight: PAPER_SIZES.A4_LANDSCAPE.height,
  canvasColor: '#ffffff',
  backgroundColor: '#505050',
  showMiniMap: true,
  paperSize: 'A4_LANDSCAPE' as keyof typeof PAPER_SIZES | 'CUSTOM'
});

// Store for active drawing ID
export const activeDrawingId = writable<string | null>(null);