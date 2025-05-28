import '@testing-library/jest-dom';
import { vi, afterEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

// Set up global mocks
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

// Mock window.getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    getPropertyValue: vi.fn().mockReturnValue('')
  })
});

// Mock Navigation API
class MockNavigationMock {
  entries = [];
  currentEntry = { url: 'http://localhost/', id: '1' };
  updateCurrentEntry() {}
  navigate() {}
  reload() {}
  addEventListener() {}
  removeEventListener() {}
}

// @ts-ignore
window.navigation = window.navigation || new MockNavigationMock();

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

// @ts-ignore
window.IntersectionObserver = window.IntersectionObserver || IntersectionObserverMock;

// Clean up mocks between tests
afterEach(() => {
  vi.resetAllMocks();
});