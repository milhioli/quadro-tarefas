import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

describe('ColorPicker', () => {
  it('mostra as 7 cores num grupo "Cor", com a atual marcada', () => {
    render(<ColorPicker value="azul" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Cor' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(7);
    expect(screen.getByRole('radio', { name: 'Azul' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Amarelo' })).not.toBeChecked();
  });

  it('avisa a cor escolhida', async () => {
    const onChange = vi.fn();
    render(<ColorPicker value="amarelo" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Verde' }));
    expect(onChange).toHaveBeenCalledWith('verde');
  });
});
