import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { ME_KEY, tasksKey } from '../../api/queries';
import { createFakeApi, makeTask } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { LoginScreen } from './LoginScreen';

function renderLogin(options: { outcome?: Parameters<typeof LoginScreen>[0]['outcome']; next?: string } = {}) {
  const api = createFakeApi();
  api.setMe({ user: null, pendingProfile: null });
  return renderWithProviders(<LoginScreen outcome={options.outcome ?? null} next={options.next ?? '/'} />, { api, boardId: null });
}

describe('LoginScreen', () => {
  it('com o Google configurado, mostra o link para o start (navegação comum)', async () => {
    renderLogin({ next: '/?hoje=2026-11-16' });
    const link = await screen.findByRole('link', { name: 'Entrar com Google' });
    expect(link).toHaveAttribute('href', '/api/auth/google/start?next=%2F%3Fhoje%3D2026-11-16');
    expect(screen.queryByRole('button', { name: 'Entrar (teste)' })).not.toBeInTheDocument();
  });

  it('sem o Google configurado, explica o que falta', async () => {
    const api = createFakeApi();
    api.setMethods({ google: false, dev: false });
    renderWithProviders(<LoginScreen outcome={null} next="/" />, { api, boardId: null });
    expect(await screen.findByText(/não está configurado neste servidor/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entrar com Google' })).not.toBeInTheDocument();
  });

  it.each([
    ['erro', 'Não foi possível entrar. Tente de novo.'],
    ['cancelado', 'O login foi cancelado.'],
    ['indisponivel', 'O login com Google está indisponível agora. Tente de novo em instantes.'],
  ] as const)('o resultado %s do login aparece como alerta', (outcome, message) => {
    renderLogin({ outcome });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('falha ao ler os métodos aparece como alerta', async () => {
    const api = createFakeApi();
    api.failNext('getAuthMethods', new ApiError(0, 'NETWORK', 'Sem rede'));
    renderWithProviders(<LoginScreen outcome={null} next="/" />, { api, boardId: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor');
  });

  it('no servidor de E2E, o login de teste entra e zera o cache', async () => {
    const api = createFakeApi();
    api.setMethods({ google: false, dev: true });
    const { user, queryClient } = renderWithProviders(<LoginScreen outcome={null} next="/" />, { api, boardId: null });
    queryClient.setQueryData(tasksKey(1), [makeTask({ id: 1 })]);
    const button = await screen.findByRole('button', { name: 'Entrar (teste)' });
    expect(button).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'E-mail de teste' }), 'bia@example.com');
    await user.click(button);
    await waitFor(() => expect(queryClient.getQueryData(ME_KEY)).toEqual({ user: null, pendingProfile: { suggestedName: 'bia' } }));
    expect(api.calls.find((c) => c.method === 'devLogin')?.args).toEqual(['bia@example.com']);
    expect(queryClient.getQueryData(tasksKey(1))).toBeUndefined();
  });

  it('erro do login de teste aparece como alerta', async () => {
    const api = createFakeApi();
    api.setMethods({ google: false, dev: true });
    api.failNext('devLogin', new ApiError(400, 'VALIDATION', 'Dados inválidos', [{ path: 'email', message: 'Use um e-mail @example.com' }]));
    const { user } = renderWithProviders(<LoginScreen outcome={null} next="/" />, { api, boardId: null });
    await user.type(await screen.findByRole('textbox', { name: 'E-mail de teste' }), 'bia@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Entrar (teste)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use um e-mail @example.com');
  });
});
