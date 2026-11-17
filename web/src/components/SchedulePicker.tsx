import { dayName, occupantOf, type Task } from '@quadro/shared';
import { useId } from 'react';
import { slotChoices } from '../lib/agenda';
import type { BoardColumn } from '../lib/board';
import { formatDayMonth, holidayKindLabel } from '../lib/calendar';

export interface ScheduleValue {
  /** null = sem horário (deck). */
  day: number | null;
  slot: number | null;
}

export interface SchedulePickerProps {
  columns: readonly BoardColumn[];
  tasks: readonly Task[];
  /** Tarefa em edição: o próprio horário não conta como ocupado. */
  selfId?: number;
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  error?: string | null;
}

/** "Segunda, 16/11 (hoje) · Feriado" — <option> não desenha cor, então o feriado vai em texto. */
export function dayOptionLabel(column: BoardColumn): string {
  let label = `${dayName(column.day)}, ${formatDayMonth(column.date)}`;
  if (column.isToday) label += ' (hoje)';
  const kinds = [...new Set(column.holidays.map((h) => holidayKindLabel(h.kind)))];
  if (kinds.length > 0) label += ` · ${kinds.join(', ')}`;
  return label;
}

/**
 * Dia e horário da tarefa com <select> nativos (no celular abrem o seletor do
 * sistema). Horário ocupado por outra tarefa aparece desabilitado; quem
 * garante a regra de verdade é o 409 do servidor.
 */
export function SchedulePicker({ columns, tasks, selfId, value, onChange, error }: SchedulePickerProps) {
  const dayId = useId();
  const slotId = useId();
  const errorId = useId();
  const choices = value.day === null ? [] : slotChoices(tasks, value.day, selfId);

  function changeDay(raw: string): void {
    if (raw === '') {
      onChange({ day: null, slot: null });
      return;
    }
    const day = Number(raw);
    // Mantém o horário escolhido se ele também estiver livre no novo dia.
    const keep = value.slot !== null && !occupantOf(tasks, day, value.slot, selfId);
    onChange({ day, slot: keep ? value.slot : null });
  }

  return (
    <fieldset className="schedule-picker">
      <legend className="field__label">Quando</legend>
      <div className="schedule-picker__row">
        <div className="field">
          <label htmlFor={dayId} className="field__sublabel">
            Dia
          </label>
          <select
            id={dayId}
            className="input"
            value={value.day === null ? '' : String(value.day)}
            onChange={(event) => changeDay(event.target.value)}
          >
            <option value="">Sem horário (fica no deck)</option>
            {columns.map((column) => (
              <option key={column.day} value={column.day}>
                {dayOptionLabel(column)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={slotId} className="field__sublabel">
            Horário
          </label>
          <select
            id={slotId}
            className="input"
            value={value.slot === null ? '' : String(value.slot)}
            disabled={value.day === null}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) =>
              onChange({ day: value.day, slot: event.target.value === '' ? null : Number(event.target.value) })
            }
          >
            <option value="">{value.day === null ? '—' : 'Escolha um horário'}</option>
            {choices.map((choice) => (
              <option key={choice.slot} value={choice.slot} disabled={choice.occupant !== undefined}>
                {choice.occupant ? `${choice.label} · ocupado (${choice.occupant.title})` : choice.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <p id={errorId} className="field__error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
