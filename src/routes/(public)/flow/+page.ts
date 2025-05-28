// src/routes/draw/+page.ts
// This file ensures the route is properly loaded without authentication requirements

export const prerender = false;  // Disable prerendering for dynamic content
export const ssr = false;        // Disable server-side rendering
export const csr = true;         // Enable client-side rendering
