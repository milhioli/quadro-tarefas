import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AGENDA_VIEW_STORAGE_KEY } from '../../lib/agenda';
import { boardColumns } from '../../lib/board';
import { parseIsoDate } from '../../lib/calendar';
import { eventsByDay } from '../../lib/calendarEvents';
import { makeTask } from '../../test/fakeApi';
import { MobileAgenda } from './MobileAgenda';

const d = (iso: string) => parseIsoDate(iso) as Date;
// Terça, 17/11/2026.
const columns = boardColumns(d('2026-11-17'));
const tasks = [
  makeTask({ id: 1, title: 'Academia', day: 1, slot: 4 }),
  makeTask({ id: 2, title: 'Reunião', day: 3, slot: 10 }),
  makeTask({ id: 3, title: 'Comprar pão' }),
];

function renderAgenda(props: Partial<Parameters<typeof MobileAgenda>[0]> = {}) {
  const onOpenTask = vi.fn();
  const onCreateAt = vi.fn();
  const utils = render(
    <MobileAgenda tasks={tasks} columns={columns} onOpenTask={onOpenTask} onCreateAt={onCreateAt} {...props} />,
  );
  return { ...utils, onOpenTask, onCreateAt, user: userEvent.setup() };
}

const tag = (name: string) => screen.getByRole('button', { name });

describe('MobileAgenda', () => {
  it('abre em "Dia", no dia de hoje, com as tarefas sem horário embaixo', () => {
    renderAgenda();
    expect(tag('Dia')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'Ter 17/11 hoje' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: 'Terça, 17/11 · hoje' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '07:00 – 07:30 Academia' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Sem horário (1)' })).getByRole('button', { name: 'Comprar pão' })).toBeInTheDocument();
  });

  it('trocar de aba mostra outro dia', async () => {
    const { user } = renderAgenda();
    await user.click(screen.getByRole('tab', { name: 'Qui 19/11' }));
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Reunião/ })).toBeInTheDocument();
  });

  it('"Dia completo" mostra as faixas livres e cria naquele horário', async () => {
    const { user, onCreateAt } = renderAgenda();
    await user.click(tag('Dia completo'));
    expect(tag('Dia completo')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Agendar em Terça 17/11, 05:00 – 05:30' }));
    expect(onCreateAt).toHaveBeenCalledWith({ day: 1, slot: 0 });
  });

  it('"Semana" troca as abas pela lista dos cinco dias', async () => {
    const { user } = renderAgenda();
    await user.click(tag('Semana'));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Qui 19/11' })).toHaveTextContent('Reunião');
    expect(screen.getByRole('region', { name: 'Sem horário (1)' })).toBeInTheDocument();
  });

  it('lembra a visualização escolhida ao reabrir', async () => {
    const first = renderAgenda();
    await first.user.click(tag('Semana'));
    expect(window.localStorage.getItem(AGENDA_VIEW_STORAGE_KEY)).toBe('week');
    first.unmount();

    renderAgenda();
    expect(tag('Semana')).toHaveAttribute('aria-pressed', 'true');
  });

  it('valor estranho salvo no storage volta para "Dia"', () => {
    window.localStorage.setItem(AGENDA_VIEW_STORAGE_KEY, 'toString');
    renderAgenda();
    expect(tag('Dia')).toHaveAttribute('aria-pressed', 'true');
  });

  it('no dia de feriado o painel mostra a bolinha clicável', async () => {
    const { user } = renderAgenda({ columns: boardColumns(d('2026-11-20')) });
    const panel = screen.getByRole('tabpanel');
    await user.click(within(panel).getByRole('button', { name: 'Feriado: Dia Nacional de Zumbi e da Consciência Negra (20/11)' }));
    expect(screen.getByRole('dialog', { name: 'Feriados' })).toBeInTheDocument();
  });

  it('dia com agenda: bolinha roxa no painel e marca na aba', async () => {
    const start = new Date(2026, 10, 17, 9).toISOString();
    const end = new Date(2026, 10, 17, 10).toISOString();
    const events = eventsByDay([{ id: 'a', title: 'Dentista', start, end, allDay: false }], columns);
    const { user } = renderAgenda({ eventsByDay: events });
    expect(screen.getByRole('tab', { name: 'Ter 17/11 hoje, com agenda' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Agenda: 1 evento em Terça, 17/11' }));
    expect(screen.getByRole('dialog', { name: 'Agenda · Terça, 17/11' })).toHaveTextContent('Dentista09:00 – 10:00');
  });

  it('tocar numa tarefa abre a edição', async () => {
    const { user, onOpenTask } = renderAgenda();
    await user.click(screen.getByRole('button', { name: 'Comprar pão' }));
    expect(onOpenTask).toHaveBeenCalledWith(3);
  });
});
