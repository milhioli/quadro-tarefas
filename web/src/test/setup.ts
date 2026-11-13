import { afterEach } from 'vitest';

/**
 * Setup dos testes do web. O mesmo arquivo roda também nos testes com
 * `@vitest-environment node` (ex.: vite.config.test.ts), por isso tudo que
 * depende do DOM fica atrás da checagem de `window`.
 */
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
  installDomPolyfills();
}

/** APIs que o jsdom não implementa e que o ProseMirror/dnd-kit consultam. */
function installDomPolyfills(): void {
  const emptyRect = (): DOMRect => new DOMRect(0, 0, 0, 0);
  const emptyRectList = (): DOMRectList => {
    const list = {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* iterate(): Generator<DOMRect> {},
    };
    return list as unknown as DOMRectList;
  };

  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = emptyRect;
  }
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = emptyRectList;
  }
  if (typeof document.elementFromPoint !== 'function') {
    document.elementFromPoint = () => null;
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }
}
