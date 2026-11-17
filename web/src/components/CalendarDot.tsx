import { useState } from 'react';
import type { DayEvent } from '../lib/calendarEvents';
import { CalendarEventsModal } from './CalendarEventsModal';

export interface CalendarDotProps {
  events: readonly DayEvent[];
  /** "Terça, 17/11". */
  dayLabel: string;
  /** Só a marca visual (ex.: dentro da aba de dia, que já é um botão). */
  decorative?: boolean;
}

export function calendarDotLabel(count: number, dayLabel: string): string {
  return `Agenda: ${count === 1 ? '1 evento' : `${count} eventos`} em ${dayLabel}`;
}

/** Uma bolinha roxa só, se o dia tem evento na agenda da Apple. Clicar abre a lista. */
export function CalendarDot({ events, dayLabel, decorative = false }: CalendarDotProps) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  if (decorative) return <span className="calendar-dot" aria-hidden="true" />;

  const label = calendarDotLabel(events.length, dayLabel);
  return (
    <>
      <button
        type="button"
        className="calendar-dot"
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      />
      {open ? <CalendarEventsModal dayLabel={dayLabel} events={events} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
