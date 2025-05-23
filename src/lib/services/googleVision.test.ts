import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeImageWithVision, generateImageDescription } from './googleVision';

// Mock environment variables
vi.mock('$env/static/private', () => ({
  GOOGLE_VISION_API_KEY: 'test-api-key'
}));

// Mock fetch function
global.fetch = vi.fn();

describe('Google Vision API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeImageWithVision', () => {
    it('should process a base64 image and call the Vision API', async () => {
      // Mock successful API response
      const mockResponse = {
        responses: [{
          labelAnnotations: [
            { description: 'dog', score: 0.9 },
            { description: 'pet', score: 0.8 }
          ],
          textAnnotations: [
            { description: 'HELLO' }
          ],
          safeSearchAnnotation: {
            adult: 'VERY_UNLIKELY',
            violence: 'VERY_UNLIKELY'
          },
          faceAnnotations: [
            { joyLikelihood: 'VERY_LIKELY' }
          ]
        }]
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      // Test with a minimal base64 image
      const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const result = await analyzeImageWithVision(testBase64);

      // Verify API was called correctly
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        'https://vision.googleapis.com/v1/images:annotate?key=test-api-key',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.any(String)
        })
      );

      // Verify result structure
      expect(result).toEqual({
        labels: ['dog', 'pet'],
        text: 'HELLO',
        safeSearch: { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY' },
        faces: [{ joyLikelihood: 'VERY_LIKELY' }],
        error: null
      });
    });

    it('should handle API errors gracefully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const testBase64 = 'data:image/png;base64,abc123';
      const result = await analyzeImageWithVision(testBase64);

      expect(result).toEqual({
        labels: [],
        text: '',
        safeSearch: { adult: 'UNKNOWN', violence: 'UNKNOWN' },
        faces: [],
        error: 'API request failed with status: 403 Forbidden'
      });
    });

    it('should handle network errors gracefully', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const testBase64 = 'data:image/png;base64,abc123';
      const result = await analyzeImageWithVision(testBase64);

      expect(result).toEqual({
        labels: [],
        text: '',
        safeSearch: { adult: 'UNKNOWN', violence: 'UNKNOWN' },
        faces: [],
        error: 'Network error'
      });
    });
  });

  describe('generateImageDescription', () => {
    it('should generate a description from the analysis results', () => {
      const mockResults = {
        labels: ['dog', 'puppy', 'cute'],
        text: 'GOOD BOY',
        safeSearch: { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY' },
        faces: [{ joyLikelihood: 'VERY_LIKELY' }],
        error: null
      };

      const description = generateImageDescription(mockResults);

      expect(description).toContain('dog');
      expect(description).toContain('puppy');
      expect(description).toContain('GOOD BOY');
      expect(description).toContain('joyful');
    });

    it('should handle missing data gracefully', () => {
      const emptyResults = {
        labels: [],
        text: '',
        safeSearch: { adult: 'UNKNOWN', violence: 'UNKNOWN' },
        faces: [],
        error: null
      };

      const description = generateImageDescription(emptyResults);

      expect(description).toContain('could not be identified');
    });

    it('should indicate errors in the description', () => {
      const errorResults = {
        labels: [],
        text: '',
        safeSearch: { adult: 'UNKNOWN', violence: 'UNKNOWN' },
        faces: [],
        error: 'API key invalid'
      };

      const description = generateImageDescription(errorResults);

      expect(description).toContain('Error analyzing image');
      expect(description).toContain('API key invalid');
    });
  });
});