import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { boardColumns } from '../../lib/board';
import { parseIsoDate } from '../../lib/calendar';
import { makeTask } from '../../test/fakeApi';
import { AgendaDayGrid } from './AgendaDayGrid';

const columns = boardColumns(parseIsoDate('2026-11-17') as Date);
const tuesday = columns[1] as (typeof columns)[number];

function renderGrid(tasks = [makeTask({ id: 1, title: 'Academia', day: 1, slot: 4 })]) {
  const onOpenTask = vi.fn();
  const onCreateAt = vi.fn();
  render(<AgendaDayGrid tasks={tasks} column={tuesday} onOpenTask={onOpenTask} onCreateAt={onCreateAt} />);
  return { onOpenTask, onCreateAt, user: userEvent.setup() };
}

describe('AgendaDayGrid', () => {
  it('mostra as 34 faixas: as livres como "+ livre" e as ocupadas com a tarefa', () => {
    renderGrid();
    expect(screen.getAllByRole('listitem')).toHaveLength(34);
    expect(screen.getAllByRole('button', { name: /^Agendar em Terça 17\/11/ })).toHaveLength(33);
    expect(screen.getByRole('button', { name: '07:00 – 07:30 Academia' })).toBeInTheDocument();
    expect(screen.getAllByText('+ livre')).toHaveLength(33);
  });

  it('tocar numa faixa livre pede para criar naquele dia e horário', async () => {
    const { onCreateAt, user } = renderGrid();
    await user.click(screen.getByRole('button', { name: 'Agendar em Terça 17/11, 05:30 – 06:00' }));
    expect(onCreateAt).toHaveBeenCalledWith({ day: 1, slot: 1 });
  });

  it('tocar numa tarefa abre a edição', async () => {
    const { onOpenTask, user } = renderGrid();
    await user.click(screen.getByRole('button', { name: '07:00 – 07:30 Academia' }));
    expect(onOpenTask).toHaveBeenCalledWith(1);
  });

  it('tarefas de outros dias não aparecem', () => {
    renderGrid([makeTask({ id: 2, title: 'Quarta', day: 2, slot: 4 })]);
    expect(screen.queryByRole('button', { name: /Quarta/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Agendar em/ })).toHaveLength(34);
  });
});
