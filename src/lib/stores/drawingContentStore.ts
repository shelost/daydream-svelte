import { writable } from 'svelte/store';
import type { DrawingContent } from '$lib/types';

// Create a store for the current drawing content
export const currentDrawingContent = writable<DrawingContent | null>(null);