import { emptyDoc, type RichDoc, type Task } from '@quadro/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { boardColumns } from '../lib/board';
import { parseIsoDate } from '../lib/calendar';
import { createFakeApi, makeTask } from '../test/fakeApi';
import { renderWithProviders } from '../test/render';
import { TaskModal } from './TaskModal';

const columns = boardColumns(parseIsoDate('2026-11-13') as Date);

const checklist: RichDoc = {
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'leite' }] }] },
      ],
    },
  ],
};

interface SetupOptions {
  /** Estado do "servidor" (API fake). Padrão: só a tarefa em edição. */
  apiTasks?: Task[];
  /** O que o modal acha que está no quadro (prop `tasks`). Padrão: igual ao servidor. */
  knownTasks?: Task[];
  initialPosition?: { day: number; slot: number };
}

function setup(task?: Task, options: SetupOptions = {}) {
  const onClose = vi.fn();
  const onNotify = vi.fn();
  const apiTasks = options.apiTasks ?? (task ? [task] : []);
  const api = createFakeApi(apiTasks);
  const utils = renderWithProviders(
    <TaskModal
      task={task}
      columns={columns}
      tasks={options.knownTasks ?? apiTasks}
      initialPosition={options.initialPosition}
      onClose={onClose}
      onNotify={onNotify}
    />,
    { api },
  );
  return { ...utils, onClose, onNotify };
}

const titleInput = () => screen.getByRole('textbox', { name: 'Título' });
const daySelect = () => screen.getByRole('combobox', { name: 'Dia' });
const slotSelect = () => screen.getByRole('combobox', { name: 'Horário' });
const endSelect = () => screen.getByRole('combobox', { name: 'Até' });
const createArgs = (api: ReturnType<typeof createFakeApi>) =>
  // args = [boardId, input]
  api.calls.filter((c) => c.method === 'createTask').map((c) => c.args[1]);

describe('TaskModal — criação', () => {
  it('abre como "Nova tarefa" com o foco no título e sem horário', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Nova tarefa' })).toBeInTheDocument();
    expect(titleInput()).toHaveFocus();
    expect(daySelect()).toHaveValue('');
    expect(slotSelect()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
  });

  it('cria a tarefa com título, cor e conteúdo, sem horário', async () => {
    const { api, user, onClose, onNotify } = setup();
    await user.type(titleInput(), '  Comprar pão  ');
    await user.click(screen.getByRole('radio', { name: 'Azul' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createArgs(api)).toEqual([{ title: 'Comprar pão', color: 'azul', content: emptyDoc() }]);
    expect(onNotify).toHaveBeenCalledWith('Tarefa criada');
  });

  it('cria já agendada no dia e horário escolhidos', async () => {
    const { api, user, onClose } = setup();
    await user.type(titleInput(), 'Academia');
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    await user.selectOptions(slotSelect(), '06:00 – 06:30');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createArgs(api)).toEqual([
      { title: 'Academia', color: 'amarelo', content: emptyDoc(), position: { kind: 'cell', day: 0, slot: 2 } },
    ]);
    expect(api.tasks[0]).toMatchObject({ title: 'Academia', day: 0, slot: 2 });
  });

  it('dia sem horário mostra "Escolha um horário" e não chama a API', async () => {
    const { api, user, onClose } = setup();
    await user.type(titleInput(), 'Ler');
    await user.selectOptions(daySelect(), 'Terça, 10/11');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(slotSelect()).toHaveAccessibleDescription('Escolha um horário');
    expect(api.calls).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cria com duração: das 05:00 às 20:00 manda span 30', async () => {
    const { api, user, onClose } = setup();
    await user.type(titleInput(), 'Plantão');
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    await user.selectOptions(slotSelect(), '05:00 – 05:30');
    await user.selectOptions(endSelect(), '20:00 (15 h)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createArgs(api)).toEqual([
      { title: 'Plantão', color: 'amarelo', content: emptyDoc(), span: 30, position: { kind: 'cell', day: 0, slot: 0 } },
    ]);
    expect(api.tasks[0]).toMatchObject({ day: 0, slot: 0, span: 30 });
  });

  it('horário ocupado aparece desabilitado', async () => {
    const { user } = setup(undefined, { apiTasks: [makeTask({ id: 1, title: 'Reunião', day: 0, slot: 2 })] });
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    expect(within(slotSelect()).getByRole('option', { name: '06:00 – 06:30 · ocupado (Reunião)' })).toBeDisabled();
  });

  it('abre já com o horário de uma faixa livre e fecha direto sem alterações', async () => {
    const { user, onClose } = setup(undefined, { initialPosition: { day: 4, slot: 1 } });
    expect(daySelect()).toHaveValue('4');
    expect(slotSelect()).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('título vazio mostra erro e não chama a API', async () => {
    const { api, user, onClose } = setup();
    await user.type(titleInput(), '   ');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByText('Informe um título')).toBeInTheDocument();
    expect(titleInput()).toHaveAttribute('aria-invalid', 'true');
    expect(titleInput()).toHaveAccessibleDescription('Informe um título');
    expect(api.calls).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('erro de validação da API aparece no formulário e o modal continua aberto', async () => {
    const { api, user, onClose } = setup();
    api.failNext(
      'createTask',
      new ApiError(400, 'VALIDATION', 'Dados inválidos', [{ path: 'title', message: 'O título é inválido' }]),
    );
    await user.type(titleInput(), 'Ler');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível criar a tarefa. O título é inválido');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('horário que ficou ocupado (409) avisa e não cria', async () => {
    // O modal ainda não sabe do ocupante (outra aba), mas o servidor sabe.
    const occupant = makeTask({ id: 1, title: 'Outra aba', day: 0, slot: 2 });
    const { api, user, onClose } = setup(undefined, { apiTasks: [occupant], knownTasks: [] });
    await user.type(titleInput(), 'Nova');
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    await user.selectOptions(slotSelect(), '06:00 – 06:30');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível criar a tarefa. Esse horário já está ocupado',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(api.tasks.map((t) => t.title)).toEqual(['Outra aba']);
  });
});

describe('TaskModal — edição', () => {
  const task = makeTask({ id: 4, title: 'Academia', color: 'verde', content: checklist, day: 1, slot: 2 });

  it('abre preenchido, inclusive com o horário', () => {
    setup(task);
    expect(screen.getByRole('dialog', { name: 'Editar tarefa' })).toBeInTheDocument();
    expect(titleInput()).toHaveValue('Academia');
    expect(daySelect()).toHaveValue('1');
    expect(slotSelect()).toHaveValue('2');
    expect(screen.getByRole('radio', { name: 'Verde' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pendente: leite' })).not.toBeChecked();
  });

  it('salva só os campos alterados', async () => {
    const { api, user, onClose, onNotify } = setup(task);
    await user.click(screen.getByRole('radio', { name: 'Rosa' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === 'updateTask')?.args).toEqual([4, { color: 'rosa' }]);
    expect(onNotify).toHaveBeenCalledWith('Tarefa salva');
  });

  it('mudar o horário vai no mesmo PATCH', async () => {
    const { api, user, onClose } = setup(task);
    await user.selectOptions(slotSelect(), '10:00 – 10:30');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === 'updateTask')?.args).toEqual([
      4,
      { position: { kind: 'cell', day: 1, slot: 10 } },
    ]);
  });

  it('"Sem horário" manda a tarefa para o deck', async () => {
    const { api, user, onClose } = setup(task);
    await user.selectOptions(daySelect(), 'Sem horário (fica no deck)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === 'updateTask')?.args).toEqual([4, { position: { kind: 'deck' } }]);
    expect(api.tasks[0]).toMatchObject({ day: null, slot: null });
  });

  it('mudar só o "Até" manda só {span}', async () => {
    const { api, user, onClose } = setup(task);
    expect(endSelect()).toHaveValue('1');
    await user.selectOptions(endSelect(), '07:30 (1 h 30)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === 'updateTask')?.args).toEqual([4, { span: 3 }]);
    expect(api.tasks[0]).toMatchObject({ day: 1, slot: 2, span: 3 });
  });

  it('abre com a duração da tarefa e mudar início e fim vai no mesmo PATCH', async () => {
    const long = makeTask({ id: 6, title: 'Plantão', day: 0, slot: 0, span: 30 });
    const { api, user, onClose } = setup(long);
    expect(endSelect()).toHaveValue('30');
    await user.selectOptions(slotSelect(), '06:00 – 06:30');
    await user.selectOptions(endSelect(), '08:00 (2 h)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === 'updateTask')?.args).toEqual([
      6,
      { span: 4, position: { kind: 'cell', day: 0, slot: 2 } },
    ]);
  });

  it('duração que cruza a tarefa de baixo (409) avisa e nada muda', async () => {
    const below = makeTask({ id: 9, title: 'Depois', day: 1, slot: 4 });
    const { api, user, onClose } = setup(task, { apiTasks: [task, below], knownTasks: [task] });
    await user.selectOptions(endSelect(), '08:00 (2 h)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Esse horário já está ocupado');
    expect(onClose).not.toHaveBeenCalled();
    expect(api.tasks.find((t) => t.id === 4)).toMatchObject({ span: 1 });
  });

  it('mudar só o "Até" também conta como alteração pendente', async () => {
    const { user, onClose } = setup(task);
    await user.selectOptions(endSelect(), '07:00 (1 h)');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('alertdialog', { name: 'Descartar alterações não salvas?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('horário que ficou ocupado (409) não muda nenhum campo', async () => {
    const occupant = makeTask({ id: 9, title: 'Ocupante', day: 0, slot: 0 });
    const { api, user, onClose } = setup(task, { apiTasks: [task, occupant], knownTasks: [task] });
    await user.type(titleInput(), ' 2');
    await user.selectOptions(daySelect(), 'Segunda, 09/11');
    await user.selectOptions(slotSelect(), '05:00 – 05:30');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar a tarefa. Esse horário já está ocupado',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(api.tasks.find((t) => t.id === 4)).toMatchObject({ title: 'Academia', day: 1, slot: 2 });
  });

  it('marcar um item do checklist envia o conteúdo novo', async () => {
    const { api, user, onClose } = setup(task);
    await user.click(screen.getByRole('checkbox', { name: 'Pendente: leite' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [, patch] = api.calls.find((c) => c.method === 'updateTask')?.args as [number, { content?: RichDoc }];
    expect(Object.keys(patch)).toEqual(['content']);
    expect(patch.content?.content?.[0]?.content?.[0]?.attrs).toEqual({ checked: true });
  });

  it('salvar sem mudanças só fecha', async () => {
    const { api, user, onClose } = setup(task);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.calls).toHaveLength(0);
  });

  it('excluir pede confirmação e remove', async () => {
    const { api, user, onClose, onNotify } = setup(task);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Excluir tarefa?' });
    expect(confirm).toHaveAccessibleDescription('“Academia” será excluída. Esta ação não pode ser desfeita.');
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.tasks).toEqual([]);
    expect(onNotify).toHaveBeenCalledWith('Tarefa excluída');
  });

  it('cancelar a exclusão mantém a tarefa', async () => {
    const { api, user, onClose } = setup(task);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.tasks).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TaskModal — fechar', () => {
  it('sem alterações, Cancelar fecha direto', async () => {
    const { user, onClose } = setup(makeTask({ id: 1 }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mudar só o horário também conta como alteração pendente', async () => {
    const { user, onClose } = setup(makeTask({ id: 1 }));
    await user.selectOptions(daySelect(), 'Quarta, 11/11');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('alertdialog', { name: 'Descartar alterações não salvas?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('com alterações, pergunta antes de descartar', async () => {
    const { user, onClose } = setup(makeTask({ id: 1, title: 'A' }));
    await user.type(titleInput(), 'BC');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    const confirm = screen.getByRole('alertdialog', { name: 'Descartar alterações não salvas?' });
    await user.click(within(confirm).getByRole('button', { name: 'Continuar editando' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(titleInput()).toHaveValue('ABC');

    await user.keyboard('{Escape}');
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Descartar alterações não salvas?' })).getByRole('button', {
        name: 'Descartar',
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
