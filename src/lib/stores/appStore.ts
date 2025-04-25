import { writable, derived } from 'svelte/store';
import type { User } from '@supabase/supabase-js';

// Initialize stores
export const user = writable(null);
export const profile = writable(null);
export const currentPage = writable(null);
export const pages = writable([]);
export const selectedTool = writable('select');
export const saveStatus = writable('saved');
export const isSidebarOpen = writable(true);

// Derived stores
export const pagesByType = derived(pages, ($pages) => {
  const canvasPages = $pages.filter(page => page.type === 'canvas');
  const drawingPages = $pages.filter(page => page.type === 'drawing');
  const diagramPages = $pages.filter(page => page.type === 'diagram');
  return { canvasPages, drawingPages, diagramPages };
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
export function updateSaveStatus(status) {
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