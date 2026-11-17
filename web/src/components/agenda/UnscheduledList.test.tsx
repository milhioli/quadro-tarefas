import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeTask } from '../../test/fakeApi';
import { UnscheduledList } from './UnscheduledList';

describe('UnscheduledList', () => {
  it('lista as tarefas sem horário com a contagem', () => {
    render(<UnscheduledList tasks={[makeTask({ id: 1, title: 'Pão' }), makeTask({ id: 2, title: 'Banco' })]} onOpenTask={() => {}} />);
    const section = screen.getByRole('region', { name: 'Sem horário (2)' });
    expect(within(section).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pão', 'Banco']);
  });

  it('vazio', () => {
    render(<UnscheduledList tasks={[]} onOpenTask={() => {}} />);
    expect(screen.getByRole('region', { name: 'Sem horário (0)' })).toHaveTextContent('Todas as tarefas têm horário.');
  });

  it('tocar abre a tarefa', async () => {
    const onOpenTask = vi.fn();
    render(<UnscheduledList tasks={[makeTask({ id: 5, title: 'Pão' })]} onOpenTask={onOpenTask} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pão' }));
    expect(onOpenTask).toHaveBeenCalledWith(5);
  });
});
