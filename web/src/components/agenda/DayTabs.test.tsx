import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { boardColumns } from '../../lib/board';
import { parseIsoDate } from '../../lib/calendar';
import { eventsByDay } from '../../lib/calendarEvents';
import { DayTabs, dayTabId } from './DayTabs';

const d = (iso: string) => parseIsoDate(iso) as Date;

function Harness({ todayIso = '2026-11-17', initial = 1 }: { todayIso?: string; initial?: number }) {
  const [selected, setSelected] = useState(initial);
  return (
    <>
      <DayTabs columns={boardColumns(d(todayIso))} selected={selected} onSelect={setSelected} panelId="painel" idPrefix="t" />
      <div id="painel" role="tabpanel" aria-labelledby={dayTabId('t', selected)}>
        {`dia ${selected}`}
      </div>
    </>
  );
}

describe('DayTabs', () => {
  it('cinco abas, com a selecionada e a marca de hoje', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Seg 16/11', 'Ter 17/11 hoje', 'Qua 18/11', 'Qui 19/11', 'Sex 20/11, 1 feriado']);
    expect(screen.getByRole('tab', { name: 'Ter 17/11 hoje' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Seg 16/11' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Ter 17/11 hoje' })).toHaveTextContent('dia 1');
  });

  it('só a aba selecionada fica no Tab', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Ter 17/11 hoje' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Qua 18/11' })).toHaveAttribute('tabindex', '-1');
  });

  it('clicar troca o dia', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Qui 19/11' }));
    expect(screen.getByRole('tab', { name: 'Qui 19/11' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('dia 3');
  });

  it('setas, Home e End trocam o dia e movem o foco', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: 'Ter 17/11 hoje' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Qua 18/11' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('dia 2');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /Sex 20\/11/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Seg 16/11' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /Sex 20\/11/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('dia 0');
  });

  it('dia com agenda ganha a bolinha roxa (só visual) e o aviso para leitor de tela', () => {
    const columns = boardColumns(d('2026-11-17'));
    const start = new Date(2026, 10, 18, 9).toISOString();
    const events = eventsByDay([{ id: 'x', title: 'Reunião', start, end: start, allDay: false }], columns);
    const { container } = render(
      <DayTabs columns={columns} selected={1} onSelect={() => {}} panelId="p" idPrefix="t" eventsByDay={events} />,
    );
    expect(screen.getByRole('tab', { name: 'Qua 18/11, com agenda' })).toBeInTheDocument();
    expect(container.querySelectorAll('.day-tab .calendar-dot')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Agenda:/ })).not.toBeInTheDocument();
  });

  it('a bolinha de feriado na aba é só visual', () => {
    const { container } = render(<Harness todayIso="2026-11-15" initial={4} />);
    expect(container.querySelector('.day-tab .holiday-dot--feriado')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Feriado:/ })).not.toBeInTheDocument();
  });
});
