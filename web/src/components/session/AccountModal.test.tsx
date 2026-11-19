import type { BoardSummary, MeUser } from '@quadro/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_USER, PERSONAL_BOARD, createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { AccountModal } from './AccountModal';

const ANA: MeUser = { ...FAKE_USER, id: 7, handle: 'ana_07', displayName: 'Ana', role: 'user' };
const BOARDS: BoardSummary[] = [
  PERSONAL_BOARD,
  { id: 9, name: 'Equipe', kind: 'group', role: 'owner' },
  { id: 10, name: 'Da Bia', kind: 'group', role: 'editor' },
];

function renderModal(user: MeUser = ANA) {
  const onClose = vi.fn();
  const onAccountDeleted = vi.fn();
  const result = renderWithProviders(
    <AccountModal user={user} boards={BOARDS} onClose={onClose} onAccountDeleted={onAccountDeleted} />,
    { api: createFakeApi(), boardId: null },
  );
  return { ...result, onClose, onAccountDeleted };
}

describe('AccountModal', () => {
  it('mostra quem está logado (handle em <bdi>) e o link da privacidade', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Minha conta' });
    const handle = screen.getByText('ana_07');
    expect(handle.tagName).toBe('BDI');
    expect(dialog).toHaveTextContent('Você entrou como Ana ana_07.');
    expect(screen.getByRole('link', { name: 'página de privacidade' })).toHaveAttribute('href', '/privacidade');
  });

  it('"Apagar minha conta" abre a confirmação, que lista só os grupos de que a pessoa é dona', async () => {
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Apagar minha conta' }));
    expect(screen.getByRole('alertdialog', { name: 'Apagar sua conta?' })).toBeInTheDocument();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.queryByText(/Da Bia/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('dialog', { name: 'Minha conta' })).toBeInTheDocument();
  });

  it('o admin não tem o botão de apagar, só a explicação', () => {
    renderModal(FAKE_USER);
    expect(screen.queryByRole('button', { name: 'Apagar minha conta' })).not.toBeInTheDocument();
    expect(screen.getByText(/A conta de administrador não pode ser apagada pelo app/)).toBeInTheDocument();
  });

  it('os dois "Fechar" (o X do cabeçalho e o do rodapé) avisam quem abriu', async () => {
    const { user, onClose } = renderModal();
    const closeButtons = screen.getAllByRole('button', { name: 'Fechar' });
    expect(closeButtons).toHaveLength(2);
    for (const button of closeButtons) await user.click(button);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
