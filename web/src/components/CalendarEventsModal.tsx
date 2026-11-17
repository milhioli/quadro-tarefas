import type { DayEvent } from '../lib/calendarEvents';
import { Modal } from './Modal';

export interface CalendarEventsModalProps {
  /** "Terça, 17/11". */
  dayLabel: string;
  events: readonly DayEvent[];
  onClose: () => void;
}

/** Eventos da agenda da Apple no dia: estilo de cartão, título à esquerda e horário à direita. */
export function CalendarEventsModal({ dayLabel, events, onClose }: CalendarEventsModalProps) {
  return (
    <Modal title={`Agenda · ${dayLabel}`} onClose={onClose} size="small">
      <ul className="calendar-event-list">
        {events.map(({ event, label }) => (
          <li key={event.id} className="calendar-event">
            {/* Título sempre como texto: vem de convites de terceiros. */}
            <span className="calendar-event__title">{event.title}</span>
            <span className="calendar-event__time">{label}</span>
          </li>
        ))}
      </ul>
      <p className="calendar-event-list__note">Da sua agenda da Apple, somente leitura.</p>
    </Modal>
  );
}
