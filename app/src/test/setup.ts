import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement matchMedia, which both our theme helper and
// framer-motion's useReducedMotion rely on. Provide a no-op stub.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// React Aria (which HeroUI v3 is built on) and some layout code touch these
// observers on mount; jsdom doesn't provide them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??=
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

// jsdom logs "Not implemented" for window.scrollTo, which the AppShell calls
// on every route change (scroll-to-top). Replace it with a quiet no-op.
Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

// The plaza's swipe scroller calls Element#scrollTo, also missing in jsdom.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element["scrollTo"];
}

afterEach(() => {
  cleanup();
});
