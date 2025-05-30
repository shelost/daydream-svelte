import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const CHAT_VISIBILITY_KEY = 'daydream_chat_visible';

// Initialize with default value (true = chat visible by default)
function createChatVisibilityStore() {
    // Get initial value from localStorage if we're in the browser
    const initialValue = browser
        ? JSON.parse(localStorage.getItem(CHAT_VISIBILITY_KEY) ?? 'true')
        : false;

    const { subscribe, set, update } = writable(initialValue);

    return {
        subscribe,
        set: (value) => {
            set(value);
            // Save to localStorage when value changes
            if (browser) {
                localStorage.setItem(CHAT_VISIBILITY_KEY, JSON.stringify(value));
            }
        },
        update: (fn) => {
            update((currentValue) => {
                const newValue = fn(currentValue);
                // Save to localStorage when value changes
                if (browser) {
                    localStorage.setItem(CHAT_VISIBILITY_KEY, JSON.stringify(newValue));
                }
                return newValue;
            });
        },
        toggle: () => {
            update((currentValue) => {
                const newValue = !currentValue;
                // Save to localStorage when value changes
                if (browser) {
                    localStorage.setItem(CHAT_VISIBILITY_KEY, JSON.stringify(newValue));
                }
                return newValue;
            });
        }
    };
}

export const chatVisible = createChatVisibilityStore();