import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DayEvent } from '../lib/calendarEvents';
import { CalendarEventsModal } from './CalendarEventsModal';

const item = (id: string, title: string, label: string): DayEvent => ({
  event: { id, title, start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T13:00:00.000Z', allDay: false },
  label,
  wholeDay: label === 'Dia inteiro',
});

describe('CalendarEventsModal', () => {
  it('lista os eventos com o horário à direita do título', () => {
    render(
      <CalendarEventsModal
        dayLabel="Terça, 17/11"
        events={[item('a', 'Aniversário', 'Dia inteiro'), item('b', 'Dentista', '09:00 – 10:00')]}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Agenda · Terça, 17/11' });
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.map((row) => [...row.children].map((child) => child.textContent))).toEqual([
      ['Aniversário', 'Dia inteiro'],
      ['Dentista', '09:00 – 10:00'],
    ]);
    expect(rows[1]?.lastElementChild).toHaveClass('calendar-event__time');
    expect(within(dialog).getByText('Da sua agenda da Apple, somente leitura.')).toBeInTheDocument();
  });

  it('o título do evento é texto, nunca HTML', () => {
    const { baseElement } = render(
      <CalendarEventsModal dayLabel="Terça, 17/11" events={[item('x', '<img src=x onerror=alert(1)>', '09:00')]} onClose={() => {}} />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(baseElement.querySelector('img')).toBeNull();
  });

  it('fecha', async () => {
    const onClose = vi.fn();
    render(<CalendarEventsModal dayLabel="Terça, 17/11" events={[item('a', 'A', '09:00')]} onClose={onClose} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
