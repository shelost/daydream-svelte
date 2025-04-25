// @ts-nocheck
import { writable } from 'svelte/store';

// Initial selection state
export const selectionStore = writable({
  selectedObject: null,
  selectedObjectType: null,
  selectedObjects: [],
  currentPageId: ''
});

// Helper function to update selection
export function updateSelection(selection) {
  selectionStore.update(state => ({
    ...state,
    ...selection
  }));
}

// Helper to clear selection
export function clearSelection() {
  selectionStore.update(state => ({
    ...state,
    selectedObject: null,
    selectedObjectType: null,
    selectedObjects: []
  }));
}