import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Resetar o quadro?"
      message="Todas as tarefas voltam para o deck."
      confirmLabel="Resetar"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel, user: userEvent.setup() };
}

describe('ConfirmDialog', () => {
  it('é um alertdialog com título e descrição', () => {
    setup();
    const dialog = screen.getByRole('alertdialog', { name: 'Resetar o quadro?' });
    expect(dialog).toHaveAccessibleDescription('Todas as tarefas voltam para o deck.');
  });

  it('começa com o foco em Cancelar', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('confirmar e cancelar chamam os callbacks', async () => {
    const { onConfirm, onCancel, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Resetar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape cancela', async () => {
    const { onCancel, onConfirm, user } = setup();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('aceita rótulos próprios e desabilita a confirmação quando ocupado', () => {
    setup({ cancelLabel: 'Continuar editando', confirmLabel: 'Descartar', busy: true, danger: true });
    expect(screen.getByRole('button', { name: 'Continuar editando' })).toBeEnabled();
    const confirm = screen.getByRole('button', { name: 'Descartar' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass('button--danger');
  });
});
