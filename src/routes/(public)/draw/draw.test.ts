import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import DrawPage from './+page.svelte';

// Mock perfect-freehand
vi.mock('perfect-freehand', () => ({
  getStroke: vi.fn().mockReturnValue([[10, 10], [20, 20]])
}));

// Mock canvas methods
const mockContextMethods = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fill: vi.fn()
};

// Mock canvas element
global.HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContextMethods);
HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockImageData');

// Mock fetch
global.fetch = vi.fn();

describe('Draw Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock responses
    (global.fetch as any).mockImplementation((url) => {
      if (url.includes('analyze')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            message: 'The drawing shows a tree.'
          })
        });
      }

      if (url.includes('generate-image')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            imageUrl: 'https://example.com/image.png'
          })
        });
      }

      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Unknown endpoint' })
      });
    });
  });

  it('renders the drawing page with both canvases', () => {
    const { container } = render(DrawPage);

    // Check for both canvases
    const inputCanvas = container.querySelector('.input-canvas canvas');
    const outputDisplay = container.querySelector('.output-display');

    expect(inputCanvas).toBeTruthy();
    expect(outputDisplay).toBeTruthy();
  });

  it('renders the toolbar with drawing controls', () => {
    render(DrawPage);

    // Check for toolbar controls
    expect(screen.getByText('Size')).toBeTruthy();
    expect(screen.getByText('Color')).toBeTruthy();
    expect(screen.getByText('Opacity')).toBeTruthy();
    expect(screen.getByText('Clear')).toBeTruthy();
  });

  it('displays the Generate Image button', () => {
    render(DrawPage);

    const generateButton = screen.getByText('Generate Image');
    expect(generateButton).toBeTruthy();
    // Initially disabled because no strokes
    expect(generateButton.hasAttribute('disabled')).toBeTruthy();
  });

  it('shows an error message when trying to generate without drawing', async () => {
    render(DrawPage);

    const generateButton = screen.getByText('Generate Image');
    await fireEvent.click(generateButton);

    // Error should be displayed
    const errorMessage = await screen.findByText('Please draw something first!');
    expect(errorMessage).toBeTruthy();
  });

  it('calls the API endpoints when generating an image', async () => {
    const { component } = render(DrawPage);

    // Manually add a stroke to enable the generate button
    await component.$set({
      drawingContent: {
        strokes: [{
          tool: 'pen',
          points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
          color: '#000000',
          size: 3,
          opacity: 1
        }]
      }
    });

    // Generate button should now be enabled
    const generateButton = screen.getByText('Generate Image');
    expect(generateButton.hasAttribute('disabled')).toBeFalsy();

    // Click the generate button
    await fireEvent.click(generateButton);

    // Check if APIs were called
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/ai/analyze',
      expect.objectContaining({ method: 'POST' })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/ai/generate-image',
      expect.objectContaining({ method: 'POST' })
    );
  });
});