import { dayName, type Task } from '@quadro/shared';
import { useId, useMemo, useState } from 'react';
import { browserStorage, defaultAgendaDay, loadAgendaView, saveAgendaView, type AgendaView } from '../../lib/agenda';
import { deckTasks, type BoardColumn } from '../../lib/board';
import { formatDayMonth } from '../../lib/calendar';
import { EMPTY_DAY_EVENTS, dayTitle, type DayEvent } from '../../lib/calendarEvents';
import { CalendarDot } from '../CalendarDot';
import { HolidayDots } from '../HolidayDots';
import { AgendaDayGrid } from './AgendaDayGrid';
import { AgendaDayList } from './AgendaDayList';
import { AgendaViewTags } from './AgendaViewTags';
import { AgendaWeek } from './AgendaWeek';
import { DayTabs, dayTabId } from './DayTabs';
import { UnscheduledList } from './UnscheduledList';

export interface MobileAgendaProps {
  tasks: readonly Task[];
  columns: readonly BoardColumn[];
  onOpenTask: (id: number) => void;
  onCreateAt: (position: { day: number; slot: number }) => void;
  /** Eventos da agenda da Apple por dia (bolinha roxa). */
  eventsByDay?: ReadonlyMap<number, readonly DayEvent[]>;
}

/**
 * Layout do celular: tags de visualização (Dia, Dia completo, Semana), abas de
 * dia nas visualizações por dia e, embaixo, as tarefas sem horário.
 */
export function MobileAgenda({
  tasks,
  columns,
  onOpenTask,
  onCreateAt,
  eventsByDay = EMPTY_DAY_EVENTS,
}: MobileAgendaProps) {
  const [view, setView] = useState<AgendaView>(() => loadAgendaView(browserStorage));
  const [selectedDay, setSelectedDay] = useState(() => defaultAgendaDay(columns));
  const idPrefix = useId();
  const panelId = `${idPrefix}-panel`;
  const unscheduled = useMemo(() => deckTasks(tasks), [tasks]);
  const column = columns.find((c) => c.day === selectedDay) ?? columns[0];

  function changeView(next: AgendaView): void {
    setView(next);
    saveAgendaView(browserStorage, next);
  }

  return (
    <div className="mobile-agenda">
      <AgendaViewTags value={view} onChange={changeView} />

      {view === 'week' || !column ? (
        <AgendaWeek tasks={tasks} columns={columns} onOpenTask={onOpenTask} eventsByDay={eventsByDay} />
      ) : (
        <>
          <DayTabs
            columns={columns}
            selected={column.day}
            onSelect={setSelectedDay}
            panelId={panelId}
            idPrefix={idPrefix}
            eventsByDay={eventsByDay}
          />
          <section
            id={panelId}
            role="tabpanel"
            aria-labelledby={dayTabId(idPrefix, column.day)}
            className="agenda-panel"
          >
            <div className="agenda-panel__header">
              <h2 className="agenda-panel__title">
                {`${dayName(column.day)}, ${formatDayMonth(column.date)}${column.isToday ? ' · hoje' : ''}`}
              </h2>
              <HolidayDots holidays={column.holidays} />
              <CalendarDot events={eventsByDay.get(column.day) ?? []} dayLabel={dayTitle(column)} />
            </div>
            {view === 'day' ? (
              <AgendaDayList tasks={tasks} day={column.day} onOpenTask={onOpenTask} />
            ) : (
              <AgendaDayGrid tasks={tasks} column={column} onOpenTask={onOpenTask} onCreateAt={onCreateAt} />
            )}
          </section>
        </>
      )}

      <UnscheduledList tasks={unscheduled} onOpenTask={onOpenTask} />
    </div>
  );
}
