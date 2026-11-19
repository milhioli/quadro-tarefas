import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../test/fakeApi';
import { renderWithProviders } from '../test/render';
import { AppFooter, contactHref } from './AppFooter';

describe('AppFooter', () => {
  it('tem o link da privacidade e o contato como mailto', async () => {
    renderWithProviders(<AppFooter />, { boardId: null });
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', '/privacidade');
    expect(await screen.findByRole('link', { name: 'contato@example.com' })).toHaveAttribute('href', 'mailto:contato@example.com');
  });

  it('sem contato configurado, só a privacidade', async () => {
    const api = createFakeApi();
    api.setInfo({ contactEmail: null, operatorName: null });
    renderWithProviders(<AppFooter />, { api, boardId: null });
    expect(screen.getByRole('link', { name: 'Privacidade' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls.map((c) => c.method)).toContain('getInfo'));
    await act(async () => {});
    expect(screen.queryByText(/Contato/)).not.toBeInTheDocument();
  });
});

describe('contactHref', () => {
  it('só e-mail simples vira mailto', () => {
    expect(contactHref('contato@example.com')).toBe('mailto:contato@example.com');
    for (const bad of [null, undefined, '', 'sem-arroba', 'a b@example.com', 'x@example.com?subject=oi"', '<x@example.com>', 'javascript:x@y.com x']) {
      expect(contactHref(bad), String(bad)).toBeNull();
    }
  });
});
