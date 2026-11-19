import type { BoardSummary } from '@quadro/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Shell, type ShellProps } from './Shell';
import { ApiError } from './api/client';
import { LOGGED_OUT, tasksKey } from './api/queries';
import { BOARD_STORAGE_KEY } from './lib/boardChoice';
import { fixedClock } from './lib/clock';
import { PERSONAL_BOARD, createFakeApi, makeTask, type FakeApi } from './test/fakeApi';
import { renderWithProviders } from './test/render';

// Sexta-feira, 13/11/2026, meio-dia local.
const clock = fixedClock(new Date(2026, 10, 13, 12));
const GROUP: BoardSummary = { id: 9, name: 'Equipe', kind: 'group', role: 'owner' };

function withBoards(boards: BoardSummary[] = [PERSONAL_BOARD, GROUP]) {
  const api = createFakeApi([
    makeTask({ id: 1, title: 'Tarefa pessoal' }),
    makeTask({ id: 2, title: 'Tarefa do grupo', boardId: 9 }),
  ]);
  api.setBoards(boards);
  return api;
}

function renderShell(api: FakeApi = withBoards(), props: Partial<ShellProps> = {}) {
  return renderWithProviders(<Shell clock={clock} {...props} />, { api, boardId: null });
}

const boardSelect = () => screen.getByRole('combobox', { name: 'Quadro' });
const lastListTasks = (api: FakeApi) => api.calls.filter((c) => c.method === 'listTasks').at(-1)?.args;

describe('Shell: qual tela', () => {
  it('sem sessão, mostra o login', async () => {
    const api = createFakeApi();
    api.setMe(LOGGED_OUT);
    renderShell(api);
    expect(await screen.findByRole('link', { name: 'Entrar com Google' })).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'listBoards')).toBe(false);
  });

  it('mostra o aviso do login que não deu certo', async () => {
    const api = createFakeApi();
    api.setMe(LOGGED_OUT);
    renderShell(api, { loginOutcome: 'cancelado' });
    expect(await screen.findByRole('alert')).toHaveTextContent('O login foi cancelado.');
  });

  it('sessão sem perfil: primeiro acesso, com a sugestão de nome', async () => {
    const api = createFakeApi();
    api.setMe({ user: null, pendingProfile: { suggestedName: 'Ana' } });
    renderShell(api);
    expect(await screen.findByRole('textbox', { name: 'Nome de exibição' })).toHaveValue('Ana');
  });

  it('erro ao falar com o servidor mostra Tentar novamente', async () => {
    const api = createFakeApi();
    api.failNext('getMe', new ApiError(0, 'NETWORK', 'Sem rede'));
    const { user } = renderShell(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('combobox', { name: 'Quadro' })).toBeInTheDocument();
  });
});

describe('Shell: logado', () => {
  it('mostra quem está logado (handle isolado em <bdi>) e abre o quadro pessoal', async () => {
    const api = withBoards();
    renderShell(api);
    expect(await screen.findByRole('button', { name: /Tarefa pessoal/ })).toBeInTheDocument();
    expect(screen.getByText('admin_00').tagName).toBe('BDI');
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(boardSelect()).toHaveValue('1');
    expect(lastListTasks(api)).toEqual([1]);
    expect(screen.queryByText('Tarefa do grupo')).not.toBeInTheDocument();
  });

  it('trocar de quadro abre as tarefas dele e lembra só o id', async () => {
    const api = withBoards();
    const { user } = renderShell(api);
    await screen.findByRole('button', { name: /Tarefa pessoal/ });
    await user.selectOptions(boardSelect(), 'Equipe');
    expect(await screen.findByRole('button', { name: /Tarefa do grupo/ })).toBeInTheDocument();
    expect(screen.queryByText('Tarefa pessoal')).not.toBeInTheDocument();
    expect(lastListTasks(api)).toEqual([9]);
    expect(window.localStorage.getItem(BOARD_STORAGE_KEY)).toBe('9');
  });

  it('o quadro lembrado só vale se a pessoa ainda o vê', async () => {
    window.localStorage.setItem(BOARD_STORAGE_KEY, '9');
    const first = renderShell(withBoards());
    expect(await screen.findByRole('button', { name: /Tarefa do grupo/ })).toBeInTheDocument();
    first.unmount();

    window.localStorage.setItem(BOARD_STORAGE_KEY, '77');
    renderShell(withBoards());
    expect(await screen.findByRole('button', { name: /Tarefa pessoal/ })).toBeInTheDocument();
  });

  it('Sair volta para o login, zera o cache e esquece o quadro', async () => {
    window.localStorage.setItem(BOARD_STORAGE_KEY, '9');
    const { user, queryClient } = renderShell();
    await screen.findByRole('button', { name: /Tarefa do grupo/ });
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('link', { name: 'Entrar com Google' })).toBeInTheDocument();
    expect(queryClient.getQueryData(tasksKey(9))).toBeUndefined();
    expect(window.localStorage.getItem(BOARD_STORAGE_KEY)).toBeNull();
  });

  it('um 401 no meio do uso volta para o login', async () => {
    const api = withBoards();
    api.failNext('listTasks', new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar'));
    renderShell(api);
    expect(await screen.findByRole('link', { name: 'Entrar com Google' })).toBeInTheDocument();
  });

  it('a troca de conta não mostra nada da conta anterior', async () => {
    const api = withBoards();
    api.setMethods({ google: false, dev: true });
    const { user } = renderShell(api);
    await screen.findByRole('button', { name: /Tarefa pessoal/ });

    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await user.type(await screen.findByRole('textbox', { name: 'E-mail de teste' }), 'bia@example.com');
    await user.click(screen.getByRole('button', { name: 'Entrar (teste)' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nome de usuário' }), 'bia');
    await user.click(screen.getByRole('button', { name: 'Começar' }));

    expect(await screen.findByText('bia_01')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Tarefas (0)' })).toBeInTheDocument());
    expect(screen.queryByText('Tarefa pessoal')).not.toBeInTheDocument();
    expect(screen.queryByText('admin_00')).not.toBeInTheDocument();
    expect(lastListTasks(api)).toEqual([100]);
  });
});

describe('Shell: grupos e convites', () => {
  it('criar um grupo abre o quadro novo', async () => {
    const api = withBoards([PERSONAL_BOARD]);
    const { user } = renderShell(api);
    await screen.findByRole('button', { name: /Tarefa pessoal/ });
    await user.click(screen.getByRole('button', { name: 'Novo grupo' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome do grupo' }), 'Família');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    await waitFor(() => expect(boardSelect()).toHaveValue('100'));
    expect(within(boardSelect()).getByRole('option', { name: 'Família' })).toBeInTheDocument();
    await waitFor(() => expect(lastListTasks(api)).toEqual([100]));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('aceitar um convite abre o quadro do grupo', async () => {
    const api = withBoards([PERSONAL_BOARD]);
    api.setInvites([{ boardId: 9, boardName: 'Equipe', invitedBy: 'ana_01' }]);
    const { user } = renderShell(api);
    await user.click(await screen.findByRole('button', { name: 'Convites (1)' }));
    const dialog = screen.getByRole('dialog', { name: 'Convites' });
    expect(within(dialog).getByText('ana_01').tagName).toBe('BDI');
    await user.click(within(dialog).getByRole('button', { name: 'Aceitar o convite para Equipe' }));
    expect(await screen.findByRole('button', { name: /Tarefa do grupo/ })).toBeInTheDocument();
    expect(boardSelect()).toHaveValue('9');
    expect(screen.queryByRole('button', { name: /Convites/ })).not.toBeInTheDocument();
  });

  it('apagar o grupo volta para o quadro pessoal', async () => {
    window.localStorage.setItem(BOARD_STORAGE_KEY, '9');
    const api = withBoards();
    api.setMembers(9, [{ userId: 1, handle: 'admin_00', displayName: 'Admin', role: 'owner', status: 'active' }]);
    const { user } = renderShell(api);
    await screen.findByRole('button', { name: /Tarefa do grupo/ });
    await user.click(screen.getByRole('button', { name: 'Pessoas do grupo' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Grupo: Equipe' })).getByRole('button', { name: 'Apagar grupo' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Apagar o grupo?' })).getByRole('button', { name: 'Apagar grupo' }));
    expect(await screen.findByRole('button', { name: /Tarefa pessoal/ })).toBeInTheDocument();
    expect(boardSelect()).toHaveValue('1');
    expect(within(boardSelect()).queryByRole('option', { name: 'Equipe' })).not.toBeInTheDocument();
  });
});

describe('Shell: apagar a conta', () => {
  it('depois de apagar, volta ao login com o aviso e esquece o quadro escolhido', async () => {
    const api = withBoards();
    api.setMe({ user: { id: 7, handle: 'ana_07', displayName: 'Ana', role: 'user', personalBoardId: 1 }, pendingProfile: null });
    window.localStorage.setItem(BOARD_STORAGE_KEY, '9');
    const { user } = renderShell(api);
    await user.click(await screen.findByRole('button', { name: 'Minha conta' }));
    await user.click(screen.getByRole('button', { name: 'Apagar minha conta' }));
    await user.type(screen.getByRole('textbox', { name: /Para confirmar/ }), 'ana_07');
    await user.click(screen.getByRole('button', { name: 'Apagar minha conta' }));

    expect(await screen.findByText('Sua conta foi apagada.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Entrar com Google' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(BOARD_STORAGE_KEY)).toBeNull();
  });

  it('o app logado tem o rodapé com a privacidade', async () => {
    renderShell();
    expect(await screen.findByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', '/privacidade');
  });
});
