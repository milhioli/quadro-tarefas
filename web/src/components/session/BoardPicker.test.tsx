import type { BoardSummary } from '@quadro/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_USER, PERSONAL_BOARD, createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { BoardPicker, boardLabel } from './BoardPicker';

const GROUP: BoardSummary = { id: 9, name: 'Equipe', kind: 'group', role: 'owner' };

function renderPicker(boardId = 1, boards: BoardSummary[] = [PERSONAL_BOARD, GROUP]) {
  const api = createFakeApi();
  api.setBoards(boards);
  api.setMembers(9, []);
  const onChoose = vi.fn();
  const result = renderWithProviders(<BoardPicker user={FAKE_USER} boards={boards} boardId={boardId} onChoose={onChoose} />, {
    api,
    boardId: null,
  });
  return { ...result, onChoose };
}

const select = () => screen.getByRole('combobox', { name: 'Quadro' });

describe('boardLabel', () => {
  it('o pessoal é sempre "Meu quadro"; o grupo usa o nome dele', () => {
    expect(boardLabel({ ...PERSONAL_BOARD, name: 'qualquer' })).toBe('Meu quadro');
    expect(boardLabel(GROUP)).toBe('Equipe');
  });
});

describe('BoardPicker', () => {
  it('lista os quadros e avisa a escolha', async () => {
    const { user, onChoose } = renderPicker();
    expect(within(select()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Meu quadro', 'Equipe']);
    expect(select()).toHaveValue('1');
    await user.selectOptions(select(), 'Equipe');
    expect(onChoose).toHaveBeenCalledWith(9);
  });

  it('"Pessoas do grupo" só aparece num grupo', () => {
    renderPicker(1);
    expect(screen.queryByRole('button', { name: 'Pessoas do grupo' })).not.toBeInTheDocument();
  });

  it('num grupo, "Pessoas do grupo" abre o modal do grupo', async () => {
    const { user } = renderPicker(9);
    await user.click(screen.getByRole('button', { name: 'Pessoas do grupo' }));
    expect(screen.getByRole('dialog', { name: 'Grupo: Equipe' })).toBeInTheDocument();
  });

  it('criar um grupo fecha o modal e escolhe o quadro novo', async () => {
    const { user, onChoose } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'Novo grupo' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome do grupo' }), 'Família');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith(100));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sair do grupo volta para o quadro pessoal', async () => {
    const { user, onChoose } = renderPicker(9, [PERSONAL_BOARD, { ...GROUP, role: 'editor' }]);
    await user.click(screen.getByRole('button', { name: 'Pessoas do grupo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sair do grupo' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sair do grupo' }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith(FAKE_USER.personalBoardId));
  });
});
