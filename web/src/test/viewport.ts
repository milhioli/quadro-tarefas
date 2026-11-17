/**
 * matchMedia controlável nos testes (o jsdom não implementa). Só a query de
 * largura máxima (layout mobile) responde a `setViewport`; o resto é falso.
 */

type Viewport = 'mobile' | 'desktop';

let current: Viewport = 'desktop';
const listeners = new Set<() => void>();

function matches(query: string): boolean {
  return current === 'mobile' && query.includes('max-width');
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList => {
    const toFn = (listener: EventListenerOrEventListenerObject | null) =>
      typeof listener === 'function' ? (listener as () => void) : null;
    const list = {
      get matches() {
        return matches(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        const fn = toFn(listener);
        if (fn) listeners.add(fn);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        const fn = toFn(listener);
        if (fn) listeners.delete(fn);
      },
      addListener: (listener: (() => void) | null) => {
        if (listener) listeners.add(listener);
      },
      removeListener: (listener: (() => void) | null) => {
        if (listener) listeners.delete(listener);
      },
      dispatchEvent: () => false,
    };
    return list as unknown as MediaQueryList;
  };
}

/** Troca o tamanho simulado da tela e avisa quem estiver ouvindo. */
export function setViewport(viewport: Viewport): void {
  current = viewport;
  for (const listener of [...listeners]) listener();
}

export function resetViewport(): void {
  current = 'desktop';
  listeners.clear();
}
