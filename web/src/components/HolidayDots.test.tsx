import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { holidaysOn, parseIsoDate } from '../lib/calendar';
import { HolidayDots } from './HolidayDots';

const d = (iso: string) => parseIsoDate(iso) as Date;

describe('HolidayDots', () => {
  it('sem feriado não renderiza nada', () => {
    const { container } = render(<HolidayDots holidays={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uma bolinha por feriado, na cor do tipo, nomeada para leitor de tela', () => {
    render(<HolidayDots holidays={holidaysOn(d('2000-04-21'))} />);
    const dots = screen.getAllByRole('button');
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual([
      'Feriado: Sexta-feira Santa (21/04)',
      'Feriado: Tiradentes (21/04)',
    ]);
    expect(dots[0]).toHaveClass('holiday-dot--feriado');
    expect(dots[0]).toHaveTextContent('');
  });

  it('ponto facultativo tem a sua cor', () => {
    render(<HolidayDots holidays={holidaysOn(d('2026-02-16'))} />);
    expect(screen.getByRole('button', { name: 'Ponto facultativo: Carnaval (16/02)' })).toHaveClass(
      'holiday-dot--facultativo',
    );
  });

  it('clicar abre o modal com os feriados e Escape fecha', async () => {
    const user = userEvent.setup();
    render(<HolidayDots holidays={holidaysOn(d('2026-11-15'))} />);
    await user.click(screen.getByRole('button', { name: 'Feriado: Proclamação da República (15/11)' }));
    expect(screen.getByRole('dialog', { name: 'Feriados' })).toHaveTextContent('Proclamação da República');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('versão decorativa não tem botão', () => {
    const { container } = render(<HolidayDots holidays={holidaysOn(d('2026-11-15'))} decorative />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('.holiday-dot--feriado')).not.toBeNull();
  });
});
