import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { NewGroupModal } from './NewGroupModal';

function renderNew() {
  const api = createFakeApi();
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const result = renderWithProviders(<NewGroupModal onClose={onClose} onCreated={onCreated} />, { api, boardId: null });
  return { ...result, onClose, onCreated };
}

describe('NewGroupModal', () => {
  it('cria o grupo e devolve o quadro novo', async () => {
    const { api, user, onCreated } = renderNew();
    expect(screen.getByRole('textbox', { name: 'Nome do grupo' })).toHaveFocus();
    await user.type(screen.getByRole('textbox', { name: 'Nome do grupo' }), '  Família  ');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ name: 'Família', kind: 'group', role: 'owner' });
    expect(api.calls.find((c) => c.method === 'createBoard')?.args).toEqual(['Família']);
  });

  it('nome vazio ou com caractere invisível não vai para a API', async () => {
    const { api, user } = renderNew();
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um nome para o quadro');
    await user.type(screen.getByRole('textbox', { name: 'Nome do grupo' }), 'Equipe‏');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use só caracteres visíveis');
    expect(api.calls.some((c) => c.method === 'createBoard')).toBe(false);
  });

  it('erro do servidor aparece e o modal continua aberto', async () => {
    const { api, user, onCreated } = renderNew();
    api.failNext('createBoard', new ApiError(500, 'INTERNAL', 'Erro interno. Tente novamente.'));
    await user.type(screen.getByRole('textbox', { name: 'Nome do grupo' }), 'Equipe');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível criar o grupo. Erro interno. Tente novamente.');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('Cancelar fecha', async () => {
    const { user, onClose } = renderNew();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
