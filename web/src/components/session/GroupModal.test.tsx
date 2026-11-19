import type { BoardSummary, Member } from '@quadro/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { FAKE_USER, PERSONAL_BOARD, createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { GroupModal } from './GroupModal';

const OWNED: BoardSummary = { id: 9, name: 'Equipe', kind: 'group', role: 'owner' };
const JOINED: BoardSummary = { ...OWNED, role: 'editor' };
const ME_AS_OWNER: Member = { userId: FAKE_USER.id, handle: 'admin_00', displayName: 'Admin', role: 'owner', status: 'active' };
const BIA: Member = { userId: 4, handle: 'bia_02', displayName: 'Bia', role: 'editor', status: 'active' };
const CARLA: Member = { userId: 5, handle: 'carla_03', displayName: 'Carla', role: 'editor', status: 'invited' };

function renderGroup(board: BoardSummary = OWNED, members: Member[] = [ME_AS_OWNER, BIA, CARLA]) {
  const api = createFakeApi();
  api.setBoards([PERSONAL_BOARD, board]);
  api.setMembers(9, members);
  const onClose = vi.fn();
  const onLeft = vi.fn();
  const result = renderWithProviders(<GroupModal board={board} user={FAKE_USER} onClose={onClose} onLeft={onLeft} />, {
    api,
    boardId: null,
  });
  return { ...result, onClose, onLeft };
}

const dialog = () => screen.getByRole('dialog', { name: 'Grupo: Equipe' });

describe('GroupModal: dono', () => {
  it('lista as pessoas com nome, handle em <bdi> e situação; nunca e-mail', async () => {
    renderGroup();
    const list = await within(dialog()).findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Admin admin_00Dono',
      'Bia bia_02EditorRemover',
      'Carla carla_03Convite pendenteCancelar convite',
    ]);
    expect(within(list).getByText('bia_02').tagName).toBe('BDI');
    expect(within(list).queryByRole('button', { name: /admin_00/ })).not.toBeInTheDocument();
  });

  it('convidar pelo handle acrescenta o convite pendente', async () => {
    const { api, user } = renderGroup(OWNED, [ME_AS_OWNER]);
    api.addPerson({ userId: 4, handle: 'bia_02', displayName: 'Bia' });
    await user.type(within(dialog()).getByRole('textbox', { name: 'Convidar pelo nome de usuário' }), 'bia_02');
    await user.click(within(dialog()).getByRole('button', { name: 'Convidar' }));
    expect(await within(dialog()).findByText('Convite enviado para bia_02.')).toBeInTheDocument();
    expect(within(dialog()).getByText('Convite pendente')).toBeInTheDocument();
    expect(within(dialog()).getByRole('textbox', { name: 'Convidar pelo nome de usuário' })).toHaveValue('');
  });

  it('handle sem número é recusado antes da API', async () => {
    const { api, user } = renderGroup();
    await user.type(within(dialog()).getByRole('textbox', { name: 'Convidar pelo nome de usuário' }), 'bia');
    await user.click(within(dialog()).getByRole('button', { name: 'Convidar' }));
    expect(within(dialog()).getByText('Use o nome de usuário com o número (ex.: ana_07)')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'inviteMember')).toBe(false);
  });

  it('handle que não existe mostra o 404 genérico do servidor', async () => {
    const { user } = renderGroup();
    await user.type(within(dialog()).getByRole('textbox', { name: 'Convidar pelo nome de usuário' }), 'ninguem_99');
    await user.click(within(dialog()).getByRole('button', { name: 'Convidar' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Não foi possível convidar. Nenhuma conta com esse nome de usuário',
    );
  });

  it('remover alguém e cancelar um convite', async () => {
    const { user } = renderGroup();
    await user.click(await within(dialog()).findByRole('button', { name: 'Remover bia_02' }));
    expect(await within(dialog()).findByText('bia_02 saiu do grupo.')).toBeInTheDocument();
    await user.click(within(dialog()).getByRole('button', { name: 'Cancelar o convite de carla_03' }));
    expect(await within(dialog()).findByText('Convite de carla_03 cancelado.')).toBeInTheDocument();
    expect(within(dialog()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('renomear o grupo', async () => {
    const { user } = renderGroup();
    const name = within(dialog()).getByRole('textbox', { name: 'Nome do grupo' });
    await user.clear(name);
    await user.type(name, 'Time');
    await user.click(within(dialog()).getByRole('button', { name: 'Salvar nome' }));
    expect(await within(dialog()).findByText('O grupo agora se chama Time.')).toBeInTheDocument();
  });

  it('nome vazio não vai para a API', async () => {
    const { api, user } = renderGroup();
    await user.clear(within(dialog()).getByRole('textbox', { name: 'Nome do grupo' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Salvar nome' }));
    expect(within(dialog()).getByText('Informe um nome para o quadro')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'renameBoard')).toBe(false);
  });

  it('apagar pede confirmação e depois avisa quem chamou', async () => {
    const { api, user, onLeft } = renderGroup();
    await user.click(within(dialog()).getByRole('button', { name: 'Apagar grupo' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Apagar o grupo?' });
    expect(api.calls.some((c) => c.method === 'deleteBoard')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Apagar grupo' }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(api.calls.find((c) => c.method === 'deleteBoard')?.args).toEqual([9]);
  });

  it('cancelar a confirmação não apaga nada', async () => {
    const { api, user } = renderGroup();
    await user.click(within(dialog()).getByRole('button', { name: 'Apagar grupo' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'deleteBoard')).toBe(false);
  });
});

describe('GroupModal: editor', () => {
  it('não vê convite, remoção, renomear nem apagar; só sair', async () => {
    const biaOwner: Member = { ...BIA, role: 'owner' };
    const meAsEditor: Member = { ...ME_AS_OWNER, role: 'editor' };
    renderGroup(JOINED, [biaOwner, meAsEditor]);
    await within(dialog()).findByRole('list');
    expect(within(dialog()).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: /Remover|Cancelar o convite/ })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Apagar grupo' })).not.toBeInTheDocument();
    expect(within(dialog()).getByText('Só quem criou o grupo convida e remove pessoas.')).toBeInTheDocument();
  });

  it('sair pede confirmação e avisa quem chamou', async () => {
    const { api, user, onLeft } = renderGroup(JOINED, [BIA]);
    await user.click(within(dialog()).getByRole('button', { name: 'Sair do grupo' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Sair do grupo?' })).getByRole('button', { name: 'Sair do grupo' }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(api.calls.find((c) => c.method === 'removeMember')?.args).toEqual([9, FAKE_USER.id]);
  });

  it('falha ao sair mostra o erro e mantém o modal', async () => {
    const { api, user, onLeft } = renderGroup(JOINED, [BIA]);
    api.failNext('removeMember', new ApiError(500, 'INTERNAL', 'Erro interno. Tente novamente.'));
    await user.click(within(dialog()).getByRole('button', { name: 'Sair do grupo' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sair do grupo' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Não foi possível sair do grupo');
    expect(onLeft).not.toHaveBeenCalled();
  });
});

describe('GroupModal: fechar', () => {
  it('os dois Fechar (o X do cabeçalho e o do rodapé) chamam onClose', async () => {
    const { user, onClose } = renderGroup();
    const buttons = within(dialog()).getAllByRole('button', { name: 'Fechar' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) await user.click(button);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
