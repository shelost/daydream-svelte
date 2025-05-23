import { addApiCallToStore } from '$lib/stores/apiLogStore.js';

/**
 * Wraps the native fetch function to automatically log API calls
 * when a special `apiLogEntry` object is found in the JSON response from our backend.
 *
 * @param {string | URL | Request} resource - The resource to fetch.
 * @param {object} options - Fetch options.
 * @param {object} callMetaForLogging - Optional metadata for logging (currently unused, server provides log).
 * @returns {Promise<Response>} The fetch Response object.
 */
export async function fetchAndLog(resource, options, callMetaForLogging = {}) {
    const response = await fetch(resource, options);

    // Try to clone the response to read its body for logging
    // without consuming it for the actual application logic.
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        try {
            const clonedResponse = response.clone();
            const responseData = await clonedResponse.json();

            if (responseData && responseData.apiLogEntry) {
                // Perform a basic validation of the log entry structure
                const logEntry = responseData.apiLogEntry;
                if (logEntry.id && logEntry.timestamp && logEntry.apiProvider && typeof logEntry.cost !== 'undefined') {
                    // FIXED: Ensure successful responses always have status 200 regardless of what's
                    // in the apiLogEntry, since response.ok means it's a 2xx status
                    if (response.ok) {
                        logEntry.status = response.status; // Set to actual HTTP status (should be 200-299)
                        logEntry.error = null; // Clear any error message
                    }
                    addApiCallToStore(logEntry);
                } else {
                    console.warn('Received apiLogEntry with invalid structure:', logEntry);
                }
            } else if (responseData && responseData.error && responseData.apiLogEntry === null) {
                // Handle cases where server indicates an error and explicitly nullifies log entry
                console.warn('API call failed on server, log entry was nullified:', responseData.error);
            } else if (responseData && responseData.error && !responseData.apiLogEntry) {
                // If there's an error but no apiLogEntry, it might be a non-logged server error.
                // console.warn('Server responded with an error, but no apiLogEntry provided:', responseData.error);
            }

        } catch (error) {
            // This can happen if the response is not valid JSON or already consumed.
            console.warn('fetchAndLog: Could not parse JSON from response for logging or response already used:', error);
        }
    } else if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        // Attempt to log errors that also return an apiLogEntry
        try {
            const clonedResponse = response.clone();
            const errorData = await clonedResponse.json();
            if (errorData && errorData.apiLogEntry) {
                const logEntry = errorData.apiLogEntry;
                if (logEntry.id && logEntry.timestamp && logEntry.apiProvider && typeof logEntry.cost !== 'undefined') {
                    // FIXED: Ensure error responses always have the correct HTTP status
                    logEntry.status = response.status; // Set to actual HTTP error status
                    if (!logEntry.error && errorData.error) {
                        logEntry.error = errorData.error; // Ensure error message is populated
                    }
                    addApiCallToStore(logEntry);
                } else {
                    console.warn('Received apiLogEntry (on error) with invalid structure:', logEntry);
                }
            }
        } catch (error) {
            console.warn('fetchAndLog: Could not parse JSON from error response for logging:', error);
        }
    }

    return response; // Return the original response for the application to use
}