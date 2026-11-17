import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { holidaysOn, parseIsoDate } from '../lib/calendar';
import { HolidayModal } from './HolidayModal';

const d = (iso: string) => parseIsoDate(iso) as Date;

describe('HolidayModal', () => {
  it('lista nome, tipo e data de cada feriado', () => {
    render(<HolidayModal holidays={holidaysOn(d('2000-04-21'))} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Feriados' });
    const items = within(dialog).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Sexta-feira SantaFeriado · sexta-feira, 21/04',
      'TiradentesFeriado · sexta-feira, 21/04',
    ]);
  });

  it('identifica ponto facultativo', () => {
    render(<HolidayModal holidays={holidaysOn(d('2026-02-16'))} onClose={() => {}} />);
    expect(screen.getByText('Ponto facultativo · segunda-feira, 16/02')).toBeInTheDocument();
  });

  it('fecha', async () => {
    const onClose = vi.fn();
    render(<HolidayModal holidays={holidaysOn(d('2026-11-15'))} onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
