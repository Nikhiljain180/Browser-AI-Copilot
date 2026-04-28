/**
 * Test Setup File for Jest/Vitest
 * Initializes test environment and global mocks
 */

const testApi = globalThis.vi || globalThis.jest;
const mockFn = testApi ? testApi.fn.bind(testApi) : (() => {
  throw new Error('No test mocking API available');
});

// Mock Chrome APIs
global.chrome = {
  runtime: {
    onMessage: { addListener: mockFn() },
    sendMessage: mockFn(),
    getURL: mockFn((path) => `chrome-extension://id/${path}`),
  },
  storage: {
    local: {
      get: mockFn(),
      set: mockFn(),
      remove: mockFn(),
    },
  },
  tabs: {
    query: mockFn(),
    executeScript: mockFn(),
    sendMessage: mockFn(),
  },
};

// Mock DOM APIs
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: mockFn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: mockFn(),
    removeListener: mockFn(),
    addEventListener: mockFn(),
    removeEventListener: mockFn(),
    dispatchEvent: mockFn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock MutationObserver
global.MutationObserver = class {
  constructor() {}
  disconnect() {}
  observe() {}
};

// Setup test timeout
if (testApi && typeof testApi.setTimeout === 'function') {
  testApi.setTimeout(10000);
}
