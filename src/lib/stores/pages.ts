import { writable } from 'svelte/store';
import type { Page } from '$lib/types';
import { getPages } from '$lib/supabase/pages';
import { user } from './auth';

// Create a writable store for pages
export const pages = writable<Page[]>([]);

// Function to load pages for the current user
export async function loadPages() {
  // Get the current user from the store
  let currentUser: any = null;
  const unsubscribe = user.subscribe(u => {
    currentUser = u;
  });
  unsubscribe();

  if (!currentUser) {
    console.error('No user found when loading pages');
    pages.set([]);
    return { error: 'No authenticated user' };
  }

  // Load the pages from Supabase
  const { data, error } = await getPages(currentUser.id);

  if (error) {
    console.error('Error loading pages:', error);
    return { error };
  }

  // Update the store
  pages.set(data || []);
  return { data };
}

// Reload pages whenever user changes
let userUnsubscribe: () => void;

export function initPagesListener() {
  // Clean up any existing subscription
  if (userUnsubscribe) userUnsubscribe();

  // Subscribe to user changes
  userUnsubscribe = user.subscribe(currentUser => {
    if (currentUser) {
      loadPages();
    } else {
      // Clear pages when user logs out
      pages.set([]);
    }
  });
}

// Clean up subscription
export function cleanupPagesListener() {
  if (userUnsubscribe) userUnsubscribe();
}