import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// O App real faria chamadas à API; aqui só interessa a montagem.
vi.mock('./App', async () => {
  const { createElement } = await import('react');
  return {
    App: ({ clock }: { clock: () => Date }) => createElement('p', null, `App montado (${typeof clock})`),
  };
});

afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('main', () => {
  it('monta o App dentro de #root com os providers', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    await act(async () => {
      await import('./main');
    });

    expect(await screen.findByText('App montado (function)')).toBeInTheDocument();
    expect(root).toContainElement(screen.getByText('App montado (function)'));
  });
});
