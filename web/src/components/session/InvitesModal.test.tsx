import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { InvitesModal } from './InvitesModal';

function renderInvites(invites = [
  { boardId: 9, boardName: 'Equipe', invitedBy: 'ana_01' },
  { boardId: 10, boardName: 'Antigo', invitedBy: null },
]) {
  const api = createFakeApi();
  api.setInvites(invites);
  const onClose = vi.fn();
  const onAccepted = vi.fn();
  const result = renderWithProviders(<InvitesModal onClose={onClose} onAccepted={onAccepted} />, { api, boardId: null });
  return { ...result, onClose, onAccepted };
}

const dialog = () => screen.getByRole('dialog', { name: 'Convites' });

describe('InvitesModal', () => {
  it('mostra só o nome do quadro e quem convidou (handle em <bdi>)', async () => {
    renderInvites();
    const items = await within(dialog()).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Equipe convite de ana_01AceitarRecusar', 'AntigoAceitarRecusar']);
    expect(within(dialog()).getByText('ana_01').tagName).toBe('BDI');
  });

  it('aceitar devolve o quadro do grupo', async () => {
    const { user, onAccepted } = renderInvites();
    await user.click(await within(dialog()).findByRole('button', { name: 'Aceitar o convite para Equipe' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
    expect(onAccepted.mock.calls[0]?.[0]).toEqual({ id: 9, name: 'Equipe', kind: 'group', role: 'editor' });
  });

  it('recusar tira o convite da lista', async () => {
    const { user, onAccepted } = renderInvites();
    await user.click(await within(dialog()).findByRole('button', { name: 'Recusar o convite para Antigo' }));
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(1));
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('sem convites, diz que não há nenhum', async () => {
    renderInvites([]);
    expect(await within(dialog()).findByText('Nenhum convite pendente.')).toBeInTheDocument();
  });

  it('erro ao aceitar aparece como alerta', async () => {
    const { api, user, onAccepted } = renderInvites();
    api.failNext('acceptInvite', new ApiError(404, 'NOT_FOUND', 'Convite não encontrado'));
    await user.click(await within(dialog()).findByRole('button', { name: 'Aceitar o convite para Equipe' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Não foi possível aceitar o convite. Convite não encontrado');
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
