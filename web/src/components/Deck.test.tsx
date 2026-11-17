import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TestDndContext } from '../test/dnd';
import { makeTask } from '../test/fakeApi';
import { Deck } from './Deck';

describe('Deck', () => {
  it('mostra o título com a contagem e as tarefas na ordem recebida', () => {
    render(
      <TestDndContext>
        <Deck tasks={[makeTask({ id: 2, title: 'B' }), makeTask({ id: 1, title: 'A' })]} onOpenTask={() => {}} />
      </TestDndContext>,
    );
    const deck = screen.getByRole('region', { name: 'Tarefas (2)' });
    const items = within(deck).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['B', 'A']);
  });

  it('estado vazio em pt-BR', () => {
    render(
      <TestDndContext>
        <Deck tasks={[]} onOpenTask={() => {}} />
      </TestDndContext>,
    );
    expect(screen.getByRole('region', { name: 'Tarefas (0)' })).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma tarefa no deck/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('clicar numa tarefa abre o modal dela', async () => {
    const onOpenTask = vi.fn();
    render(
      <TestDndContext>
        <Deck tasks={[makeTask({ id: 7, title: 'Ler' })]} onOpenTask={onOpenTask} />
      </TestDndContext>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Ler/ }));
    expect(onOpenTask).toHaveBeenCalledWith(7);
  });
});
