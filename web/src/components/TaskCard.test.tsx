import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TestDndContext } from '../test/dnd';
import { makeTask } from '../test/fakeApi';
import { TaskCard, TaskCardView } from './TaskCard';

const checklist = {
  type: 'doc' as const,
  content: [
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] },
      ],
    },
  ],
};

function renderCard(task = makeTask({ id: 1, title: 'Comprar pão', color: 'verde' })) {
  const onOpen = vi.fn();
  render(
    <TestDndContext>
      <TaskCard task={task} onOpen={onOpen} />
    </TestDndContext>,
  );
  return { onOpen, user: userEvent.setup() };
}

describe('TaskCard', () => {
  it('é um botão arrastável com o título e a cor', () => {
    renderCard();
    const card = screen.getByRole('button', { name: /Comprar pão/ });
    expect(card).toHaveAttribute('aria-roledescription', 'tarefa arrastável');
    expect(card.querySelector('.task-card')).toHaveClass('task-card--verde');
  });

  it('clique, Enter e Espaço abrem a tarefa', async () => {
    const { onOpen, user } = renderCard();
    const card = screen.getByRole('button', { name: /Comprar pão/ });
    await user.click(card);
    card.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('renderiza o título como texto, nunca como HTML', () => {
    const { container } = render(
      <TaskCardView task={makeTask({ id: 2, title: '<img src=x onerror=alert(1)>' })} />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('mostra o progresso do checklist', () => {
    render(<TaskCardView task={makeTask({ id: 3, content: checklist })} />);
    expect(screen.getByText('☑ 2/3')).toBeInTheDocument();
    expect(screen.getByText('Checklist: 2 de 3 concluídos')).toBeInTheDocument();
  });

  it('sem checklist não mostra progresso', () => {
    render(<TaskCardView task={makeTask({ id: 4 })} />);
    expect(screen.queryByText(/Checklist/)).not.toBeInTheDocument();
  });

  it('variações compacta e de arraste', () => {
    const { container } = render(<TaskCardView task={makeTask({ id: 5 })} compact overlay />);
    expect(container.firstChild).toHaveClass('task-card--compact', 'task-card--overlay');
  });

  it('no deck não tem borda de redimensionar nem altura de faixa', () => {
    renderCard();
    const card = screen.getByRole('button', { name: /Comprar pão/ });
    expect(card.querySelector('.task-card__resize')).toBeNull();
    expect(card.style.getPropertyValue('--span')).toBe('');
  });
});

describe('TaskCard no quadro (duração)', () => {
  const ROW = 40;

  function renderOnBoard(task = makeTask({ id: 1, title: 'Estudo', day: 0, slot: 0, span: 1 }), maxSpan = 4) {
    const onOpen = vi.fn();
    const onResize = vi.fn();
    render(
      <TestDndContext>
        <table>
          <tbody>
            <tr>
              <td data-testid="cell">
                <TaskCard task={task} onOpen={onOpen} compact resize={{ maxSpan, onResize }} />
              </td>
            </tr>
          </tbody>
        </table>
      </TestDndContext>,
    );
    // jsdom não faz layout: a célula passa a medir uma linha do quadro.
    vi.spyOn(screen.getByTestId('cell'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, ROW));
    const card = screen.getByRole('button', { name: new RegExp(task.title) });
    const handle = card.querySelector('.task-card__resize') as HTMLElement;
    return { onOpen, onResize, card, handle };
  }

  it('a altura do cartão segue o span', () => {
    const { card } = renderOnBoard(makeTask({ id: 1, title: 'Plantão', day: 0, slot: 0, span: 30 }), 34);
    expect(card.style.getPropertyValue('--span')).toBe('30');
    expect(card).toHaveClass('task-card-handle--tall');
  });

  it('puxar a borda muda a duração de 30 em 30 min, até o limite, sem abrir o modal', () => {
    const { onOpen, onResize, card, handle } = renderOnBoard();
    expect(handle).toHaveAttribute('aria-hidden', 'true');

    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 100 + 2 * ROW, pointerId: 1 });
    expect(card.style.getPropertyValue('--span')).toBe('3');
    fireEvent.pointerMove(handle, { clientY: 2000, pointerId: 1 });
    expect(card.style.getPropertyValue('--span')).toBe('4');

    fireEvent.pointerUp(handle, { clientY: 2000, pointerId: 1 });
    fireEvent.click(handle);
    expect(onResize).toHaveBeenCalledExactlyOnceWith(1, 4);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('soltar no mesmo tamanho ou cancelar não muda nada', () => {
    const { onResize, card, handle } = renderOnBoard();
    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 110, pointerId: 1 });
    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
    expect(card.style.getPropertyValue('--span')).toBe('1');
  });

  it('botão que não é o principal não começa o redimensionar', () => {
    const { onResize, handle } = renderOnBoard();
    fireEvent.pointerDown(handle, { clientY: 100, button: 2, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 300, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });
});
