import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import Drawing from '$lib/components/Drawing.svelte';
import type { DrawingContent } from '$lib/types';

// Mock Supabase functions
vi.mock('$lib/supabase/pages', () => ({
  updatePageContent: vi.fn().mockResolvedValue({ data: {}, error: null }),
  uploadThumbnail: vi.fn().mockResolvedValue({ data: {}, error: null })
}));

// Mock Svelte stores
vi.mock('$lib/stores/drawingStore', () => ({
  drawingSettings: {
    subscribe: vi.fn().mockImplementation((callback) => {
      callback({
        selectedTool: 'pen',
        strokeColor: '#000000',
        strokeSize: 3,
        opacity: 1,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        showPressure: true,
        capStart: true,
        capEnd: true,
        taperStart: 0,
        taperEnd: 0,
        selectedStrokes: []
      });
      return () => {};
    }),
    update: vi.fn()
  },
  activeDrawingId: {
    set: vi.fn(),
    subscribe: vi.fn().mockImplementation((callback) => {
      callback(null);
      return () => {};
    })
  }
}));

vi.mock('$lib/stores/drawingContentStore', () => ({
  currentDrawingContent: {
    set: vi.fn(),
    subscribe: vi.fn().mockImplementation((callback) => {
      callback(null);
      return () => {};
    })
  }
}));

// Create canvas mocks since JSDOM doesn't support canvas
// eslint-disable-next-line @typescript-eslint/no-empty-function
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  globalAlpha: 1,
  beginPath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  lineCap: '',
  lineJoin: '',
  setLineDash: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  closePath: vi.fn(),
  getLineDash: vi.fn().mockReturnValue([]),
  drawImage: vi.fn()
});

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

describe('Drawing Component', () => {
  const mockSavingCallback = vi.fn();
  const mockSaveStatusCallback = vi.fn();

  // Sample drawing content
  const sampleContent: DrawingContent = {
    strokes: [
      {
        points: [
          { x: 10, y: 10, pressure: 0.5 },
          { x: 20, y: 20, pressure: 0.5 },
          { x: 30, y: 30, pressure: 0.5 }
        ],
        color: '#000000',
        size: 3,
        opacity: 1,
        tool: 'pen'
      },
      {
        points: [
          { x: 40, y: 40, pressure: 0.5 },
          { x: 50, y: 50, pressure: 0.5 },
          { x: 60, y: 60, pressure: 0.5 }
        ],
        color: '#FF0000',
        size: 5,
        opacity: 0.8,
        tool: 'highlighter'
      }
    ],
    bounds: {
      width: 800,
      height: 600
    }
  };

  beforeEach(() => {
    // Clear mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    vi.resetAllMocks();
  });

  it('initializes with provided content', () => {
    const { component } = render(Drawing, {
      pageId: 'test-page-id',
      content: sampleContent,
      selectedTool: 'draw',
      isDrawingMode: true,
      onSaving: mockSavingCallback,
      onSaveStatus: mockSaveStatusCallback
    });

    // Check that the component was initialized with the correct props
    expect(component.pageId).toBe('test-page-id');
    expect(component.content).toEqual(sampleContent);
    expect(component.content.strokes.length).toBe(2);
    expect(component.content.strokes[0].points.length).toBe(3);
    expect(component.content.strokes[1].tool).toBe('highlighter');
    expect(component.selectedTool).toBe('draw');
    expect(component.isDrawingMode).toBe(true);
  });

  it('dispatches contentUpdate event when content is set', async () => {
    const { component } = render(Drawing, {
      pageId: 'test-page-id',
      content: sampleContent,
      selectedTool: 'draw',
      isDrawingMode: true,
      onSaving: mockSavingCallback,
      onSaveStatus: mockSaveStatusCallback
    });

    // Setup a mock for the dispatch function
    const dispatchMock = vi.fn();
    // @ts-ignore - accessing internal dispatch for testing
    component.$$.ctx[component.$$.props.dispatch] = dispatchMock;

    // Manually trigger a content update
    component.content = {
      ...sampleContent,
      strokes: [...sampleContent.strokes, {
        points: [
          { x: 70, y: 70, pressure: 0.5 },
          { x: 80, y: 80, pressure: 0.5 }
        ],
        color: '#0000FF',
        size: 2,
        opacity: 1,
        tool: 'pen'
      }]
    };

    // Allow the component to react to the change
    await new Promise(resolve => setTimeout(resolve, 0));

    // Verify dispatch was called with updated content
    expect(dispatchMock).toHaveBeenCalledWith('contentUpdate', {
      content: component.content
    });
  });

  it('sets active drawing ID when pageId is provided', () => {
    const { component } = render(Drawing, {
      pageId: 'test-page-id',
      content: sampleContent,
      selectedTool: 'draw',
      isDrawingMode: true,
      onSaving: mockSavingCallback,
      onSaveStatus: mockSaveStatusCallback
    });

    // Get access to the imported modules
    const { activeDrawingId } = require('$lib/stores/drawingStore');

    // Verify the activeDrawingId was set with the provided pageId
    expect(activeDrawingId.set).toHaveBeenCalledWith('test-page-id');
  });

  it('updates currentDrawingContent store when content changes', () => {
    const { component } = render(Drawing, {
      pageId: 'test-page-id',
      content: sampleContent,
      selectedTool: 'draw',
      isDrawingMode: true,
      onSaving: mockSavingCallback,
      onSaveStatus: mockSaveStatusCallback
    });

    // Get access to the imported modules
    const { currentDrawingContent } = require('$lib/stores/drawingContentStore');

    // Verify the currentDrawingContent was updated with the provided content
    expect(currentDrawingContent.set).toHaveBeenCalledWith(sampleContent);
  });

  it('provides a function to capture canvas as image', () => {
    const { component } = render(Drawing, {
      pageId: 'test-page-id',
      content: sampleContent,
      selectedTool: 'draw',
      isDrawingMode: true,
      onSaving: mockSavingCallback,
      onSaveStatus: mockSaveStatusCallback
    });

    // Check that the captureCanvasImage function exists
    expect(typeof component.captureCanvasImage).toBe('function');

    // Mock the canvas toDataURL function
    const mockDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue(mockDataUrl);

    try {
      // Call the function
      const result = component.captureCanvasImage();

      // Check the result
      expect(result).toBe(mockDataUrl);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
    } finally {
      // Restore the original function
      HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    }
  });
});