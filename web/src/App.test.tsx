import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App, announcements, resetNoticeText } from './App';
import { ApiError } from './api/client';
import { fixedClock } from './lib/clock';
import { createFakeApi, makeTask } from './test/fakeApi';
import { renderWithProviders } from './test/render';
import { setViewport } from './test/viewport';

// Sexta-feira, 13/11/2026, meio-dia local.
const clock = fixedClock(new Date(2026, 10, 13, 12));

function setup(tasks = [makeTask({ id: 1, title: 'No deck' }), makeTask({ id: 2, title: 'No quadro', day: 4, slot: 0 })]) {
  const api = createFakeApi(tasks);
  return renderWithProviders(<App clock={clock} />, { api });
}

const resetButton = () => screen.getByRole('button', { name: 'Resetar quadro' });

/**
 * O aviso (toast) do App. O DndContext também injeta um live region com
 * role="status", então a busca filtra pelo elemento do aviso.
 */
function infoNotice(): HTMLElement {
  const found = screen.getAllByRole('status').find((element) => element.classList.contains('notice'));
  if (!found) throw new Error('Aviso do App não encontrado');
  return found;
}

describe('App', () => {
  it('carrega e mostra deck, quadro e calendário', async () => {
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando tarefas…');

    const deck = await screen.findByRole('region', { name: 'Tarefas (1)' });
    expect(within(deck).getByRole('button', { name: /No deck/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Quadro de tarefas' })).toBeInTheDocument();
    expect(screen.getByText('Novembro de 2026 · Semana 2 de 5')).toBeInTheDocument();
    expect(screen.getByText('Hoje: sexta-feira, 13/11')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Sex 13/11' })).toHaveAttribute('aria-current', 'date');

    const cell = screen.getByRole('cell', { name: 'Sexta 13/11, 05:00 – 05:30' });
    expect(within(cell).getByRole('button', { name: /No quadro/ })).toBeInTheDocument();
  });

  it('mostra o erro de carregamento e recarrega ao clicar em "Tentar novamente"', async () => {
    const api = createFakeApi([makeTask({ id: 1, title: 'Voltou' })]);
    api.failNext('listTasks');
    const { user } = renderWithProviders(<App clock={clock} />, { api });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar as tarefas. Erro interno. Tente novamente.');
    await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('button', { name: /Voltou/ })).toBeInTheDocument();
  });

  it('cria uma tarefa pelo modal e ela entra no deck', async () => {
    const { user } = setup([]);
    await screen.findByRole('region', { name: 'Tarefas (0)' });

    await user.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova tarefa' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Título' }), 'Estudar TypeScript');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    const deck = await screen.findByRole('region', { name: 'Tarefas (1)' });
    expect(within(deck).getByRole('button', { name: /Estudar TypeScript/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(infoNotice()).toHaveTextContent('Tarefa criada');
  });

  it('clicar num cartão abre a edição da tarefa', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /No deck/ }));
    const dialog = screen.getByRole('dialog', { name: 'Editar tarefa' });
    expect(within(dialog).getByRole('textbox', { name: 'Título' })).toHaveValue('No deck');
  });

  it('"Resetar quadro" fica desabilitado com o quadro vazio', async () => {
    setup([makeTask({ id: 1 })]);
    await screen.findByRole('region', { name: 'Tarefas (1)' });
    expect(resetButton()).toBeDisabled();
  });

  it('resetar pede confirmação; cancelar não muda nada e confirmar devolve tudo ao deck', async () => {
    const { api, user } = setup();
    await screen.findByRole('region', { name: 'Tarefas (1)' });
    expect(resetButton()).toBeEnabled();

    await user.click(resetButton());
    await user.click(within(screen.getByRole('alertdialog', { name: 'Resetar o quadro?' })).getByRole('button', { name: 'Cancelar' }));
    expect(api.calls.some((c) => c.method === 'resetBoard')).toBe(false);
    expect(screen.getByRole('region', { name: 'Tarefas (1)' })).toBeInTheDocument();

    await user.click(resetButton());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Resetar' }));

    expect(await screen.findByRole('region', { name: 'Tarefas (2)' })).toBeInTheDocument();
    expect(infoNotice()).toHaveTextContent('1 tarefa voltou para o deck.');
    expect(within(screen.getByRole('cell', { name: 'Sexta 13/11, 05:00 – 05:30' })).queryByRole('button')).toBeNull();
    await waitFor(() => expect(resetButton()).toBeDisabled());
  });

  it('erro no reset aparece como alerta', async () => {
    const { api, user } = setup();
    await screen.findByRole('region', { name: 'Tarefas (1)' });
    api.failNext('resetBoard');
    await user.click(resetButton());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Resetar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível resetar o quadro. Erro interno. Tente novamente.');
  });

  it('excluir uma tarefa do quadro libera a célula', async () => {
    const { user } = setup();
    const cell = await screen.findByRole('cell', { name: 'Sexta 13/11, 05:00 – 05:30' });
    await user.click(within(cell).getByRole('button', { name: /No quadro/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Editar tarefa' })).getByRole('button', { name: 'Excluir' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Excluir tarefa?' })).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(within(cell).queryByRole('button')).toBeNull());
    expect(infoNotice()).toHaveTextContent('Tarefa excluída');
    expect(resetButton()).toBeDisabled();
  });
});

describe('App — agenda da Apple', () => {
  const dentist = {
    id: 'e1',
    title: 'Dentista',
    start: new Date(2026, 10, 13, 9).toISOString(),
    end: new Date(2026, 10, 13, 10).toISOString(),
    allDay: false,
  };

  it('desligada no servidor: nenhuma bolinha roxa e pede a semana mostrada', async () => {
    const { api } = setup();
    await screen.findByRole('region', { name: 'Tarefas (1)' });
    await waitFor(() => expect(api.calls.some((c) => c.method === 'listCalendarEvents')).toBe(true));
    expect(api.calls.find((c) => c.method === 'listCalendarEvents')?.args).toEqual(['2026-11-09']);
    expect(screen.queryByRole('button', { name: /^Agenda:/ })).not.toBeInTheDocument();
  });

  it('ligada: bolinha roxa no dia do evento, que abre a lista com o horário', async () => {
    const api = createFakeApi([makeTask({ id: 1 })]);
    api.setCalendar({ enabled: true, events: [dentist] });
    const { user } = renderWithProviders(<App clock={clock} />, { api });
    const dot = await screen.findByRole('button', { name: 'Agenda: 1 evento em Sexta, 13/11' });
    await user.click(dot);
    expect(screen.getByRole('dialog', { name: 'Agenda · Sexta, 13/11' })).toHaveTextContent('Dentista09:00 – 10:00');
  });

  it('erro da agenda não quebra o quadro e aparece no topo', async () => {
    const api = createFakeApi([makeTask({ id: 1, title: 'Continua aqui' })]);
    api.failNext(
      'listCalendarEvents',
      new ApiError(502, 'UPSTREAM_AUTH', 'A Apple recusou a senha de app. Gere outra em account.apple.com.'),
    );
    renderWithProviders(<App clock={clock} />, { api });
    expect(await screen.findByRole('button', { name: /Continua aqui/ })).toBeInTheDocument();
    expect(
      await screen.findByText('Agenda da Apple indisponível. A Apple recusou a senha de app. Gere outra em account.apple.com.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('no celular a bolinha aparece no painel do dia', async () => {
    setViewport('mobile');
    const api = createFakeApi([makeTask({ id: 1 })]);
    api.setCalendar({ enabled: true, events: [dentist] });
    renderWithProviders(<App clock={clock} />, { api });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByRole('button', { name: 'Agenda: 1 evento em Sexta, 13/11' })).toBeInTheDocument();
  });
});

describe('App — horário pelo modal (desktop)', () => {
  it('escolher dia e horário ao criar agenda a tarefa sem arraste', async () => {
    const { user } = setup([]);
    await screen.findByRole('region', { name: 'Tarefas (0)' });

    await user.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova tarefa' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Título' }), 'Dentista');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Dia' }), 'Quarta, 11/11');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Horário' }), '08:00 – 08:30');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    const cell = await screen.findByRole('cell', { name: 'Quarta 11/11, 08:00 – 08:30' });
    await waitFor(() => expect(within(cell).getByRole('button', { name: /Dentista/ })).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Tarefas (0)' })).toBeInTheDocument();
  });
});

describe('App — celular', () => {
  it('mostra as tags e a agenda no lugar do quadro', async () => {
    setViewport('mobile');
    setup();
    expect(await screen.findByRole('group', { name: 'Visualização' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sex 13/11 hoje' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: '05:00 – 05:30 No quadro' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Sem horário (1)' })).getByRole('button', { name: 'No deck' }),
    ).toBeInTheDocument();
  });

  it('"+ livre" abre "Nova tarefa" com o horário e a tarefa aparece na agenda', async () => {
    setViewport('mobile');
    const { user } = setup();
    await screen.findByRole('group', { name: 'Visualização' });
    await user.click(screen.getByRole('button', { name: 'Dia completo' }));
    await user.click(screen.getByRole('button', { name: 'Agendar em Sexta 13/11, 05:30 – 06:00' }));

    const dialog = screen.getByRole('dialog', { name: 'Nova tarefa' });
    expect(within(dialog).getByRole('combobox', { name: 'Dia' })).toHaveValue('4');
    expect(within(dialog).getByRole('combobox', { name: 'Horário' })).toHaveValue('1');
    await user.type(within(dialog).getByRole('textbox', { name: 'Título' }), 'Café');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('button', { name: '05:30 – 06:00 Café' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tocar numa tarefa da agenda abre a edição', async () => {
    setViewport('mobile');
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'No deck' }));
    expect(screen.getByRole('dialog', { name: 'Editar tarefa' })).toBeInTheDocument();
  });

  it('voltar para a tela larga mostra o quadro de novo', async () => {
    setViewport('mobile');
    setup();
    await screen.findByRole('group', { name: 'Visualização' });
    act(() => setViewport('desktop'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Visualização' })).not.toBeInTheDocument();
  });
});

describe('textos do App', () => {
  it('resetNoticeText', () => {
    expect(resetNoticeText(0)).toBe('O quadro já estava vazio.');
    expect(resetNoticeText(1)).toBe('1 tarefa voltou para o deck.');
    expect(resetNoticeText(3)).toBe('3 tarefas voltaram para o deck.');
  });

  it('anúncios de arraste em pt-BR', () => {
    const active = { id: 'task:1' } as never;
    expect(announcements.onDragStart({ active })).toBe('Tarefa selecionada para mover.');
    expect(announcements.onDragOver({ active, over: { id: 'deck' } as never })).toBe('Sobre o deck de tarefas.');
    expect(announcements.onDragEnd({ active, over: { id: 'cell:0:0' } as never })).toBe(
      'Tarefa solta em Segunda, 05:00 – 05:30.',
    );
    expect(announcements.onDragEnd({ active, over: null })).toBe('Tarefa solta fora do quadro. Nada mudou.');
    expect(announcements.onDragCancel({ active, over: null })).toBe('Movimento cancelado. Nada mudou.');
  });
});
