/**
 * Type definitions for content scripts
 */

declare global {
  interface Window {
    __MAX_PAGE_CONTEXT_TOKENS__: number;
  }

  // Extend Element for common properties
  interface Element {
    innerText?: string;
    value?: string;
  }
}

export {};