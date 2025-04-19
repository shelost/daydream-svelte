import { writable } from 'svelte/store';

interface SelectionState {
  selectedObject: any | null;
  selectedObjectType: string | null;
  selectedObjects: any[];
  currentPageId: string;
}

// Create a store with initial selection state
export const selectionStore = writable<SelectionState>({
  selectedObject: null,
  selectedObjectType: null,
  selectedObjects: [],
  currentPageId: ''
});

// Helper function to update selection
export function updateSelection(selection: Partial<SelectionState>) {
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