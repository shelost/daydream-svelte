import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const code = url.searchParams.get('code');

  if (code) {
    try {
      // Exchange the code for a session
      const { error } = await locals.supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('Auth callback error:', error);
        throw redirect(303, '/?error=auth_callback_failed');
      }

      // Successfully authenticated, redirect to app page
      throw redirect(303, '/app');
    } catch (err) {
      console.error('Unexpected error in auth callback:', err);
      throw redirect(303, '/?error=unexpected_auth_error');
    }
  } else {
    // No code provided, redirect to login
    console.error('No code provided in auth callback');
    throw redirect(303, '/auth/login?error=no_code');
  }
};