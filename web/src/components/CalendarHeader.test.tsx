import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { parseIsoDate } from '../lib/calendar';
import { CalendarHeader } from './CalendarHeader';

const d = (iso: string) => parseIsoDate(iso) as Date;

describe('CalendarHeader', () => {
  it('sexta 13/11/2026: mês, semana, hoje e próximo feriado como bolinha', () => {
    render(<CalendarHeader today={d('2026-11-13')} />);
    expect(screen.getByText('Novembro de 2026 · Semana 2 de 5')).toBeInTheDocument();
    expect(screen.getByText('Hoje: sexta-feira, 13/11')).toBeInTheDocument();
    expect(screen.getByText('Próximo feriado:')).toBeInTheDocument();
    expect(screen.getByText('domingo, 15/11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feriado: Proclamação da República (15/11)' })).toHaveClass(
      'holiday-dot--feriado',
    );
    // Dia comum: nenhuma bolinha em "Hoje".
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('clicar na bolinha abre o modal com o feriado', async () => {
    render(<CalendarHeader today={d('2026-11-13')} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Feriado: Proclamação da República (15/11)' }));
    expect(screen.getByRole('dialog', { name: 'Feriados' })).toHaveTextContent('Proclamação da República');
  });

  it('num feriado, "Hoje" ganha a bolinha e o próximo aponta o seguinte', () => {
    render(<CalendarHeader today={d('2026-11-15')} />);
    expect(screen.getByText('Hoje: domingo, 15/11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feriado: Proclamação da República (15/11)' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Feriado: Dia Nacional de Zumbi e da Consciência Negra (20/11)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('sexta-feira, 20/11')).toBeInTheDocument();
  });

  it('ponto facultativo tem a sua cor', () => {
    render(<CalendarHeader today={d('2026-02-01')} />);
    expect(screen.getByRole('button', { name: 'Ponto facultativo: Carnaval (16/02)' })).toHaveClass(
      'holiday-dot--facultativo',
    );
    expect(screen.getByText('segunda-feira, 16/02')).toBeInTheDocument();
  });

  it('mostra o problema da agenda da Apple, quando houver', () => {
    render(<CalendarHeader today={d('2026-11-13')} calendarError="Agenda da Apple indisponível. A Apple recusou a senha de app." />);
    expect(screen.getByText('Agenda da Apple indisponível. A Apple recusou a senha de app.')).toBeInTheDocument();
  });

  it('no fim do ano aponta para o ano seguinte', () => {
    render(<CalendarHeader today={d('2026-12-31')} />);
    expect(screen.getByText('Dezembro de 2026 · Semana 5 de 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feriado: Confraternização Universal (01/01)' })).toBeInTheDocument();
    expect(screen.getByText('sexta-feira, 01/01')).toBeInTheDocument();
  });
});
