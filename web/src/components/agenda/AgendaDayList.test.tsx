import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeTask } from '../../test/fakeApi';
import { AgendaDayList } from './AgendaDayList';

const tasks = [
  makeTask({ id: 1, title: 'Jantar', day: 1, slot: 28 }),
  makeTask({ id: 2, title: 'Academia', day: 1, slot: 4 }),
  makeTask({ id: 3, title: 'Outro dia', day: 2, slot: 0 }),
  makeTask({ id: 4, title: 'Sem horário' }),
];

describe('AgendaDayList', () => {
  it('lista só as tarefas do dia, em ordem de horário', () => {
    render(<AgendaDayList tasks={tasks} day={1} onOpenTask={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '07:00 – 07:30 Academia',
      '19:00 – 19:30 Jantar',
    ]);
  });

  it('dia vazio mostra aviso', () => {
    render(<AgendaDayList tasks={tasks} day={0} onOpenTask={() => {}} />);
    expect(screen.getByText('Nada agendado neste dia.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('tocar abre a tarefa', async () => {
    const onOpenTask = vi.fn();
    render(<AgendaDayList tasks={tasks} day={2} onOpenTask={onOpenTask} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Outro dia/ }));
    expect(onOpenTask).toHaveBeenCalledWith(3);
  });
});
