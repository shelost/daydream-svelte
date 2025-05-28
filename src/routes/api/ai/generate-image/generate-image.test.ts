import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor() {}

      images = {
        generate: vi.fn().mockImplementation(({ prompt }) => {
          // If the prompt contains a blocked word, throw an error
          if (prompt.includes('weapon') || prompt.includes('gun') || prompt.includes('nude')) {
            throw new Error('Your request was rejected as a result of our safety system');
          }

          return Promise.resolve({
            data: [{ url: 'https://example.com/generated-image.png' }]
          });
        })
      }
    }
  };
});

// Mock the environment variables
vi.mock('$env/static/private', () => ({
  OPENAI_API_KEY: 'mock-openai-key'
}));

describe('Generate Image API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return 400 if required data is missing', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const response = await POST({ request } as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('should generate an image using GPT-image-1', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drawingContent: { strokes: [] },
        imageData: 'data:image/png;base64,abc123',
        textAnalysis: 'A sketch depicting a cat. It contains a label "fluffy"'
      })
    });

    const response = await POST({ request } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.imageUrl).toBe('https://example.com/generated-image.png');
    expect(data.model).toBe('gpt-image-1');
  });

  it('should include additional context in the prompt when provided', async () => {
    const openaiMock = require('openai').default;
    const generateMock = vi.fn().mockResolvedValue({
      data: [{ url: 'https://example.com/generated-image-with-context.png' }]
    });

    openaiMock.prototype.images.generate = generateMock;

    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drawingContent: { strokes: [] },
        imageData: 'data:image/png;base64,abc123',
        textAnalysis: 'A sketch depicting a dog',
        additionalContext: 'a friendly golden retriever playing in the park'
      })
    });

    const response = await POST({ request } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.imageUrl).toBe('https://example.com/generated-image-with-context.png');
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-1',
        prompt: expect.stringContaining('a friendly golden retriever playing in the park')
      })
    );
  });

  it('should sanitize potentially problematic input', async () => {
    const openaiMock = require('openai').default;
    const generateMock = vi.fn().mockResolvedValue({
      data: [{ url: 'https://example.com/sanitized-image.png' }]
    });

    openaiMock.prototype.images.generate = generateMock;

    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drawingContent: { strokes: [] },
        imageData: 'data:image/png;base64,abc123',
        textAnalysis: 'A sketch depicting a person holding a weapon',
        additionalContext: 'soldier with a gun'
      })
    });

    const response = await POST({ request } as any);

    // The sanitization should change "weapon" to "tool" and "gun" to "device"
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('weapon')
      })
    );

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('gun')
      })
    );

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('tool')
      })
    );

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('device')
      })
    );
  });

  it('should return appropriate error when content filter is triggered', async () => {
    // Set up the mock to throw a safety system error
    const openaiMock = require('openai').default;
    const generateMock = vi.fn().mockRejectedValue(
      new Error('Your request was rejected as a result of our safety system')
    );

    openaiMock.prototype.images.generate = generateMock;

    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drawingContent: { strokes: [] },
        imageData: 'data:image/png;base64,abc123',
        textAnalysis: 'A sketch depicting a nude figure',
        additionalContext: 'nude model'
      })
    });

    const response = await POST({ request } as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('safety system');
  });

  it('should extract text and object descriptions from text analysis', async () => {
    const openaiMock = require('openai').default;
    const generateMock = vi.fn().mockResolvedValue({
      data: [{ url: 'https://example.com/labeled-image.png' }]
    });

    openaiMock.prototype.images.generate = generateMock;

    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drawingContent: { strokes: [] },
        imageData: 'data:image/png;base64,abc123',
        textAnalysis: 'This is a sketch depicting a house with a garden. It contains labels "door", "window", and "tree".'
      })
    });

    await POST({ request } as any);

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('house with a garden')
      })
    );

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('door, window, tree')
      })
    );
  });
});