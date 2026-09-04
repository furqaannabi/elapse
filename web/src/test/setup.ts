/**
 * Vitest setup: jest-dom matchers for component tests.
 */
import "@testing-library/jest-dom/vitest";

// jsdom has no matchMedia; sonner's Toaster and theme queries expect it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
