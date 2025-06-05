import type { Handle } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { initializeSocketServer } from '$lib/server/socket';

let socketInitialized = false;

export const handle: Handle = async ({ event, resolve }) => {
  // Initialize Socket.io server in development
  if (dev && !building && !socketInitialized) {
    // @ts-ignore - Vite dev server global
    if (globalThis.__viteDevServer) {
      console.log('Initializing Socket.io server...');
      // @ts-ignore
      initializeSocketServer(globalThis.__viteDevServer);
      socketInitialized = true;
    }
  }

  const response = await resolve(event);
  return response;
};
