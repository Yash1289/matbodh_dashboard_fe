import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Mantine popovers, router and query client are slow under parallel workers.
configure({ asyncUtilTimeout: 5000 });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
window.ResizeObserver = ResizeObserverStub;
// jsdom lacks scrollIntoView; Mantine Combobox calls it on open.
Element.prototype.scrollIntoView = () => {};
