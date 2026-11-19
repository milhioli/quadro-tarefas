import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// O Shell real faria chamadas à API; aqui só interessa a montagem e o que o main passa para ele.
vi.mock('./Shell', async () => {
  const { createElement } = await import('react');
  return {
    Shell: ({ clock, loginOutcome, next }: { clock: () => Date; loginOutcome: string | null; next: string }) =>
      createElement('p', null, `Shell montado (${typeof clock}, ${String(loginOutcome)}, ${next})`),
  };
});

vi.mock('./components/privacy/PrivacyPage', async () => {
  const { createElement } = await import('react');
  return { PrivacyPage: () => createElement('p', null, 'Página de privacidade montada') };
});

afterEach(() => {
  document.getElementById('root')?.remove();
  window.history.replaceState(null, '', '/');
  vi.resetModules();
});

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  return root;
}

describe('main', () => {
  it('monta o Shell dentro de #root; o ?login= vira aviso e sai da barra', async () => {
    window.history.replaceState(null, '', '/?login=erro');
    const root = mountRoot();

    await act(async () => {
      await import('./main');
    });

    const text = 'Shell montado (function, erro, /)';
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(root).toContainElement(screen.getByText(text));
    expect(window.location.search).toBe('');
  });

  it('em /privacidade monta a página de privacidade, e não o Shell', async () => {
    window.history.replaceState(null, '', '/privacidade');
    mountRoot();
    await act(async () => {
      await import('./main');
    });
    expect(await screen.findByText('Página de privacidade montada')).toBeInTheDocument();
    expect(screen.queryByText(/Shell montado/)).not.toBeInTheDocument();
  });
});
