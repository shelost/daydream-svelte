import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'light' | 'dark';

// Initialize from local storage or default to 'dark'
const initialTheme: Theme = browser
  ? (localStorage.getItem('theme') as Theme) || 'dark'
  : 'dark';

// Create the theme store
export const theme = writable<Theme>(initialTheme);

// Separate init function to call from layouts/components
export function initTheme(): void {
  if (browser) {
    const savedTheme = localStorage.getItem('theme') as Theme || 'dark';
    theme.set(savedTheme);
    updateBodyClass(savedTheme);
  }
}

// Update body class for CSS
function updateBodyClass(themeValue: Theme): void {
  if (browser) {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${themeValue}`);
  }
}

// Subscribe to changes and update local storage and body class
if (browser) {
  theme.subscribe(value => {
    localStorage.setItem('theme', value);
    updateBodyClass(value);
  });
}

// Toggle between light and dark themes
export function toggleTheme(): void {
  theme.update(current => current === 'light' ? 'dark' : 'light');
}