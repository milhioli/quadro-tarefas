import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgendaViewTags } from './AgendaViewTags';

describe('AgendaViewTags', () => {
  it('três tags num grupo, com a atual pressionada', () => {
    render(<AgendaViewTags value="dayFull" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Visualização' });
    const tags = within(group).getAllByRole('button');
    expect(tags.map((t) => [t.textContent, t.getAttribute('aria-pressed')])).toEqual([
      ['Dia', 'false'],
      ['Dia completo', 'true'],
      ['Semana', 'false'],
    ]);
  });

  it('avisa a visualização escolhida', async () => {
    const onChange = vi.fn();
    render(<AgendaViewTags value="day" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Semana' }));
    expect(onChange).toHaveBeenCalledWith('week');
  });
});
