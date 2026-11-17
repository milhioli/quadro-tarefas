import { useState } from 'react';
import { holidayLabel, isoDate, type Holiday } from '../lib/calendar';
import { HolidayModal } from './HolidayModal';

export interface HolidayDotsProps {
  holidays: readonly Holiday[];
  /**
   * Só a marca visual, sem botão. Para quando a bolinha fica dentro de outro
   * elemento clicável (ex.: aba de dia), onde um botão aninhado seria inválido.
   */
  decorative?: boolean;
}

/**
 * Uma bolinha por feriado, na cor do tipo (feriado ou ponto facultativo).
 * Clicar abre o modal com os feriados do grupo.
 */
export function HolidayDots({ holidays, decorative = false }: HolidayDotsProps) {
  const [open, setOpen] = useState(false);
  if (holidays.length === 0) return null;

  if (decorative) {
    return (
      <span className="holiday-dots" aria-hidden="true">
        {holidays.map((holiday) => (
          <span key={`${isoDate(holiday.date)}-${holiday.name}`} className={`holiday-dot holiday-dot--${holiday.kind}`} />
        ))}
      </span>
    );
  }

  return (
    <>
      <span className="holiday-dots">
        {holidays.map((holiday) => (
          <button
            key={`${isoDate(holiday.date)}-${holiday.name}`}
            type="button"
            className={`holiday-dot holiday-dot--${holiday.kind}`}
            aria-label={holidayLabel(holiday)}
            title={holidayLabel(holiday)}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
          />
        ))}
      </span>
      {open ? <HolidayModal holidays={holidays} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
