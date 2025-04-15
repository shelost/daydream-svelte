import { writable, derived } from 'svelte/store';
import type { User } from '@supabase/supabase-js';
import type { Page, Tool, SaveStatus, Profile } from '$lib/types';

// Initialize stores
export const user = writable<User | null>(null);
export const profile = writable<Profile | null>(null);
export const currentPage = writable<Page | null>(null);
export const pages = writable<Page[]>([]);
export const selectedTool = writable<Tool>('select');
export const saveStatus = writable<SaveStatus>('saved');
export const isSidebarOpen = writable<boolean>(true);

// Derived stores
export const pagesByType = derived(pages, ($pages) => {
  const canvasPages = $pages.filter(page => page.type === 'canvas');
  const drawingPages = $pages.filter(page => page.type === 'drawing');
  return { canvasPages, drawingPages };
});

export const isLoggedIn = derived(user, ($user) => $user !== null);

export const userInitials = derived(profile, ($profile) => {
  if (!$profile || !$profile.full_name) return '';
  return $profile.full_name
    .split(' ')
    .map(name => name[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
});

// Helper function to update save status with auto-reset
export function updateSaveStatus(status: SaveStatus) {
  saveStatus.set(status);

  if (status === 'saving') {
    // Auto-reset to 'saved' after 3 seconds if still 'saving'
    setTimeout(() => {
      saveStatus.update(currentStatus =>
        currentStatus === 'saving' ? 'saved' : currentStatus
      );
    }, 3000);
  }
}