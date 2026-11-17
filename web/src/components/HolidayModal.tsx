import { formatLongDate, holidayKindLabel, isoDate, type Holiday } from '../lib/calendar';
import { Modal } from './Modal';

export interface HolidayModalProps {
  holidays: readonly Holiday[];
  onClose: () => void;
}

/** Lista dos feriados de uma bolinha (do dia, ou o próximo feriado). */
export function HolidayModal({ holidays, onClose }: HolidayModalProps) {
  return (
    <Modal title="Feriados" onClose={onClose} size="small">
      <ul className="holiday-list">
        {holidays.map((holiday) => (
          <li key={`${isoDate(holiday.date)}-${holiday.name}`} className="holiday-list__item">
            <span className={`holiday-dot holiday-dot--${holiday.kind}`} aria-hidden="true" />
            <span className="holiday-list__text">
              <span className="holiday-list__name">{holiday.name}</span>
              <span className="holiday-list__meta">{`${holidayKindLabel(holiday.kind)} · ${formatLongDate(holiday.date)}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
