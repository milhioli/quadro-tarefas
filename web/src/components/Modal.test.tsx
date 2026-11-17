import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal, focusableElements } from './Modal';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {open ? (
        <Modal
          title="Meu diálogo"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<button type="button">Rodapé</button>}
        >
          <button type="button">Primeiro do corpo</button>
        </Modal>
      ) : null}
    </>
  );
}

describe('Modal', () => {
  it('renderiza um diálogo modal nomeado pelo título', () => {
    render(
      <Modal title="Nova tarefa" onClose={() => {}}>
        <p>Conteúdo</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Nova tarefa' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
  });

  it('Escape fecha', () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>c</p>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clique no fundo fecha, clique dentro não', () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>dentro</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText('dentro'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('o botão Fechar fecha', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>c</p>
      </Modal>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('foca o elemento indicado ao abrir', () => {
    function WithInitialFocus() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <Modal title="X" onClose={() => {}} initialFocusRef={ref}>
          <input aria-label="Título" ref={ref} />
        </Modal>
      );
    }
    render(<WithInitialFocus />);
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveFocus();
  });

  it('sem indicação, foca o primeiro focável e devolve o foco ao fechar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('prende o foco com Tab e Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const first = screen.getByRole('button', { name: 'Fechar' });
    const last = screen.getByRole('button', { name: 'Rodapé' });

    last.focus();
    await user.tab();
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('focusableElements ignora desabilitados e escondidos', () => {
    const container = document.createElement('div');
    const ok = document.createElement('button');
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const hidden = document.createElement('button');
    hidden.setAttribute('aria-hidden', 'true');
    container.append(ok, disabled, hidden);
    expect(focusableElements(container)).toEqual([ok]);
  });
});
