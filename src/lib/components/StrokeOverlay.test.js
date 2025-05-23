import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import StrokeOverlay from './StrokeOverlay.svelte';

// Mock ResizeObserver
class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
  }

  observe(target) {
    this.targets.push(target);
  }

  unobserve(target) {
    this.targets = this.targets.filter(t => t !== target);
  }

  disconnect() {
    this.targets = [];
  }

  // Helper method for tests to trigger the callback
  triggerResize() {
    this.callback(this.targets.map(target => ({ target, contentRect: target.getBoundingClientRect() })));
  }
}

// Add ResizeObserver to global if it doesn't exist
global.ResizeObserver = global.ResizeObserver || MockResizeObserver;

// Mock fabric
vi.mock('fabric', () => {
  const fabricMock = {
    StaticCanvas: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      renderAll: vi.fn(),
      setWidth: vi.fn(),
      setHeight: vi.fn()
    })),
    Path: vi.fn().mockImplementation(() => ({
      set: vi.fn()
    })),
    Rect: vi.fn().mockImplementation(() => ({
      set: vi.fn()
    })),
    Text: vi.fn().mockImplementation(() => ({
      set: vi.fn()
    }))
  };

  return {
    fabric: fabricMock
  };
});

describe('StrokeOverlay.svelte', () => {
  let canvasRef;

  const mockStrokes = [
    {
      id: 'stroke_1',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 }
      ],
      color: '#000000',
      size: 3,
      opacity: 1
    },
    {
      id: 'stroke_2',
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.6 }
      ],
      color: '#FF0000',
      size: 2,
      opacity: 0.8
    }
  ];

  const mockDetectedObjects = [
    {
      id: 'obj_1',
      name: 'Circle',
      category: 'circle',
      strokeIds: ['stroke_1'],
      color: '#FF5733'
    },
    {
      id: 'obj_2',
      name: 'Line',
      category: 'line',
      strokeIds: ['stroke_2'],
      color: '#33FF57'
    }
  ];

  beforeEach(() => {
    // Create a mock canvas element for the drawing canvas
    canvasRef = document.createElement('canvas');
    canvasRef.width = 800;
    canvasRef.height = 600;
    canvasRef.style.width = '800px';
    canvasRef.style.height = '600px';

    // Add the canvas to the document so it has proper dimensions
    document.body.appendChild(canvasRef);

    // Mock getBoundingClientRect
    canvasRef.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 0,
      left: 0,
      width: 800,
      height: 600,
      bottom: 600,
      right: 800
    });

    // Mock client dimensions
    Object.defineProperty(canvasRef, 'clientWidth', { value: 800 });
    Object.defineProperty(canvasRef, 'clientHeight', { value: 600 });
  });

  afterEach(() => {
    // Clean up
    if (document.body.contains(canvasRef)) {
      document.body.removeChild(canvasRef);
    }
    cleanup();
    vi.resetAllMocks();
  });

  it('renders correctly with provided props', async () => {
    const { container } = render(StrokeOverlay, {
      props: {
        strokes: mockStrokes,
        detectedObjects: mockDetectedObjects,
        width: 800,
        height: 600,
        visible: true
      }
    });

    // Check if the component renders
    expect(container).toBeTruthy();

    // Check if the canvas element is created
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
  });

  it('correctly applies visibility setting', async () => {
    const { container, component } = render(StrokeOverlay, {
      props: {
        strokes: mockStrokes,
        detectedObjects: mockDetectedObjects,
        width: 800,
        height: 600,
        visible: false
      }
    });

    // Get the canvas element
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas.style.display).toBe('none');

    // Update visible prop
    await component.$set({ visible: true });

    // Canvas should be visible
    expect(canvas.style.display).toBe('block');
  });

  it('works with external canvasRef', () => {
    const { container } = render(StrokeOverlay, {
      props: {
        strokes: mockStrokes,
        detectedObjects: mockDetectedObjects,
        width: 800,
        height: 600,
        visible: true,
        canvasRef
      }
    });

    // Check if the component renders
    expect(container).toBeTruthy();
  });
});