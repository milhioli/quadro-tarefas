import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LOGGED_OUT, ME_KEY } from '../../api/queries';
import { createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { ProfileScreen } from './ProfileScreen';

function renderProfile(suggestedName = 'Ana', onLoggedOut = vi.fn()) {
  const api = createFakeApi();
  api.setMe({ user: null, pendingProfile: { suggestedName } });
  const result = renderWithProviders(<ProfileScreen suggestedName={suggestedName} onLoggedOut={onLoggedOut} />, {
    api,
    boardId: null,
  });
  return { ...result, onLoggedOut };
}

const usernameInput = () => screen.getByRole('textbox', { name: 'Nome de usuário' });
const displayNameInput = () => screen.getByRole('textbox', { name: 'Nome de exibição' });

describe('ProfileScreen', () => {
  it('pré-preenche o nome de exibição com a sugestão e deixa o usuário vazio', () => {
    renderProfile('Ana');
    expect(displayNameInput()).toHaveValue('Ana');
    expect(usernameInput()).toHaveValue('');
  });

  it('tem o rodapé com o link da privacidade', () => {
    renderProfile('Ana');
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', '/privacidade');
  });

  it('cria o perfil com o usuário em minúsculas e grava o me', async () => {
    const { api, user, queryClient } = renderProfile('Ana');
    await user.type(usernameInput(), ' Ana.Souza ');
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'createProfile')).toBe(true));
    expect(api.calls.find((c) => c.method === 'createProfile')?.args).toEqual([{ username: 'ana.souza', displayName: 'Ana' }]);
    await waitFor(() =>
      expect(queryClient.getQueryData<{ user: { handle: string } | null }>(ME_KEY)?.user?.handle).toBe('ana.souza_01'),
    );
  });

  it.each([
    ['curto demais', 'ab', 'Use de 3 a 20 letras minúsculas, números, ponto ou sublinhado'],
    ['com caractere inválido', 'ana!', 'Use de 3 a 20 letras minúsculas, números, ponto ou sublinhado'],
    ['reservado', 'admin', 'Esse nome de usuário é reservado'],
  ])('usuário %s: mostra o erro e não chama a API', async (_label, value, message) => {
    const { api, user } = renderProfile();
    await user.type(usernameInput(), value);
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(usernameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls.some((c) => c.method === 'createProfile')).toBe(false);
  });

  it('nome de exibição vazio ou com caractere invisível (bidi) é recusado antes da API', async () => {
    const { api, user } = renderProfile('');
    await user.type(usernameInput(), 'ana');
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(screen.getByText('Informe um nome de exibição')).toBeInTheDocument();

    await user.type(displayNameInput(), 'Ana‮');
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(screen.getByText('Use só caracteres visíveis')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'createProfile')).toBe(false);
  });

  it('erro do servidor aparece como alerta', async () => {
    const { api, user } = renderProfile();
    api.failNext('createProfile', new ApiError(409, 'CONFLICT', 'O perfil já foi criado'));
    await user.type(usernameInput(), 'ana');
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível criar o perfil. O perfil já foi criado');
  });

  it('Sair encerra a sessão e avisa quem chamou', async () => {
    const { api, user, queryClient, onLoggedOut } = renderProfile();
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT));
    expect(api.calls.some((c) => c.method === 'logout')).toBe(true);
    expect(onLoggedOut).toHaveBeenCalledOnce();
  });
});
