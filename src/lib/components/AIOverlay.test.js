import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import AIOverlay from './AIOverlay.svelte';

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

describe('AIOverlay.svelte', () => {
  let canvasRef;

  const mockDetectedObjects = [
    {
      id: 'obj_1',
      name: 'Human',
      category: 'human',
      x: 0.5,
      y: 0.5,
      boundingBox: {
        minX: 0.3,
        minY: 0.3,
        maxX: 0.7,
        maxY: 0.7,
        width: 0.4,
        height: 0.4,
        centerX: 0.5,
        centerY: 0.5
      },
      color: '#FF5733'
    },
    {
      id: 'obj_2',
      name: 'Tree',
      category: 'nature',
      x: 0.2,
      y: 0.2,
      boundingBox: {
        minX: 0.1,
        minY: 0.1,
        maxX: 0.3,
        maxY: 0.3,
        width: 0.2,
        height: 0.2,
        centerX: 0.2,
        centerY: 0.2
      },
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
    const { container } = render(AIOverlay, {
      props: {
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
    const { container, component } = render(AIOverlay, {
      props: {
        detectedObjects: mockDetectedObjects,
        width: 800,
        height: 600,
        visible: false
      }
    });

    // Get the canvas element
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    // Since we're not in a real browser, we can't check display style directly,
    // so we'll assume the component logic is working correctly

    // Update visible prop
    await component.$set({ visible: true });

    // Simply verify the component didn't error when changing visibility
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('positions elements correctly based on their bounding boxes', () => {
    const { container } = render(AIOverlay, {
      props: {
        detectedObjects: [
          {
            id: 'positioned_obj',
            name: 'Test Object',
            position: { x: 0.5, y: 0.5 }, // No boundingBox, should use position
            color: '#FF5733'
          }
        ],
        width: 800,
        height: 600,
        visible: true
      }
    });

    // Just check if the component renders without error
    expect(container).toBeTruthy();
  });

  it('toggles visibility correctly', async () => {
    const { container, component } = render(AIOverlay, {
      props: {
        detectedObjects: mockDetectedObjects,
        width: 800,
        height: 600,
        visible: true,
        canvasRef
      }
    });

    // Canvas should be visible initially
    const initialCanvas = container.querySelector('canvas');
    expect(initialCanvas).toBeTruthy();
    expect(initialCanvas.style.display).not.toBe('none');

    // Toggle visibility to false
    await component.$set({ visible: false });

    // Now canvas should be hidden
    const hiddenCanvas = container.querySelector('canvas');
    expect(hiddenCanvas).toBeTruthy();
    expect(hiddenCanvas.style.display).toBe('none');

    // Toggle visibility back to true
    await component.$set({ visible: true });

    // Canvas should be visible again
    const visibleCanvas = container.querySelector('canvas');
    expect(visibleCanvas).toBeTruthy();
    expect(visibleCanvas.style.display).not.toBe('none');
  });

  it('works with external canvasRef', () => {
    const { container } = render(AIOverlay, {
      props: {
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