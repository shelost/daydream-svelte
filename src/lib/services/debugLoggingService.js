/**
 * Debug Logging Service
 * Provides functions for logging analysis steps and maintaining a history of logs
 * for both TensorFlow and GPT analysis processes
 */

import { writable, derived } from 'svelte/store';

// Create stores for log entries
const tensorflowLogs = writable([]);
const gptLogs = writable([]);

// Store for combined logs (used for searching across all logs)
const allLogs = derived([tensorflowLogs, gptLogs], ([$tfLogs, $gptLogs]) => {
  return [...$tfLogs, ...$gptLogs].sort((a, b) => b.timestamp - a.timestamp);
});

/**
 * Log a TensorFlow analysis event
 * @param {string} message - The log message
 * @param {string} source - The source file/function
 * @param {Object} data - Additional data for the log entry
 */
function logTensorflow(message, source, data = null) {
  tensorflowLogs.update(logs => {
    return [{
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      timestamp: Date.now(),
      message,
      source,
      data,
      type: 'tensorflow'
    }, ...logs];
  });

  // Also log to console for development
  console.log(`[TensorFlow] ${source}: ${message}`, data || '');
}

/**
 * Log a GPT analysis event
 * @param {string} message - The log message
 * @param {string} source - The source file/function
 * @param {Object} data - Additional data for the log entry
 */
function logGPT(message, source, data = null) {
  gptLogs.update(logs => {
    return [{
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      timestamp: Date.now(),
      message,
      source,
      data,
      type: 'gpt'
    }, ...logs];
  });

  // Also log to console for development
  console.log(`[GPT] ${source}: ${message}`, data || '');
}

/**
 * Clear all logs of a specific type
 * @param {string} type - The type of logs to clear ('tensorflow', 'gpt', or 'all')
 */
function clearLogs(type = 'all') {
  if (type === 'tensorflow' || type === 'all') {
    tensorflowLogs.set([]);
  }

  if (type === 'gpt' || type === 'all') {
    gptLogs.set([]);
  }
}

/**
 * Format a timestamp for display
 * @param {number} timestamp - The timestamp to format
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString() + '.' +
    date.getMilliseconds().toString().padStart(3, '0');
}

export {
  tensorflowLogs,
  gptLogs,
  allLogs,
  logTensorflow,
  logGPT,
  clearLogs,
  formatTimestamp
};