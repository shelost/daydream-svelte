import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import the Socket.IO server configuration function
import { configureSocketIO } from './src/lib/server/socket-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const absoluteScssPath = resolve(__dirname, 'src/app.scss').replace(/\\/g, '/');

// Custom Vite plugin to integrate Socket.IO
const socketIOPlugin = {
	name: 'socketIOPlugin',
	configureServer(server) {
		console.log('[Vite Plugin - socketIOPlugin] configureServer hook called.');
		if (server.httpServer) {
			console.log('[Vite Plugin - socketIOPlugin] httpServer found. Attaching Socket.IO...');
			try {
				configureSocketIO(server.httpServer);
				console.log('[Vite Plugin - socketIOPlugin] configureSocketIO called successfully.');
			} catch (e) {
				console.error('[Vite Plugin - socketIOPlugin] Error calling configureSocketIO:', e);
			}
		} else {
			console.error('[Vite Plugin - socketIOPlugin] HTTP server not available at initial configureServer. Will try again on httpServer.listening.');
			// Fallback: try to configure when the server starts listening
			server.httpServer?.on('listening', () => {
				console.log('[Vite Plugin - socketIOPlugin] httpServer listening event fired.');
				if (server.httpServer) {
					console.log('[Vite Plugin - socketIOPlugin] Configuring Socket.IO on listening event...');
					try {
						configureSocketIO(server.httpServer);
						console.log('[Vite Plugin - socketIOPlugin] configureSocketIO on listening event called successfully.');
					} catch (e) {
						console.error('[Vite Plugin - socketIOPlugin] Error calling configureSocketIO on listening event:', e);
					}
				} else {
					console.error('[Vite Plugin - socketIOPlugin] httpServer still not available on listening event.');
				}
			});
		}
	}
};

export default defineConfig({
	plugins: [sveltekit(), socketIOPlugin],
	resolve: {
		alias: {
			$components: resolve('./src/components'),
		},
	},
	css: {
		preprocessorOptions: {
			scss: {
				additionalData: `@import "${absoluteScssPath}";`
			}
		}
	},
	ssr: {
		noExternal: ['prismjs']
	}
});
