import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Drawing from '$lib/components/Drawing.svelte';

// Mock canvas functionality since JSDOM doesn't have canvas implementation
beforeEach(() => {
  // Mock canvas getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 100 })),
    canvas: { width: 800, height: 600 },
    setTransform: vi.fn(),
    transform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn()
  }));

  // Mock toDataURL
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mockedBase64Data');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Drawing Component', () => {
  it('should capture canvas as image', async () => {
    const content = { strokes: [] };
    const { component } = render(Drawing, {
      props: {
        pageId: 'test123',
        content,
        selectedTool: 'draw'
      }
    });

    // Access the component instance
    const drawingInstance = component.$$.ctx[component.$$.props.this];

    // Call the captureCanvasImage method
    const imageData = drawingInstance.captureCanvasImage();

    // Verify we get a data URL
    expect(imageData).toContain('data:image/png;base64');
  });
});