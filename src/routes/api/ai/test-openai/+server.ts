import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Try multiple ways to access the API key
export const GET: RequestHandler = async () => {
  try {
    // Method 1: Try importing from $env (should work in production)
    let method1ApiKey = 'NOT_AVAILABLE';
    try {
      const { OPENAI_API_KEY } = await import('$env/static/private');
      method1ApiKey = OPENAI_API_KEY ? 'AVAILABLE' : 'NOT_AVAILABLE';
    } catch (err) {
      method1ApiKey = `ERROR: ${err.message}`;
    }

    // Method 2: Try process.env (may work in some environments)
    const method2ApiKey = process.env?.OPENAI_API_KEY ? 'AVAILABLE' : 'NOT_AVAILABLE';

    // Method 3: Try import.meta.env (works in Vite development mode)
    const method3ApiKey = import.meta.env?.OPENAI_API_KEY ? 'AVAILABLE' : 'NOT_AVAILABLE';

    return json({
      message: 'API key accessibility test',
      methods: {
        '$env/static/private': method1ApiKey,
        'process.env': method2ApiKey,
        'import.meta.env': method3ApiKey
      }
    });
  } catch (error) {
    return json({
      error: `Error checking API key: ${error.message || error}`
    }, { status: 500 });
  }
};