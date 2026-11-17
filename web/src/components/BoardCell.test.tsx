import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TestDndContext } from '../test/dnd';
import { makeTask } from '../test/fakeApi';
import { BoardCell } from './BoardCell';

function inRow(children: ReactNode) {
  return (
    <TestDndContext>
      <table>
        <tbody>
          <tr>{children}</tr>
        </tbody>
      </table>
    </TestDndContext>
  );
}

describe('BoardCell', () => {
  it('célula vazia com rótulo de dia e horário', () => {
    render(inRow(<BoardCell day={0} slot={0} label="Segunda 09/11, 05:00 – 05:30" isToday={false} onOpenTask={() => {}} />));
    const cell = screen.getByRole('cell', { name: 'Segunda 09/11, 05:00 – 05:30' });
    expect(cell).toBeEmptyDOMElement();
    expect(cell).not.toHaveClass('is-today');
  });

  it('mostra a tarefa que começa nela e abre ao clicar', async () => {
    const onOpenTask = vi.fn();
    render(
      inRow(
        <BoardCell
          day={4}
          slot={33}
          label="Sexta 13/11, 21:30 – 22:00"
          start={{ task: makeTask({ id: 3, title: 'Dormir', day: 4, slot: 33 }), maxSpan: 1 }}
          isToday
          onOpenTask={onOpenTask}
        />,
      ),
    );
    const cell = screen.getByRole('cell', { name: 'Sexta 13/11, 21:30 – 22:00' });
    expect(cell).toHaveClass('is-today', 'is-filled');
    await userEvent.setup().click(within(cell).getByRole('button', { name: /Dormir/ }));
    expect(onOpenTask).toHaveBeenCalledWith(3);
  });

  it('célula coberta pela faixa de cima fica vazia, mas continua sendo célula', () => {
    render(inRow(<BoardCell day={0} slot={5} label="Segunda 09/11, 07:30 – 08:00" covered isToday={false} onOpenTask={() => {}} />));
    const cell = screen.getByRole('cell', { name: 'Segunda 09/11, 07:30 – 08:00' });
    expect(cell).toHaveClass('is-covered');
    expect(cell).not.toHaveClass('is-filled');
    expect(cell).toBeEmptyDOMElement();
  });

  it('com onResizeTask o cartão ganha a borda de redimensionar', () => {
    const start = { task: makeTask({ id: 1, title: 'Plantão', day: 0, slot: 0, span: 3 }), maxSpan: 10 };
    const { rerender } = render(
      inRow(<BoardCell day={0} slot={0} label="Segunda" start={start} isToday={false} onOpenTask={() => {}} />),
    );
    expect(document.querySelector('.task-card__resize')).toBeNull();
    rerender(
      inRow(
        <BoardCell day={0} slot={0} label="Segunda" start={start} isToday={false} onOpenTask={() => {}} onResizeTask={() => {}} />,
      ),
    );
    expect(document.querySelector('.task-card__resize')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Plantão/ }).style.getPropertyValue('--span')).toBe('3');
  });
});
