import { render, screen } from '@testing-library/react';
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
});
