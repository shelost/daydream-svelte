import { writable } from 'svelte/store';

const browser = typeof window !== 'undefined';

const LOG_STORAGE_KEY = 'apiSessionLogs';
const COST_STORAGE_KEY = 'apiSessionTotalCost';

// Initial values - try to load from localStorage
const initialLogs = browser ? JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]') : [];
const initialCost = browser ? parseFloat(localStorage.getItem(COST_STORAGE_KEY) || '0') : 0;

export const loggedCalls = writable(initialLogs);
export const sessionTotalCost = writable(initialCost);

// Subscribe to changes and update localStorage
loggedCalls.subscribe(value => {
    if (browser) {
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(value));
    }
});

sessionTotalCost.subscribe(value => {
    if (browser) {
        localStorage.setItem(COST_STORAGE_KEY, value.toString());
    }
});

/**
 * Adds a new API call log entry to the store and updates the total cost.
 * @param {object} logEntry - The log entry to add.
 * Expected fields: id, timestamp, apiProvider, model, endpoint, cost, status, durationMs
 */
export function addApiCallToStore(logEntry) {
    if (!logEntry.id || !logEntry.timestamp || !logEntry.apiProvider || typeof logEntry.cost === 'undefined') {
        console.error('Invalid log entry passed to addApiCallToStore:', logEntry);
        return;
    }
    loggedCalls.update(currentLogs => [logEntry, ...currentLogs]); // Add to the beginning
    sessionTotalCost.update(currentCost => currentCost + (logEntry.cost || 0));
}

/**
 * Clears all logs and resets the total cost for the current session.
 */
export function clearSessionLogs() {
    loggedCalls.set([]);
    sessionTotalCost.set(0);
    if (browser) {
        localStorage.removeItem(LOG_STORAGE_KEY);
        localStorage.removeItem(COST_STORAGE_KEY);
    }
    console.log('API session logs and cost cleared.');
}

// Example of a log entry structure:
// const exampleLog = {
//     id: Date.now().toString(), // Unique ID for the call
//     timestamp: new Date().toISOString(),
//     apiProvider: 'OpenAI',
//     model: 'gpt-4o',
//     endpoint: '/v1/chat/completions',
//     cost: 0.0025,
//     status: 200, // HTTP status code from the API provider
//     durationMs: 1500, // Time taken for the API call
//     inputTokens: 100, // Optional, for LLMs
//     outputTokens: 50, // Optional, for LLMs
//     error: null // or error message string
// };