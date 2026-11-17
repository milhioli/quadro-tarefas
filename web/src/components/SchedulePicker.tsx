import { dayName, occupantOf, type Task } from '@quadro/shared';
import { useId } from 'react';
import { clampSpan, endChoices, slotChoices } from '../lib/agenda';
import type { BoardColumn } from '../lib/board';
import { formatDayMonth, holidayKindLabel } from '../lib/calendar';

export interface ScheduleValue {
  /** null = sem horário (deck). */
  day: number | null;
  slot: number | null;
  /** Duração em slots de 30 min. É da tarefa: vale também sem horário (no deck). */
  span: number;
}

export interface SchedulePickerProps {
  columns: readonly BoardColumn[];
  tasks: readonly Task[];
  /** Tarefa em edição: a própria faixa não conta como ocupada. */
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
 * Dia, horário de início e fim ("Até") com <select> nativos (no celular abrem
 * o seletor do sistema). Início ocupado aparece desabilitado; o fim vai até a
 * próxima tarefa ou 22:00. Quem garante a regra de verdade é o 409 do servidor.
 */
export function SchedulePicker({ columns, tasks, selfId, value, onChange, error }: SchedulePickerProps) {
  const dayId = useId();
  const slotId = useId();
  const endId = useId();
  const errorId = useId();
  const choices = value.day === null ? [] : slotChoices(tasks, value.day, selfId);
  const ends = value.day === null || value.slot === null ? [] : endChoices(tasks, value.day, value.slot, selfId);

  function changeDay(raw: string): void {
    if (raw === '') {
      onChange({ day: null, slot: null, span: value.span });
      return;
    }
    const day = Number(raw);
    // Mantém o início escolhido se ele também estiver livre no novo dia; o fim encolhe se precisar.
    if (value.slot !== null && !occupantOf(tasks, day, value.slot, selfId)) {
      onChange({ day, slot: value.slot, span: clampSpan(tasks, day, value.slot, value.span, selfId) });
    } else {
      onChange({ day, slot: null, span: value.span });
    }
  }

  function changeSlot(raw: string): void {
    if (raw === '' || value.day === null) {
      onChange({ day: value.day, slot: null, span: value.span });
      return;
    }
    const slot = Number(raw);
    onChange({ day: value.day, slot, span: clampSpan(tasks, value.day, slot, value.span, selfId) });
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
            onChange={(event) => changeSlot(event.target.value)}
          >
            <option value="">{value.day === null ? '—' : 'Escolha um horário'}</option>
            {choices.map((choice) => (
              <option key={choice.slot} value={choice.slot} disabled={choice.occupant !== undefined}>
                {choice.occupant ? `${choice.label} · ocupado (${choice.occupant.title})` : choice.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={endId} className="field__sublabel">
            Até
          </label>
          <select
            id={endId}
            className="input"
            value={ends.length === 0 ? '' : String(value.span)}
            disabled={ends.length === 0}
            onChange={(event) => onChange({ ...value, span: Number(event.target.value) })}
          >
            {ends.length === 0 ? <option value="">—</option> : null}
            {ends.map((end) => (
              <option key={end.span} value={end.span}>
                {end.label}
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
