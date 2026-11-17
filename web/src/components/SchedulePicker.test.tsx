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

function Harness({ initial = { day: null, slot: null, span: 1 }, selfId, onChange = () => {}, error }: {
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
const endSelect = () => screen.getByRole('combobox', { name: 'Até' });
const optionTexts = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('SchedulePicker: "Até" (duração)', () => {
  it('fica desabilitado sem início e lista os fins até a próxima tarefa', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 0, slot: null, span: 1 }} onChange={onChange} />);
    expect(endSelect()).toBeDisabled();

    const user = userEvent.setup();
    await user.selectOptions(slotSelect(), '05:00 – 05:30');
    expect(endSelect()).toBeEnabled();
    // A Reunião começa às 06:00: dá para ir até ela, não além.
    expect(optionTexts(endSelect())).toEqual(['05:30 (30 min)', '06:00 (1 h)']);
    expect(endSelect()).toHaveValue('1');

    await user.selectOptions(endSelect(), '06:00 (1 h)');
    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: 0, span: 2 });
  });

  it('sem tarefa abaixo, o fim vai até 22:00', () => {
    render(<Harness initial={{ day: 4, slot: 30, span: 1 }} />);
    expect(optionTexts(endSelect())).toEqual(['20:30 (30 min)', '21:00 (1 h)', '21:30 (1 h 30)', '22:00 (2 h)']);
  });

  it('trocar o início para perto da próxima tarefa encolhe o fim', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 0, slot: 10, span: 6 }} onChange={onChange} />);
    expect(endSelect()).toHaveValue('6');
    await userEvent.setup().selectOptions(slotSelect(), '05:00 – 05:30');
    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: 0, span: 2 });
  });

  it('trocar de dia mantém o início e encolhe o fim se a faixa não couber', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 3, slot: 0, span: 6 }} onChange={onChange} />);
    // Na terça, a tarefa "Minha" começa às 07:00 (slot 4).
    await userEvent.setup().selectOptions(daySelect(), 'Terça, 10/11');
    expect(onChange).toHaveBeenLastCalledWith({ day: 1, slot: 0, span: 4 });
  });

  it('um início coberto pela faixa de outra tarefa aparece ocupado', async () => {
    const long = [makeTask({ id: 5, title: 'Plantão', day: 2, slot: 0, span: 30 })];
    render(<SchedulePicker columns={columns} tasks={long} value={{ day: 2, slot: null, span: 1 }} onChange={() => {}} />);
    expect(within(slotSelect()).getByRole('option', { name: '19:30 – 20:00 · ocupado (Plantão)' })).toBeDisabled();
    expect(within(slotSelect()).getByRole('option', { name: '20:00 – 20:30' })).toBeEnabled();
  });

  it('a própria faixa não limita o fim', () => {
    const own = [makeTask({ id: 1, title: 'Eu', day: 0, slot: 0, span: 3 }), makeTask({ id: 2, day: 0, slot: 10 })];
    render(<SchedulePicker columns={columns} tasks={own} selfId={1} value={{ day: 0, slot: 0, span: 3 }} onChange={() => {}} />);
    expect(within(endSelect()).getAllByRole('option')).toHaveLength(10);
    expect(endSelect()).toHaveValue('3');
  });
});

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

    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: null, span: 1 });
    expect(slotSelect()).toBeEnabled();
    const options = within(slotSelect()).getAllByRole('option');
    expect(options).toHaveLength(35);
    const occupied = within(slotSelect()).getByRole('option', { name: '06:00 – 06:30 · ocupado (Reunião)' });
    expect(occupied).toBeDisabled();
    expect(within(slotSelect()).getByRole('option', { name: '05:00 – 05:30' })).toBeEnabled();

    await user.selectOptions(slotSelect(), '05:30 – 06:00');
    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: 1, span: 1 });
  });

  it('a própria tarefa não bloqueia o próprio horário', () => {
    render(<Harness initial={{ day: 1, slot: 4, span: 1 }} selfId={2} />);
    expect(slotSelect()).toHaveValue('4');
    expect(within(slotSelect()).getByRole('option', { name: '07:00 – 07:30' })).toBeEnabled();
  });

  it('trocar de dia mantém o horário se estiver livre e limpa se estiver ocupado', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 3, slot: 2, span: 1 }} onChange={onChange} />);
    const user = userEvent.setup();
    await user.selectOptions(daySelect(), 'Terça, 10/11');
    expect(onChange).toHaveBeenLastCalledWith({ day: 1, slot: 2, span: 1 });
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    expect(onChange).toHaveBeenLastCalledWith({ day: 0, slot: null, span: 1 });
  });

  it('voltar para "Sem horário" limpa o horário', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ day: 2, slot: 8, span: 1 }} onChange={onChange} />);
    await userEvent.setup().selectOptions(daySelect(), 'Sem horário (fica no deck)');
    expect(onChange).toHaveBeenLastCalledWith({ day: null, slot: null, span: 1 });
  });

  it('mostra o erro ligado ao campo de horário', () => {
    render(<Harness initial={{ day: 0, slot: null, span: 1 }} error="Escolha um horário" />);
    expect(slotSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(slotSelect()).toHaveAccessibleDescription('Escolha um horário');
  });

  it('o título do ocupante aparece como texto', () => {
    const evil = [makeTask({ id: 9, title: '<img src=x onerror=alert(1)>', day: 0, slot: 0 })];
    const { container } = render(
      <SchedulePicker columns={columns} tasks={evil} value={{ day: 0, slot: null, span: 1 }} onChange={() => {}} />,
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
