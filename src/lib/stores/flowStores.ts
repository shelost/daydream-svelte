import { writable } from 'svelte/store';

export const activeDrawingNodeId = writable<string | null>(null);
