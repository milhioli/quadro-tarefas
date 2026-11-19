import type { AdminUser } from '@quadro/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { FAKE_ADMIN_ACCOUNT, FAKE_USER, createFakeApi, type FakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { AccountsModal } from './AccountsModal';

const BIA: AdminUser = { id: 4, handle: 'bia_02', email: 'bia@example.com', status: 'active', lastSeenAt: '2026-11-19T12:00:00.000Z' };
const PENDING: AdminUser = { id: 5, handle: null, email: 'novo@example.com', status: 'active', lastSeenAt: '2026-11-19T12:00:00.000Z' };

function renderModal(api: FakeApi = createFakeApi()) {
  const onClose = vi.fn();
  const result = renderWithProviders(<AccountsModal user={FAKE_USER} onClose={onClose} />, { api, boardId: null });
  return { ...result, api, onClose };
}

const list = () => screen.getByRole('list', { name: 'Contas' });

describe('AccountsModal', () => {
  it('lista handle (em <bdi>), e-mail, situação e último acesso; a própria linha não tem botões', async () => {
    const api = createFakeApi();
    api.setAccounts([FAKE_ADMIN_ACCOUNT, BIA, PENDING]);
    renderModal(api);
    await screen.findByText('bia_02');
    expect(screen.getByText('bia_02').tagName).toBe('BDI');
    expect(screen.getByText('bia@example.com')).toBeInTheDocument();
    expect(screen.getByText('(sem perfil)')).toBeInTheDocument();
    const rows = within(list()).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Você')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(/Ativa · último acesso 19\/11\/2026/);
  });

  it('desativar pede confirmação; depois, a linha mostra "Desativada", "Reativar" e "Apagar"', async () => {
    const api = createFakeApi();
    api.setAccounts([FAKE_ADMIN_ACCOUNT, BIA]);
    const { user } = renderModal(api);
    await user.click(await screen.findByRole('button', { name: 'Desativar bia_02' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Desativar bia_02?' });
    expect(confirm).toHaveTextContent('sai na hora de todas as sessões');
    await user.click(within(confirm).getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByRole('button', { name: 'Reativar bia_02' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apagar bia_02' })).toBeInTheDocument();
    expect(within(list()).getAllByRole('listitem')[1]).toHaveTextContent('Desativada');
    expect(api.calls.find((c) => c.method === 'setAccountStatus')?.args).toEqual([4, 'disabled']);
    expect(screen.getByRole('status')).toHaveTextContent('bia_02 foi desativada.');
  });

  it('reativar não pede confirmação; apagar a conta desativada pede, e tira a linha', async () => {
    const api = createFakeApi();
    api.setAccounts([FAKE_ADMIN_ACCOUNT, { ...BIA, status: 'disabled' }]);
    const { user } = renderModal(api);
    await user.click(await screen.findByRole('button', { name: 'Apagar bia_02' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Apagar bia_02?' })).getByRole('button', { name: 'Apagar conta' }));
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
    expect(api.calls.find((c) => c.method === 'deleteDisabledAccount')?.args).toEqual([4]);
  });

  it('reativar muda a linha na hora', async () => {
    const api = createFakeApi();
    api.setAccounts([FAKE_ADMIN_ACCOUNT, { ...BIA, status: 'disabled' }]);
    const { user } = renderModal(api);
    await user.click(await screen.findByRole('button', { name: 'Reativar bia_02' }));
    expect(await screen.findByRole('button', { name: 'Desativar bia_02' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'setAccountStatus')?.args).toEqual([4, 'active']);
  });

  it('erro do servidor aparece como alerta (ex.: quem não é admin recebe 404)', async () => {
    const api = createFakeApi();
    api.failNext('listAccounts', new ApiError(404, 'NOT_FOUND', 'Rota não encontrada'));
    renderModal(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as contas');
  });
});
