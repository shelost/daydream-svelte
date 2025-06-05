import { Server } from 'socket.io';

// This function will be called by the Vite plugin
export function configureSocketIO(httpServer) {
  const io = new Server(httpServer, {
    // Configure CORS if necessary, though for same-origin it's usually fine by default
    cors: {
      origin: "*", // Allow all origins for dev; restrict in production
      methods: ["GET", "POST"]
    },
    // Optional: configure transports if you need to restrict them
    // transports: ['websocket', 'polling'],
  });

  console.log('[Socket.IO Server] Initialized and attached to HTTP server.');

  io.on('connection', (socket) => {
    console.log(`[Socket.IO Server] Client connected: ${socket.id}`);

    socket.on('canvas-update', (data) => {
      // console.log(`[Socket.IO Server] Received canvas-update from ${socket.id}:`, data.prompt, data.aspectRatio);
      // In a real scenario, you would:
      // 1. Validate the data
      // 2. Potentially queue or process the image generation request
      // 3. Emit 'generation-started', 'generation-progress', 'generation-complete', or 'generation-error'

      // For now, let's simulate a quick generation and send back a placeholder
      socket.emit('generation-started', { model: 'flux-schnell-placeholder' });

      // Simulate some processing delay
      setTimeout(() => {
        // Placeholder: return the same image data or a modified version
        // In a real implementation, you'd get this from an AI model
        const mockImageUrl = data.imageData; // For testing, just echo back the input

        if (mockImageUrl) {
            // console.log(`[Socket.IO Server] Emitting generation-complete for ${socket.id}`);
            socket.emit('generation-complete', {
                imageUrl: mockImageUrl,
                model: 'flux-schnell-placeholder',
                // originalPrompt: data.prompt // if you need it
            });
        } else {
            console.log(`[Socket.IO Server] No image data in canvas-update, emitting error for ${socket.id}`);
            socket.emit('generation-error', { error: 'No image data received for real-time generation.' });
        }
      }, 1000); // Simulate 1 second delay
    });

    socket.on('stop-generation', () => {
      console.log(`[Socket.IO Server] Client ${socket.id} requested to stop generation.`);
      // Implement any logic to stop ongoing generation processes if applicable
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO Server] Client disconnected: ${socket.id}. Reason: ${reason}`);
    });
  });

  // Optional: Engine.IO error handling (lower-level)
  io.engine.on("connection_error", (err) => {
    console.error("[Socket.IO Engine] Connection Error Code:", err.code);    // e.g., 1
    console.error("[Socket.IO Engine] Connection Error Message:", err.message); // e.g., "Session ID unknown"
    console.error("[Socket.IO Engine] Connection Error Context:", err.context);  // e.g., { name: 'TransportError', transport: 'polling', previousTransport: 'websocket' }
  });

  return io; // Return the io instance if needed by the plugin
}