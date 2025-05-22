// src/routes/(public)/canvas/+page.ts
// This file ensures the route is properly loaded without authentication requirements
// and disables SSR to prevent Prism.js server-side evaluation errors

export const prerender = false;  // Disable prerendering for dynamic content
export const ssr = false;        // Disable server-side rendering to avoid Prism.js SSR issues
export const csr = true;         // Enable client-side rendering

export function load() {
  return {
    // No initial data needed
  };
}