import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { boardColumns } from '../lib/board';
import { parseIsoDate } from '../lib/calendar';
import { makeTask } from '../test/fakeApi';
import { SchedulePicker, dayOptionLabel, type ScheduleValue } from './SchedulePicker';

const d = (iso: string) => parseIsoDate(iso) as Date;
const columns = boardColumns(d('2026-11-13'));
const tasks = [makeTask({ id: 1, title: 'Reunião', day: 0, slot: 2 }), makeTask({ id: 2, title: 'Minha', day: 1, slot: 4 })];

function Harness({ initial = { day: null, slot: null }, selfId, onChange = () => {}, error }: {
  initial?: ScheduleValue;
  selfId?: number;
  onChange?: (v: ScheduleValue) => void;
  error?: string;
}) {
  const [value, setValue] = useState<ScheduleValue>(initial);
  return (
    <SchedulePicker
      columns={columns}
      tasks={tasks}
      selfId={selfId}
      value={value}
      error={error}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

const daySelect = () => screen.getByRole('combobox', { name: 'Dia' });
const slotSelect = () => screen.getByRole('combobox', { name: 'Horário' });

describe('SchedulePicker', () => {
  it('começa em "Sem horário", com o horário desabilitado', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Quando' })).toBeInTheDocument();
    expect(daySelect()).toHaveValue('');
    expect(within(daySelect()).getByRole('option', { name: 'Sem horário (fica no deck)' })).toBeInTheDocument();
    expect(slotSelect()).toBeDisabled();
  });

  it('lista os dias da semana com data e marca hoje', () => {
    render(<Harness />);
    const options = within(daySelect()).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'Sem horário (fica no deck)',
      'Segunda, 09/11',
      'Terça, 10/11',
      'Quarta, 11/11',
      'Quinta, 12/11',
      'Sexta, 13/11 (hoje)',
    ]);
  });

  it('escolher dia libera os 34 horários e mostra os ocupados desabilitados', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.selectOptions(daySelect(), 'Segunda, 09/11');

    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: null });
    expect(slotSelect()).toBeEnabled();
    const options = within(slotSelect()).getAllByRole('option');
    expect(options).toHaveLength(35);
    const occupied = within(slotSelect()).getByRole('option', { name: '06:00 – 06:30 · ocupado (Reunião)' });
    expect(occupied).toBeDisabled();
    expect(within(slotSelect()).getByRole('option', { name: '05:00 – 05:30' })).toBeEnabled();

    await user.selectOptions(slotSelect(), '05:30 – 06:00');
    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: 1 });
  });

  it('a própria tarefa não bloqueia o próprio horário', () => {
    render(<Harness initial={{ day: 1, slot: 4 }} selfId={2} />);
    expect(slotSelect()).toHaveValue('4');
    expect(within(slotSelect()).getByRole('option', { name: '07:00 – 07:30' })).toBeEnabled();
  });

  it('trocar de dia mantém o horário se estiver livre e limpa se estiver ocupado', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 3, slot: 2 }} onChange={onChange} />);
    const user = userEvent.setup();
    await user.selectOptions(daySelect(), 'Terça, 10/11');
    expect(onChange).toHaveBeenLastCalledWith({ day: 1, slot: 2 });
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: null });
  });

  it('voltar para "Sem horário" limpa o horário', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 2, slot: 8 }} onChange={onChange} />);
    await userEvent.setup().selectOptions(daySelect(), 'Sem horário (fica no deck)');
    expect(onChange).toHaveBeenLastCalledWith({ day: null, slot: null });
  });

  it('mostra o erro ligado ao campo de horário', () => {
    render(<Harness initial={{ day: 0, slot: null }} error="Escolha um horário" />);
    expect(slotSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(slotSelect()).toHaveAccessibleDescription('Escolha um horário');
  });

  it('o título do ocupante aparece como texto', () => {
    const evil = [makeTask({ id: 9, title: '<img src=x onerror=alert(1)>', day: 0, slot: 0 })];
    const { container } = render(
      <SchedulePicker columns={columns} tasks={evil} value={{ day: 0, slot: null }} onChange={() => {}} />,
    );
    expect(within(slotSelect()).getByRole('option', { name: '05:00 – 05:30 · ocupado (<img src=x onerror=alert(1)>)' })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('dayOptionLabel', () => {
  it('inclui hoje e o tipo de feriado em texto', () => {
    const week = boardColumns(d('2026-11-15'));
    expect(dayOptionLabel(week[4] as (typeof week)[number])).toBe('Sexta, 20/11 · Feriado');
    const carnaval = boardColumns(d('2026-02-16'));
    expect(dayOptionLabel(carnaval[0] as (typeof carnaval)[number])).toBe('Segunda, 16/02 (hoje) · Ponto facultativo');
  });
});
