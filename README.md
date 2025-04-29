# Daydream - Canvas Drawing App

A sophisticated canvas drawing application built with SvelteKit, Fabric.js, Perfect-freehand, and Supabase.

## Features

- **Authentication**: Sign up and log in with email/password or Google OAuth
- **Canvas Drawing**: Create and edit canvas pages with Fabric.js
- **Freehand Drawing**: Create beautiful freehand drawings with Perfect-freehand
- **Nested Documents**: Create drawings within canvas pages
- **Real-time Autosave**: Automatic saving of all changes
- **Minimalist UI**: Clean, simple interface inspired by MUJI and Apple design

## Tech Stack

- **SvelteKit**: Front-end framework with server-side rendering
- **Supabase**: Backend-as-a-Service for authentication and data storage
- **Fabric.js**: Canvas manipulation library
- **Perfect-freehand**: Smooth, realistic drawing algorithm
- **GSAP**: Animation library for smooth UI transitions
- **SCSS**: Styling with variables and nested rules

## Getting Started

### Prerequisites

- **Node.js**: Version 18 or higher (required)
  - We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions
  - Run `nvm use` in the project directory to automatically use the correct version
- npm or yarn
- Supabase account and project

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/daydream-svelte.git
   cd daydream-svelte
   ```

2. Ensure you're using Node.js 18+
   ```
   nvm use
   ```

3. Install dependencies
   ```
   npm install
   ```

4. Set up environment variables
   Create a `.env` file in the root directory with the following variables:
   ```
   PUBLIC_SUPABASE_URL=https://your-supabase-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

5. Run the SQL schema in your Supabase project
   Copy the contents of `schema.sql` and run it in the Supabase SQL editor

6. Start the development server
   ```
   npm run dev
   ```

## Project Structure

- `src/routes/(public)`: Public routes (landing page, auth pages)
- `src/routes/(app)`: Protected app routes (require authentication)
- `src/lib/components`: Reusable UI components
- `src/lib/supabase`: Supabase client and utility functions
- `src/lib/canvas`: Canvas and drawing utilities
- `src/lib/stores`: Svelte stores for state management

## Deployment

This project can be deployed to any platform that supports SvelteKit, such as Vercel, Netlify, or Cloudflare Pages.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Recent Optimizations

### Performance Improvements (July 2023)

We've made several optimizations to improve the performance of the application and reduce unnecessary API calls:

1. **Enhanced User Edit Detection**: The application now better distinguishes between actual user edits and programmatic changes to avoid triggering analysis unnecessarily.

2. **Perceptual Hashing for Stroke Comparison**: We've implemented a more sophisticated hashing algorithm that normalizes and compares strokes in a way that ignores minor variations but detects meaningful changes.

3. **Smart Throttling and Debouncing**: Analysis is now throttled more intelligently, with adaptive waiting periods based on drawing complexity and change significance.

4. **Differential Rendering**: UI components only re-render when there are significant changes in the detected objects, reducing unnecessary updates.

5. **Force Analysis Option**: Users can explicitly request analysis using the "Analyze Sketch Now" and "Recognize Shapes Now" buttons, which will always perform the analysis regardless of throttling rules.

These optimizations should result in:
- Fewer unnecessary API calls
- Better responsiveness when drawing
- More accurate object detection with less visual jitter
- Reduced resource usage on both client and server

If you experience any issues with these optimizations, please report them in the Issues section.
