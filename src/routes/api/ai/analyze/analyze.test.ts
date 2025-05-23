import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';
import * as googleVision from '$lib/services/googleVision';
import type { RequestEvent } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';

// Use type augmentation to create a custom RequestEvent type for testing
type MockRequestEvent = Omit<RequestEvent, 'route'> & {
  route: {
    id: string;
  };
};

// Mock environment variables
vi.mock('$env/static/private', () => ({
  OPENAI_API_KEY: 'test-openai-key',
  GOOGLE_VISION_API_KEY: 'test-vision-key'
}));

// Mock the fetch function
global.fetch = vi.fn();

// Mock the POST function to accept our custom RequestEvent
const mockPOST = POST as unknown as (event: MockRequestEvent) => Promise<Response>;

describe('Analyze API Endpoint with Google Vision Integration', () => {
  // Create a mock RequestEvent instead of Request
  const mockRequestEvent = (body: any): MockRequestEvent => {
    // Create a minimal implementation that satisfies the TypeScript errors
    // We only need to implement what the handler actually uses
    return {
      request: {
        json: vi.fn().mockResolvedValue(body)
      } as unknown as Request,
      cookies: {} as Cookies,
      fetch: vi.fn(),
      getClientAddress: () => '127.0.0.1',
      locals: {} as any,
      params: {},
      platform: {},
      route: {
        id: '/api/ai/analyze'
      },
      setHeaders: vi.fn(),
      url: new URL('http://localhost/api/ai/analyze'),
      isDataRequest: false,
      isSubRequest: false
    } as MockRequestEvent;
  };

  const mockVisionResult = {
    labels: ['dog', 'animal', 'pet'],
    text: 'Good boy',
    safeSearch: { adult: 'UNLIKELY', violence: 'VERY_UNLIKELY' },
    faces: [],
    error: null
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Google Vision API call
    vi.spyOn(googleVision, 'analyzeImageWithVision').mockResolvedValue(mockVisionResult);

    // Mock generateImageDescription
    vi.spyOn(googleVision, 'generateImageDescription').mockReturnValue(
      'This image shows dog, animal, pet. The image contains the text: "Good boy"'
    );

    // Mock fetch for OpenAI call
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'test-id',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'This is a drawing of a dog saying "Good boy"'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150
        }
      })
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should analyze image with Google Vision when imageData is provided and useVision flag is true', async () => {
    const mockImageData = 'data:image/png;base64,iVBORw0KGgoA...';
    const requestBody = {
      drawingContent: { strokes: [] },
      userPrompt: 'Describe this drawing',
      imageData: mockImageData,
      useVision: true
    };

    const response = await mockPOST(mockRequestEvent(requestBody));
    const responseData = await response.json();

    expect(googleVision.analyzeImageWithVision).toHaveBeenCalledWith(mockImageData);
    expect(googleVision.generateImageDescription).toHaveBeenCalledWith(mockVisionResult);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-openai-key'
        }),
        body: expect.stringContaining('Vision analysis')
      })
    );
    expect(responseData).toHaveProperty('message');
    expect(responseData).not.toHaveProperty('error');
  });

  it('should not use Vision API when useVision flag is false', async () => {
    const mockImageData = 'data:image/png;base64,iVBORw0KGgoA...';
    const requestBody = {
      drawingContent: { strokes: [] },
      userPrompt: 'Describe this drawing',
      imageData: mockImageData,
      useVision: false
    };

    await mockPOST(mockRequestEvent(requestBody));

    expect(googleVision.analyzeImageWithVision).not.toHaveBeenCalled();
    expect(googleVision.generateImageDescription).not.toHaveBeenCalled();
  });

  it('should handle Vision API errors gracefully', async () => {
    vi.spyOn(googleVision, 'analyzeImageWithVision').mockResolvedValue({
      ...mockVisionResult,
      error: 'Vision API error'
    });

    const mockImageData = 'data:image/png;base64,iVBORw0KGgoA...';
    const requestBody = {
      drawingContent: { strokes: [] },
      userPrompt: 'Describe this drawing',
      imageData: mockImageData,
      useVision: true
    };

    const response = await mockPOST(mockRequestEvent(requestBody));
    const responseData = await response.json();

    expect(responseData).toHaveProperty('message');
    expect(global.fetch).toHaveBeenCalled();
    // Fix the type assertion for the fetch calls
    const fetchCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.parse(fetchCalls[0][1].body)).toContain('Vision API error');
  });
});