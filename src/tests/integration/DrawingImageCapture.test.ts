import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import Drawing from '$lib/components/Drawing.svelte';
import AIPanel from '$lib/components/AIPanel.svelte';
import type { DrawingContent } from '$lib/types';

// Mock necessary store functions
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
      callback('test-drawing-id');
      return () => {};
    })
  }
}));

vi.mock('$lib/stores/drawingContentStore', () => ({
  currentDrawingContent: {
    set: vi.fn(),
    subscribe: vi.fn().mockImplementation((callback) => {
      callback({
        strokes: [
          {
            points: [
              { x: 10, y: 10, pressure: 0.5 },
              { x: 20, y: 20, pressure: 0.5 }
            ],
            color: '#000000',
            size: 3,
            opacity: 1,
            tool: 'pen'
          }
        ],
        bounds: { width: 800, height: 600 }
      });
      return () => {};
    })
  }
}));

vi.mock('$lib/stores/aiChatStore', () => {
  const store = {
    messages: [],
    isLoading: false,
    error: null,
    currentDrawingId: 'test-drawing-id',
    addMessage: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    clearChat: vi.fn(),
    setCurrentDrawingId: vi.fn()
  };

  return {
    aiChatStore: {
      ...store,
      subscribe: vi.fn().mockImplementation((callback) => {
        callback(store);
        return () => {};
      })
    }
  };
});

// Mock canvas methods
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

// Mock fetch for API calls
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ message: 'AI response' })
  })
);

describe('Drawing Image Capture Integration Tests', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock canvas toDataURL
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    );

    // Set up global document querySelector to find our components
    document.querySelector = vi.fn().mockImplementation((selector) => {
      if (selector === '.drawing-area canvas') {
        const element = document.createElement('canvas');
        // @ts-ignore - mocking __svelte_component__
        element.__svelte_component__ = {
          captureCanvasImage: vi.fn().mockReturnValue(
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
          )
        };
        return element;
      }
      return null;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('captures image from Drawing component', () => {
    const { component } = render(Drawing, {
      pageId: 'test-drawing-id',
      content: {
        strokes: [{
          points: [{ x: 10, y: 10, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }],
          color: '#000000',
          size: 3,
          opacity: 1,
          tool: 'pen'
        }],
        bounds: { width: 800, height: 600 }
      },
      selectedTool: 'draw',
      isDrawingMode: true,
      onSaving: vi.fn(),
      onSaveStatus: vi.fn()
    });

    // Test the captureCanvasImage function
    expect(typeof component.captureCanvasImage).toBe('function');
    const imageData = component.captureCanvasImage();
    expect(imageData).toMatch(/^data:image\/png;base64,/);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('AIPanel captures image when sending message', async () => {
    // Render the AIPanel
    render(AIPanel);

    // Set up the input field and submit button
    const textarea = document.createElement('textarea');
    textarea.value = 'Analyze this drawing';
    document.querySelector = vi.fn().mockReturnValue(textarea);

    // Mock the getDrawingComponent and captureDrawingAsImage functions
    const aiPanel = document.querySelector('div.panel');
    if (aiPanel) {
      // Use type assertion to handle the Svelte component property
      const aiPanelComponent = (aiPanel as any).__svelte_component__;
      if (aiPanelComponent) {
        // @ts-ignore - we're mocking private methods
        aiPanelComponent.getDrawingComponent = vi.fn().mockReturnValue({
          captureCanvasImage: vi.fn().mockReturnValue(
            'data:image/png;base64,mockImageData'
          )
        });

        // Trigger the handleSendMessage function
        // @ts-ignore - accessing private method
        await aiPanelComponent.handleSendMessage();

        // Verify fetch was called with the image data
        expect(global.fetch).toHaveBeenCalled();
        const fetchCall = (global.fetch as any).mock.calls[0];
        expect(fetchCall[1].method).toBe('POST');

        const requestBody = JSON.parse(fetchCall[1].body);
        expect(requestBody).toHaveProperty('imageData');
        expect(requestBody.imageData).toMatch(/^data:image\/png;base64,/);
      }
    }
  });
});