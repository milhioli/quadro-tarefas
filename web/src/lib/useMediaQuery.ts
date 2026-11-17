import { useCallback, useSyncExternalStore } from 'react';

/** Abaixo desta largura o app troca o quadro com arraste pela agenda. Mantenha igual ao CSS. */
export const MOBILE_QUERY = '(max-width: 768px)';

function supportsMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** Verdadeiro enquanto a media query casa; acompanha mudanças (girar o celular, redimensionar). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supportsMatchMedia()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = () => supportsMatchMedia() && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
