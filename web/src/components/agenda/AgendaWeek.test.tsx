import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { boardColumns } from '../../lib/board';
import { parseIsoDate } from '../../lib/calendar';
import { eventsByDay } from '../../lib/calendarEvents';
import { makeTask } from '../../test/fakeApi';
import { AgendaWeek } from './AgendaWeek';

// Domingo, 15/11/2026: mostra a semana de 16 a 20/11 (sexta é feriado).
const columns = boardColumns(parseIsoDate('2026-11-15') as Date);
const tasks = [
  makeTask({ id: 1, title: 'Academia', day: 0, slot: 4 }),
  makeTask({ id: 2, title: 'Almoço', day: 0, slot: 14 }),
  makeTask({ id: 3, title: 'Reunião', day: 3, slot: 10 }),
];

describe('AgendaWeek', () => {
  it('uma seção por dia, com as tarefas agendadas em ordem', () => {
    render(<AgendaWeek tasks={tasks} columns={columns} onOpenTask={() => {}} />);
    const monday = screen.getByRole('region', { name: 'Seg 16/11' });
    expect(within(monday).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '07:00 – 07:30 Academia',
      '12:00 – 12:30 Almoço',
    ]);
    expect(within(screen.getByRole('region', { name: 'Qui 19/11' })).getByRole('button', { name: /Reunião/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Ter 17/11' })).getByText('Nada agendado.')).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(5);
  });

  it('tarefa de vários slots mostra a faixa inteira', () => {
    render(<AgendaWeek tasks={[makeTask({ id: 8, title: 'Plantão', day: 2, slot: 0, span: 30 })]} columns={columns} onOpenTask={() => {}} />);
    const wednesday = screen.getByRole('region', { name: 'Qua 18/11' });
    expect(within(wednesday).getByRole('button', { name: '05:00 – 20:00 Plantão' })).toBeInTheDocument();
  });

  it('feriado aparece como bolinha que abre o modal', async () => {
    render(<AgendaWeek tasks={[]} columns={columns} onOpenTask={() => {}} />);
    const friday = screen.getByRole('region', { name: 'Sex 20/11' });
    await userEvent
      .setup()
      .click(within(friday).getByRole('button', { name: 'Feriado: Dia Nacional de Zumbi e da Consciência Negra (20/11)' }));
    expect(screen.getByRole('dialog', { name: 'Feriados' })).toHaveTextContent('Dia Nacional de Zumbi e da Consciência Negra');
  });

  it('dia com agenda mostra a bolinha roxa na seção', async () => {
    const start = new Date(2026, 10, 17, 14).toISOString();
    const end = new Date(2026, 10, 17, 15).toISOString();
    const events = eventsByDay([{ id: 'a', title: 'Consulta', start, end, allDay: false }], columns);
    render(<AgendaWeek tasks={[]} columns={columns} onOpenTask={() => {}} eventsByDay={events} />);
    const tuesday = screen.getByRole('region', { name: 'Ter 17/11' });
    await userEvent.setup().click(within(tuesday).getByRole('button', { name: 'Agenda: 1 evento em Terça, 17/11' }));
    expect(screen.getByRole('dialog', { name: 'Agenda · Terça, 17/11' })).toHaveTextContent('Consulta14:00 – 15:00');
  });

  it('marca o dia de hoje', () => {
    render(<AgendaWeek tasks={[]} columns={boardColumns(parseIsoDate('2026-11-17') as Date)} onOpenTask={() => {}} />);
    expect(screen.getByRole('region', { name: 'Ter 17/11 · hoje' })).toHaveClass('is-today');
  });

  it('tocar abre a tarefa', async () => {
    const onOpenTask = vi.fn();
    render(<AgendaWeek tasks={tasks} columns={columns} onOpenTask={onOpenTask} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Reunião/ }));
    expect(onOpenTask).toHaveBeenCalledWith(3);
  });
});
