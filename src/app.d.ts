// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="@supabase/supabase-js" />

import type { SupabaseClient, Session } from '@supabase/supabase-js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: any;
			getSession(): Promise<any>;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Module declarations for SvelteKit and other libraries
declare module '@supabase/supabase-js' {
  export const createClient: any;
  export type User = any;
  export type Session = any;
  export type SupabaseClient = any;
}

declare module '$app/stores' {
  export const page: any;
  export const navigating: any;
  export const updated: any;
}

declare module '$app/navigation' {
  export const goto: any;
  export const afterNavigate: any;
  export const beforeNavigate: any;
  export const disableScrollHandling: any;
}

declare module 'svelte' {
  export const onMount: any;
  export const onDestroy: any;
  export const createEventDispatcher: any;
  export const tick: any;
  export const untrack: any;
  export type ComponentType = any;
}

declare module 'svelte/store' {
  export const writable: any;
  export const readable: any;
  export const derived: any;
  export const get: any;
  export type Writable<T> = any;
  export type Readable<T> = any;
}

declare module 'svelte/transition' {
  export const slide: any;
  export const fade: any;
  export const fly: any;
}

declare module 'svelte/easing' {
  export const cubicOut: any;
  export const linear: any;
}

declare module 'fabric' {
  export const fabric: any;
}

declare module 'perfect-freehand' {
  export const getStroke: any;
  export type StrokeOptions = any;
}

declare module 'gsap' {
  export const gsap: any;
}

// Allow any imports from lib directories
declare module '$lib/*' {
  const value: any;
  export default value;
  export * from '$lib/*';
}

/// <reference types="@sveltejs/kit" />

// Import private environment variables
declare module '$env/static/private' {
	export const OPENAI_API_KEY: string;
	export const GOOGLE_VISION_API_KEY: string;
	// Add other private env variables as needed
}

// Public environment variables
declare module '$env/static/public' {
	export const PUBLIC_SUPABASE_URL: string;
	export const PUBLIC_SUPABASE_ANON_KEY: string;
	// Add other public env variables as needed
}

// Add drawing types
export interface Point {
  x: number;
  y: number;
  pressure?: number;
  timestamp?: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  width: number;
  opacity?: number;
  tool?: string;
  timestamp?: number;
}

export interface DrawingMetadata {
  createdAt: string;
  updatedAt: string;
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface Drawing {
  metadata: DrawingMetadata;
  strokes: Stroke[];
}

export interface RecognizedShape {
  type: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  strokeIds?: string[];
}

export interface AnalysisResult {
  shapes?: RecognizedShape[];
  objects?: RecognizedObject[];
  text?: string;
  debug?: any;
}

export interface RecognizedObject {
  label: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type DrawingMode = 'pen' | 'eraser' | 'highlighter' | 'select' | 'move';

export type AnalysisType = 'basic' | 'detailed' | 'enhanced';

export interface AnalysisOptions {
  type: AnalysisType;
  includeObjects?: boolean;
  includeShapes?: boolean;
  includeText?: boolean;
  useAI?: boolean;
}

export type StrokeOptions = any;

export {};
