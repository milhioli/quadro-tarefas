import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { boardColumns, boardLayout } from '../lib/board';
import { parseIsoDate } from '../lib/calendar';
import { eventsByDay } from '../lib/calendarEvents';
import { TestDndContext } from '../test/dnd';
import { makeTask } from '../test/fakeApi';
import { Board } from './Board';

const d = (iso: string) => parseIsoDate(iso) as Date;

function renderBoard(todayIso: string, tasks = [makeTask({ id: 1, title: 'Reunião', day: 2, slot: 2 })]) {
  const onOpenTask = vi.fn();
  render(
    <TestDndContext>
      <Board columns={boardColumns(d(todayIso))} layout={boardLayout(tasks)} onOpenTask={onOpenTask} />
    </TestDndContext>,
  );
  return { onOpenTask };
}

describe('Board', () => {
  it('tem as colunas de segunda a sexta da semana e 34 linhas de horário', () => {
    renderBoard('2026-11-13');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Horário', 'Seg 09/11', 'Ter 10/11', 'Qua 11/11', 'Qui 12/11', 'Sex 13/11']);
    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders).toHaveLength(34);
    expect(rowHeaders[0]).toHaveTextContent('05:00 – 05:30');
    expect(rowHeaders[33]).toHaveTextContent('21:30 – 22:00');
    expect(screen.getAllByRole('cell')).toHaveLength(34 * 5);
  });

  it('marca a coluna de hoje com aria-current="date"', () => {
    renderBoard('2026-11-13');
    const today = screen.getByRole('columnheader', { name: 'Sex 13/11' });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('columnheader', { name: 'Seg 09/11' })).not.toHaveAttribute('aria-current');
  });

  it('põe a tarefa na célula do dia e horário dela', async () => {
    const { onOpenTask } = renderBoard('2026-11-13');
    const cell = screen.getByRole('cell', { name: 'Quarta 11/11, 06:00 – 06:30' });
    await userEvent.setup().click(within(cell).getByRole('button', { name: /Reunião/ }));
    expect(onOpenTask).toHaveBeenCalledWith(1);
  });

  it('feriado vira uma bolinha no cabeçalho que abre o modal (Consciência Negra em 20/11/2026)', async () => {
    renderBoard('2026-11-15', []);
    const friday = screen.getByRole('columnheader', { name: /Sex 20\/11/ });
    expect(friday.textContent).toBe('Sex 20/11');
    const dot = within(friday).getByRole('button', { name: 'Feriado: Dia Nacional de Zumbi e da Consciência Negra (20/11)' });
    expect(dot).toHaveClass('holiday-dot--feriado');

    await userEvent.setup().click(dot);
    expect(screen.getByRole('dialog', { name: 'Feriados' })).toHaveTextContent('Dia Nacional de Zumbi e da Consciência Negra');
  });

  it('ponto facultativo tem bolinha própria (Carnaval 2026)', () => {
    renderBoard('2026-02-15', []);
    const dots = screen.getAllByRole('button', { name: /^Ponto facultativo: Carnaval/ });
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveClass('holiday-dot--facultativo');
  });

  it('dia com evento da agenda tem uma bolinha roxa que abre a lista', async () => {
    const columns = boardColumns(d('2026-11-13'));
    const start = new Date(2026, 10, 13, 9).toISOString();
    const end = new Date(2026, 10, 13, 10).toISOString();
    const events = eventsByDay([{ id: 'e1', title: 'Dentista', start, end, allDay: false }], columns);
    render(
      <TestDndContext>
        <Board columns={columns} layout={boardLayout([])} onOpenTask={() => {}} eventsByDay={events} />
      </TestDndContext>,
    );
    const friday = screen.getByRole('columnheader', { name: /Sex 13\/11/ });
    const dot = within(friday).getByRole('button', { name: 'Agenda: 1 evento em Sexta, 13/11' });
    expect(dot).toHaveClass('calendar-dot');
    expect(within(screen.getByRole('columnheader', { name: /Qui 12\/11/ })).queryByRole('button')).toBeNull();

    await userEvent.setup().click(dot);
    expect(screen.getByRole('dialog', { name: 'Agenda · Sexta, 13/11' })).toHaveTextContent('Dentista09:00 – 10:00');
  });

  it('tarefa de vários slots é desenhada só na célula de início e cobre as de baixo', () => {
    renderBoard('2026-11-13', [makeTask({ id: 7, title: 'Plantão', day: 0, slot: 0, span: 30 })]);
    const start = screen.getByRole('cell', { name: 'Segunda 09/11, 05:00 – 05:30' });
    const card = within(start).getByRole('button', { name: /Plantão/ });
    expect(card.style.getPropertyValue('--span')).toBe('30');
    expect(screen.getAllByRole('button', { name: /Plantão/ })).toHaveLength(1);
    const covered = screen.getByRole('cell', { name: 'Segunda 09/11, 19:30 – 20:00' });
    expect(covered).toHaveClass('is-covered');
    expect(covered).toBeEmptyDOMElement();
    expect(screen.getByRole('cell', { name: 'Segunda 09/11, 20:00 – 20:30' })).not.toHaveClass('is-covered');
    // Todas as 170 células continuam lá (e aceitando soltar).
    expect(screen.getAllByRole('cell')).toHaveLength(34 * 5);
  });

  it('com onResizeTask os cartões do quadro ganham a borda', () => {
    render(
      <TestDndContext>
        <Board
          columns={boardColumns(d('2026-11-13'))}
          layout={boardLayout([makeTask({ id: 1, title: 'Reunião', day: 2, slot: 2 })])}
          onOpenTask={() => {}}
          onResizeTask={() => {}}
        />
      </TestDndContext>,
    );
    const card = screen.getByRole('button', { name: /Reunião/ });
    expect(card.querySelector('.task-card__resize')).not.toBeNull();
  });

  it('dia sem feriado não tem bolinha', () => {
    renderBoard('2026-11-13');
    expect(screen.queryByRole('button', { name: /^Feriado:/ })).not.toBeInTheDocument();
  });
});
