import { formatLongDate, holidaysOn, monthLabel, nextHoliday, weekLabel } from '../lib/calendar';
import { HolidayDots } from './HolidayDots';

export interface CalendarHeaderProps {
  /** Data civil de hoje. */
  today: Date;
  /** Problema ao ler a agenda da Apple (ex.: senha de app recusada). */
  calendarError?: string | null;
}

/**
 * Calendário brasileiro, fora do quadro: mês, semana do mês, hoje e próximo
 * feriado. Os feriados aparecem como bolinhas que abrem o modal com o nome.
 */
export function CalendarHeader({ today, calendarError }: CalendarHeaderProps) {
  const todayHolidays = holidaysOn(today);
  const next = nextHoliday(today);

  return (
    <div className="calendar-header">
      <p className="calendar-header__month">{`${monthLabel(today)} · ${weekLabel(today)}`}</p>
      <p className="calendar-header__today">
        <span>{`Hoje: ${formatLongDate(today)}`}</span>
        <HolidayDots holidays={todayHolidays} />
      </p>
      {next ? (
        <p className="calendar-header__next">
          <span>Próximo feriado:</span>
          <HolidayDots holidays={[next]} />
          <span>{formatLongDate(next.date)}</span>
        </p>
      ) : null}
      {calendarError ? (
        <p className="calendar-header__agenda">
          <span className="calendar-dot calendar-dot--off" aria-hidden="true" />
          <span>{calendarError}</span>
        </p>
      ) : null}
    </div>
  );
}
