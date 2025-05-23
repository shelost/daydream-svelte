import { writable } from 'svelte/store';

// Types
export interface DebugLogEntry {
  timestamp: number;
  source: string;
  message: string;
  data?: any;
}

// Stores
export const tensorflowLogs = writable<DebugLogEntry[]>([]);
export const gptLogs = writable<DebugLogEntry[]>([]);
export const isDebugDrawerOpen = writable<boolean>(false);

// Maximum number of logs to keep
const MAX_LOGS = 500;

/**
 * Log a debug message for TensorFlow processing
 * @param source The source of the log (e.g., 'detectObjects', 'classifyShape')
 * @param message The log message
 * @param data Optional data to include with the log
 */
export function logTensorflow(source: string, message: string, data?: any): void {
  const logEntry: DebugLogEntry = {
    timestamp: Date.now(),
    source,
    message,
    data
  };

  tensorflowLogs.update(logs => {
    const newLogs = [logEntry, ...logs];
    return newLogs.slice(0, MAX_LOGS);
  });

  // Auto-open drawer on important logs
  if (message.includes('error') || message.includes('failed')) {
    isDebugDrawerOpen.set(true);
  }

  // Also log to console for developer convenience
  console.log(`[TF:${source}] ${message}`, data);
}

/**
 * Log a debug message for GPT analysis
 * @param source The source of the log (e.g., 'analyzeSketch', 'enhanceObjects')
 * @param message The log message
 * @param data Optional data to include with the log
 */
export function logGPT(source: string, message: string, data?: any): void {
  const logEntry: DebugLogEntry = {
    timestamp: Date.now(),
    source,
    message,
    data
  };

  gptLogs.update(logs => {
    const newLogs = [logEntry, ...logs];
    return newLogs.slice(0, MAX_LOGS);
  });

  // Auto-open drawer on important logs
  if (message.includes('error') || message.includes('failed')) {
    isDebugDrawerOpen.set(true);
  }

  // Also log to console for developer convenience
  console.log(`[GPT:${source}] ${message}`, data);
}

/**
 * Clear logs for a specific type
 * @param type The type of logs to clear ('tensorflow' or 'gpt')
 */
export function clearLogs(type: 'tensorflow' | 'gpt'): void {
  if (type === 'tensorflow') {
    tensorflowLogs.set([]);
  } else if (type === 'gpt') {
    gptLogs.set([]);
  }
}

/**
 * Format timestamp for display
 * @param timestamp The timestamp to format
 * @returns Formatted timestamp string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Toggle the debug drawer open state
 */
export function toggleDebugDrawer(): void {
  isDebugDrawerOpen.update(value => !value);
}

/**
 * Set the debug drawer open state
 * @param isOpen Whether the drawer should be open
 */
export function setDebugDrawerOpen(isOpen: boolean): void {
  isDebugDrawerOpen.set(isOpen);
}