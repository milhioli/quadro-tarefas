import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { LOGGED_OUT, ME_KEY } from '../../api/queries';
import { FAKE_ME, FAKE_USER, createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { DeleteAccountDialog } from './DeleteAccountDialog';

const ANA = { ...FAKE_USER, id: 7, handle: 'ana_07', displayName: 'Ana', role: 'user' as const };

function renderDialog(options: { ownedGroups?: string[]; failWith?: ApiError } = {}) {
  const api = createFakeApi();
  api.setMe({ ...FAKE_ME, user: ANA });
  if (options.failWith) api.failNext('deleteAccount', options.failWith);
  const onCancel = vi.fn();
  const onDeleted = vi.fn();
  const result = renderWithProviders(
    <DeleteAccountDialog user={ANA} ownedGroups={options.ownedGroups ?? []} onCancel={onCancel} onDeleted={onDeleted} />,
    { api, boardId: null },
  );
  return { ...result, api, onCancel, onDeleted };
}

const input = () => screen.getByRole('textbox', { name: /Para confirmar, digite seu nome de usuário/ });
const deleteButton = () => screen.getByRole('button', { name: 'Apagar minha conta' });

describe('DeleteAccountDialog', () => {
  it('é um alertdialog que explica o que acontece, com o foco no campo', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog', { name: 'Apagar sua conta?' });
    expect(dialog).toHaveTextContent('Cada grupo que você criou passa para a pessoa que participa dele há mais tempo');
    expect(dialog).toHaveTextContent('continuam lá, sem o seu nome');
    expect(dialog).toHaveTextContent('Isto não pode ser desfeito.');
    expect(input()).toHaveFocus();
  });

  it('lista os grupos que a pessoa criou', () => {
    renderDialog({ ownedGroups: ['Equipe', 'Família'] });
    expect(screen.getByText('Equipe, Família')).toBeInTheDocument();
  });

  it('o botão só libera com o nome de usuário certo; apagar zera o cache e avisa', async () => {
    const { user, api, queryClient, onDeleted } = renderDialog();
    expect(deleteButton()).toBeDisabled();
    await user.type(input(), 'ana_7');
    expect(deleteButton()).toBeDisabled();
    await user.clear(input());
    await user.type(input(), ' ANA_07 ');
    expect(deleteButton()).toBeEnabled();
    await user.click(deleteButton());
    await waitFor(() => expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT));
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(api.calls.filter((c) => c.method === 'deleteAccount')).toHaveLength(1);
  });

  it('Enter no campo também apaga, mas só com o nome certo', async () => {
    const { user, api } = renderDialog();
    await user.type(input(), 'errado{Enter}');
    expect(api.calls.some((c) => c.method === 'deleteAccount')).toBe(false);
    await user.clear(input());
    await user.type(input(), 'ana_07{Enter}');
    await waitFor(() => expect(api.calls.some((c) => c.method === 'deleteAccount')).toBe(true));
  });

  it('sessão antiga: pede para entrar de novo, com o link do login', async () => {
    const { user, onDeleted } = renderDialog({
      failWith: new ApiError(403, 'REAUTH_REQUIRED', 'Por segurança, entre de novo para apagar a conta.'),
    });
    await user.type(input(), 'ana_07');
    await user.click(deleteButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Por segurança, entre de novo para apagar a conta.');
    expect(screen.getByRole('link', { name: 'Entrar de novo' })).toHaveAttribute('href', '/api/auth/google/start');
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('outro erro aparece com a mensagem do servidor', async () => {
    const { user } = renderDialog({ failWith: new ApiError(429, 'RATE_LIMITED', 'Muitas ações em pouco tempo.') });
    await user.type(input(), 'ana_07');
    await user.click(deleteButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível apagar a conta. Muitas ações em pouco tempo.');
  });

  it('Cancelar e Escape fecham sem apagar', async () => {
    const { user, onCancel, api } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(api.calls.some((c) => c.method === 'deleteAccount')).toBe(false);
  });
});
