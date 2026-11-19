import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LOGGED_OUT, ME_KEY } from '../../api/queries';
import { FAKE_USER, PERSONAL_BOARD, createFakeApi, type FakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { SessionBar } from './SessionBar';

function renderBar(api: FakeApi = createFakeApi()) {
  const onChooseBoard = vi.fn();
  const onLoggedOut = vi.fn();
  const result = renderWithProviders(
    <SessionBar user={FAKE_USER} boards={[PERSONAL_BOARD]} boardId={1} onChooseBoard={onChooseBoard} onLoggedOut={onLoggedOut} />,
    { api, boardId: null },
  );
  return { ...result, onChooseBoard, onLoggedOut };
}

describe('SessionBar', () => {
  it('mostra o nome de exibição e o handle isolado em <bdi>, com espaço entre eles', () => {
    renderBar();
    const handle = screen.getByText('admin_00');
    expect(handle.tagName).toBe('BDI');
    expect(handle.parentElement?.textContent).toBe('Admin admin_00');
  });

  it('Sair encerra a sessão e avisa quem chamou', async () => {
    const { api, user, queryClient, onLoggedOut } = renderBar();
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT));
    expect(api.calls.some((c) => c.method === 'logout')).toBe(true);
    expect(onLoggedOut).toHaveBeenCalledOnce();
  });

  it('falha ao sair mostra o erro e mantém a sessão', async () => {
    const api = createFakeApi();
    api.failNext('logout', new ApiError(0, 'NETWORK', 'Sem rede'));
    const { user, onLoggedOut } = renderBar(api);
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível sair');
    expect(onLoggedOut).not.toHaveBeenCalled();
  });

  it('sem convites, nenhum botão de convites; com convites, o botão mostra quantos', async () => {
    const empty = renderBar();
    await waitFor(() => expect(empty.api.calls.some((c) => c.method === 'listInvites')).toBe(true));
    expect(screen.queryByRole('button', { name: /Convites/ })).not.toBeInTheDocument();
    empty.unmount();

    const api = createFakeApi();
    api.setInvites([{ boardId: 9, boardName: 'Equipe', invitedBy: 'ana_01' }]);
    const { user, onChooseBoard } = renderBar(api);
    await user.click(await screen.findByRole('button', { name: 'Convites (1)' }));
    await user.click(screen.getByRole('button', { name: 'Aceitar o convite para Equipe' }));
    await waitFor(() => expect(onChooseBoard).toHaveBeenCalledWith(9));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Contas" só aparece para o admin; "Minha conta" aparece para todos', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Contas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minha conta' })).toBeInTheDocument();
  });

  it('quem não é admin não vê "Contas"', () => {
    const api = createFakeApi();
    renderWithProviders(
      <SessionBar user={{ ...FAKE_USER, role: 'user' }} boards={[PERSONAL_BOARD]} boardId={1} onChooseBoard={vi.fn()} />,
      { api, boardId: null },
    );
    expect(screen.queryByRole('button', { name: 'Contas' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minha conta' })).toBeInTheDocument();
  });

  it('"Minha conta" e "Contas" abrem os modais', async () => {
    const { user } = renderBar();
    await user.click(screen.getByRole('button', { name: 'Minha conta' }));
    expect(screen.getByRole('dialog', { name: 'Minha conta' })).toBeInTheDocument();
    // O modal tem dois "Fechar" (o X do cabeçalho e o do rodapé): qualquer um fecha.
    await user.click(screen.getAllByRole('button', { name: 'Fechar' })[0] as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Minha conta' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Contas' }));
    expect(screen.getByRole('dialog', { name: 'Contas' })).toBeInTheDocument();
  });
});
