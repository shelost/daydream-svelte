import { Server } from 'socket.io';
import type { ViteDevServer } from 'vite';
import type { Server as HttpServer } from 'http';
import Replicate from 'replicate';

let io: Server | null = null;

export function initializeSocketServer(server: HttpServer | ViteDevServer) {
  if (io) return io;

  const httpServer = 'httpServer' in server ? server.httpServer : server;
  if (!httpServer) {
    console.error('No HTTP server available for Socket.io');
    return null;
  }

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  console.log('Socket.io server initialized');

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    let currentGenerationController: AbortController | null = null;
    let lastImageData: string | null = null;
    let generationTimer: NodeJS.Timeout | null = null;

    // Debounce settings
    const INITIAL_DELAY = 300; // 300ms after user stops drawing
    const REFINEMENT_DELAY = 2000; // 2s for higher quality

    socket.on('canvas-update', async (data) => {
      const { imageData, prompt, aspectRatio } = data;

      // Cancel any existing generation
      if (currentGenerationController) {
        currentGenerationController.abort();
        currentGenerationController = null;
      }

      // Clear existing timer
      if (generationTimer) {
        clearTimeout(generationTimer);
      }

      // Store the latest image data
      lastImageData = imageData;

      // Set up debounced generation
      generationTimer = setTimeout(async () => {
        if (!lastImageData) return;

        try {
          // Start with Flux Schnell for fast preview
          await generateWithModel(socket, lastImageData, prompt, aspectRatio, 'flux-schnell');

          // Schedule quality refinement if user remains idle
          generationTimer = setTimeout(async () => {
            if (lastImageData === imageData) { // Check if image hasn't changed
              await generateWithModel(socket, lastImageData, prompt, aspectRatio, 'flux-pro');
            }
          }, REFINEMENT_DELAY);

        } catch (error: any) {
          console.error('Generation error:', error);
          socket.emit('generation-error', { error: error.message });
        }
      }, INITIAL_DELAY);
    });

    socket.on('stop-generation', () => {
      console.log('Stopping generation for client:', socket.id);
      if (currentGenerationController) {
        currentGenerationController.abort();
        currentGenerationController = null;
      }
      if (generationTimer) {
        clearTimeout(generationTimer);
        generationTimer = null;
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      if (currentGenerationController) {
        currentGenerationController.abort();
      }
      if (generationTimer) {
        clearTimeout(generationTimer);
      }
    });

    async function generateWithModel(
      socket: any,
      imageData: string,
      prompt: string,
      aspectRatio: string,
      modelType: 'flux-schnell' | 'flux-pro'
    ) {
      try {
        // @ts-ignore
        const { REPLICATE_API_TOKEN } = await import('$env/static/private');
        if (!REPLICATE_API_TOKEN) {
          throw new Error('Replicate API token not configured');
        }

        const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

        // Extract base64 data from data URL
        const matches = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          throw new Error('Invalid image data format');
        }

        const imageType = matches[1];
        const base64Data = matches[2];

        // Determine dimensions based on aspect ratio
        let width = 1024;
        let height = 1024;
        if (aspectRatio === 'portrait') {
          width = 1024;
          height = 1792;
        } else if (aspectRatio === 'landscape') {
          width = 1792;
          height = 1024;
        }

        socket.emit('generation-started', { model: modelType });

        currentGenerationController = new AbortController();

        let prediction;
        if (modelType === 'flux-schnell') {
          // Flux Schnell - optimized for speed
          prediction = await replicate.predictions.create({
            version: "f2ab8a5bfe79f02f0dda1c1e1b3bffad146a09b9c4af4e384cb2170e82cf20e9",
            input: {
              prompt: `Based on this sketch: ${prompt}. Maintain exact structure and layout.`,
              image: `data:${imageType};base64,${base64Data}`,
              num_inference_steps: 4, // Very fast
              guidance_scale: 0, // No guidance for Schnell
              strength: 0.7, // Preserve sketch structure
              width,
              height,
              output_format: "webp",
              output_quality: 80
            }
          });
        } else {
          // Flux Pro - higher quality
          prediction = await replicate.predictions.create({
            version: "8b3d807d13e468d17c1d7f29dd6f30d9b9e5c7c1cb826d9e3c8d4db475315025",
            input: {
              prompt: `High quality rendering based on sketch: ${prompt}. Preserve exact structure and element positions.`,
              image: `data:${imageType};base64,${base64Data}`,
              num_inference_steps: 25,
              guidance_scale: 3.5,
              strength: 0.8,
              width,
              height,
              output_format: "png",
              output_quality: 95
            }
          });
        }

        // Poll for completion
        let result = prediction;
        while (result.status !== "succeeded" && result.status !== "failed") {
          await new Promise(resolve => setTimeout(resolve, 500));

          if (currentGenerationController?.signal.aborted) {
            console.log('Generation aborted');
            return;
          }

          result = await replicate.predictions.get(result.id);

          // Send progress updates
          if (result.logs) {
            socket.emit('generation-progress', {
              progress: result.progress || 0,
              logs: result.logs,
              model: modelType
            });
          }
        }

        if (result.status === "failed") {
          throw new Error(result.error || 'Generation failed');
        }

        // Extract image URL from result
        let imageUrl;
        if (Array.isArray(result.output)) {
          imageUrl = result.output[0];
        } else if (typeof result.output === 'string') {
          imageUrl = result.output;
        } else if (result.output && typeof result.output === 'object') {
          imageUrl = result.output.url || result.output.image;
        }

        if (!imageUrl) {
          throw new Error('No image URL in result');
        }

        socket.emit('generation-complete', {
          imageUrl,
          model: modelType,
          aspectRatio
        });

      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Generation error:', error);
          socket.emit('generation-error', {
            error: error.message || 'Generation failed',
            model: modelType
          });
        }
      } finally {
        currentGenerationController = null;
      }
    }
  });

  return io;
}

export function getSocketServer() {
  return io;
}
