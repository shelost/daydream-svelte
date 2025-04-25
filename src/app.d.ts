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

export {};
