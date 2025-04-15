import { writable } from 'svelte/store';
import type { User } from '@supabase/supabase-js';
import { supabase } from '$lib/supabase/client';

// Create a writable store for the authenticated user
export const user = writable<User | null>(null);

// Function to initialize the auth store (call this from app initialization)
export async function initAuth() {
  // Check for existing session
  const { data } = await supabase.auth.getSession();

  if (data.session?.user) {
    user.set(data.session.user);
  } else {
    user.set(null);
  }

  // Listen for auth changes
  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      user.set(session.user);
    } else {
      user.set(null);
    }
  });
}