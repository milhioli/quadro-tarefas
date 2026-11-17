import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DayEvent } from '../lib/calendarEvents';
import { CalendarDot, calendarDotLabel } from './CalendarDot';

const items: DayEvent[] = ['Café', 'Dentista', 'Jantar'].map((title, index) => ({
  event: { id: String(index), title, start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T13:00:00.000Z', allDay: false },
  label: `0${index + 8}:00`,
  wholeDay: false,
}));

describe('CalendarDot', () => {
  it('sem eventos não mostra nada', () => {
    const { container } = render(<CalendarDot events={[]} dayLabel="Terça, 17/11" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uma bolinha só, por mais eventos que o dia tenha', () => {
    render(<CalendarDot events={items} dayLabel="Terça, 17/11" />);
    const dots = screen.getAllByRole('button');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAccessibleName('Agenda: 3 eventos em Terça, 17/11');
    expect(dots[0]).toHaveClass('calendar-dot');
  });

  it('clicar abre a lista do dia', async () => {
    render(<CalendarDot events={items} dayLabel="Terça, 17/11" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /^Agenda:/ }));
    expect(screen.getByRole('dialog', { name: 'Agenda · Terça, 17/11' })).toHaveTextContent('Dentista');
  });

  it('versão decorativa não é botão', () => {
    const { container } = render(<CalendarDot events={items} dayLabel="Terça, 17/11" decorative />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('.calendar-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calendarDotLabel no singular e no plural', () => {
    expect(calendarDotLabel(1, 'Sexta, 20/11')).toBe('Agenda: 1 evento em Sexta, 20/11');
    expect(calendarDotLabel(2, 'Sexta, 20/11')).toBe('Agenda: 2 eventos em Sexta, 20/11');
  });
});
