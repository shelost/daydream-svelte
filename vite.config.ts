import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const absoluteScssPath = resolve(__dirname, 'src/app.scss').replace(/\\/g, '/');

export default defineConfig({
	plugins: [sveltekit()],
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
