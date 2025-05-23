import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import AIOverlay from '../lib/components/AIOverlay.svelte';

/**
 * Mock objects for testing
 */
const mockObjects = [
  {
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
    name: 'Test Object',
    category: 'human'
  }
];

/**
 * Mock canvas implementation
 */
class MockFabricCanvas {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.width = options.width;
    this.height = options.height;
    this.objects = [];
  }

  setWidth(width) {
    this.width = width;
    this.canvas.width = width;
  }

  setHeight(height) {
    this.height = height;
    this.canvas.height = height;
  }

  add(obj) {
    this.objects.push(obj);
  }

  clear() {
    this.objects = [];
  }

  renderAll() {}

  dispose() {
    this.objects = [];
  }
}

// Mock the fabric module
jest.mock('fabric', () => ({
  fabric: {
    StaticCanvas: function(canvas, options) {
      return new MockFabricCanvas(canvas, options);
    },
    Rect: function(options) {
      return { type: 'rect', ...options };
    },
    Text: function(text, options) {
      return { type: 'text', text, ...options };
    }
  }
}));

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
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
    this.callback(this.targets.map(target => ({ target })));
  }
};

describe('AIOverlay Component', () => {
  let canvasRef;

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
    canvasRef.getBoundingClientRect = () => ({
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
    jest.clearAllMocks();
  });

  test('initializes with correct dimensions', async () => {
    const { container } = render(AIOverlay, {
      props: {
        width: 800,
        height: 600,
        visible: true,
        detectedObjects: mockObjects,
        canvasRef
      }
    });

    await tick(); // Wait for component to update

    const overlayContainer = container.querySelector('.ai-overlay-container');
    expect(overlayContainer).not.toBeNull();
    expect(overlayContainer.style.width).toBe('800px');
    expect(overlayContainer.style.height).toBe('600px');
  });

  test('updates dimensions when drawing canvas changes size', async () => {
    const { container } = render(AIOverlay, {
      props: {
        width: 800,
        height: 600,
        visible: true,
        detectedObjects: mockObjects,
        canvasRef
      }
    });

    await tick(); // Wait for initial render

    // Simulate canvas resize
    canvasRef.width = 1000;
    canvasRef.height = 700;
    canvasRef.style.width = '1000px';
    canvasRef.style.height = '700px';

    Object.defineProperty(canvasRef, 'clientWidth', { value: 1000 });
    Object.defineProperty(canvasRef, 'clientHeight', { value: 700 });

    // Update bounding client rect mock
    canvasRef.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 1000,
      height: 700,
      bottom: 700,
      right: 1000
    });

    // Trigger the resize observer
    const resizeObserver = Array.from(ResizeObserver.prototype.observe.mock.instances)[0];
    resizeObserver.triggerResize();

    await tick(); // Wait for update

    const overlayContainer = container.querySelector('.ai-overlay-container');
    expect(overlayContainer.style.width).toBe('1000px');
    expect(overlayContainer.style.height).toBe('700px');
  });

  test('handles window resize events', async () => {
    const { container } = render(AIOverlay, {
      props: {
        width: 800,
        height: 600,
        visible: true,
        detectedObjects: mockObjects,
        canvasRef
      }
    });

    await tick(); // Wait for initial render

    // Simulate canvas resize
    canvasRef.width = 900;
    canvasRef.height = 500;
    canvasRef.style.width = '900px';
    canvasRef.style.height = '500px';

    Object.defineProperty(canvasRef, 'clientWidth', { value: 900 });
    Object.defineProperty(canvasRef, 'clientHeight', { value: 500 });

    // Update bounding client rect mock
    canvasRef.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 900,
      height: 500,
      bottom: 500,
      right: 900
    });

    // Trigger window resize event
    fireEvent(window, new Event('resize'));

    await tick(); // Wait for update

    const overlayContainer = container.querySelector('.ai-overlay-container');
    expect(overlayContainer.style.width).toBe('900px');
    expect(overlayContainer.style.height).toBe('500px');
  });

  test('maintains position when drawing canvas is offset', async () => {
    // Set up parent container with offset
    const parentContainer = document.createElement('div');
    parentContainer.style.position = 'relative';
    parentContainer.style.padding = '20px';
    document.body.appendChild(parentContainer);

    // Move canvas into parent
    document.body.removeChild(canvasRef);
    parentContainer.appendChild(canvasRef);

    // Update bounding client rect to simulate offset
    const parentRect = {
      top: 50,
      left: 50,
      width: 840,
      height: 640,
      bottom: 690,
      right: 890
    };

    const canvasRect = {
      top: 70, // 50 + 20px padding
      left: 70, // 50 + 20px padding
      width: 800,
      height: 600,
      bottom: 670,
      right: 870
    };

    parentContainer.getBoundingClientRect = () => parentRect;
    canvasRef.getBoundingClientRect = () => canvasRect;

    const { container } = render(AIOverlay, {
      props: {
        width: 800,
        height: 600,
        visible: true,
        detectedObjects: mockObjects,
        canvasRef
      }
    });

    await tick(); // Wait for initial render

    const overlayContainer = container.querySelector('.ai-overlay-container');
    expect(overlayContainer.style.left).toBe('20px'); // Should match the offset (70 - 50)
    expect(overlayContainer.style.top).toBe('20px'); // Should match the offset (70 - 50)

    // Clean up
    document.body.removeChild(parentContainer);
  });

  test('cleans up resources on destroy', async () => {
    // Spy on event listeners
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

    const { component } = render(AIOverlay, {
      props: {
        width: 800,
        height: 600,
        visible: true,
        detectedObjects: mockObjects,
        canvasRef
      }
    });

    await tick(); // Wait for initial render

    // Destroy the component
    component.$destroy();

    // Verify event listener cleanup
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});