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
    render(inRow(<BoardCell day={0} slot={0} label="Segunda 09/11, 05:00 – 05:30" task={undefined} isToday={false} onOpenTask={() => {}} />));
    const cell = screen.getByRole('cell', { name: 'Segunda 09/11, 05:00 – 05:30' });
    expect(cell).toBeEmptyDOMElement();
    expect(cell).not.toHaveClass('is-today');
  });

  it('mostra a tarefa e abre ao clicar', async () => {
    const onOpenTask = vi.fn();
    render(
      inRow(
        <BoardCell
          day={4}
          slot={33}
          label="Sexta 13/11, 21:30 – 22:00"
          task={makeTask({ id: 3, title: 'Dormir', day: 4, slot: 33 })}
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
});
