import { writable } from 'svelte/store';
import type { ChatMessage } from '$lib/openai/api';

// Define the shape of the AI chat store
interface AIChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  currentDrawingId: string | null;
}

// Create the initial state
const initialState: AIChatState = {
  messages: [],
  isLoading: false,
  error: null,
  currentDrawingId: null
};

// Create the writable store
const createAIChatStore = () => {
  const { subscribe, update, set } = writable<AIChatState>(initialState);

  return {
    subscribe,

    // Add a new message to the chat history
    addMessage: (message: ChatMessage) => {
      update(state => ({
        ...state,
        messages: [...state.messages, message]
      }));
    },

    // Set the loading state
    setLoading: (isLoading: boolean) => {
      update(state => ({
        ...state,
        isLoading
      }));
    },

    // Set an error message
    setError: (error: string | null) => {
      update(state => ({
        ...state,
        error
      }));
    },

    // Set the current drawing ID
    setCurrentDrawingId: (drawingId: string | null) => {
      update(state => ({
        ...state,
        currentDrawingId: drawingId
      }));
    },

    // Clear the chat history
    clearChat: () => {
      update(state => ({
        ...state,
        messages: []
      }));
    },

    // Reset to initial state
    reset: () => {
      set(initialState);
    }
  };
};

// Export the store
export const aiChatStore = createAIChatStore();