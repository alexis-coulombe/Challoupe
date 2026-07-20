import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom doesn't implement these, but antd v5 components (Table, Select, Modal...) use them internally.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom throws on getComputedStyle for pseudo-elements, which rc-table uses to measure scrollbars.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (elt, pseudoElt) => {
  try {
    return realGetComputedStyle(elt, pseudoElt);
  } catch {
    return realGetComputedStyle(elt);
  }
};

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
