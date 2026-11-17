import {
  DEFAULT_COLOR,
  TITLE_MAX_LENGTH,
  emptyDoc,
  isRichDoc,
  titleSchema,
  validateRichDoc,
  type MoveTarget,
  type RichDoc,
  type Task,
  type TaskColor,
  type UpdateTaskInput,
} from '@quadro/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { describeError } from '../api/client';
import { useCreateTask, useDeleteTask, useUpdateTask } from '../api/queries';
import type { BoardColumn } from '../lib/board';
import { ColorPicker } from './ColorPicker';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import { TaskEditor } from './editor/TaskEditor';

export interface TaskModalProps {
  /** Tarefa a editar. Sem ela, o modal cria uma nova. */
  task?: Task;
  /** Colunas da semana mostrada (dias e datas do seletor de horário). */
  columns: readonly BoardColumn[];
  /** Todas as tarefas, para saber quais horários estão ocupados. */
  tasks: readonly Task[];
  /** Criação já com horário (ex.: tocar numa faixa livre da agenda). */
  initialPosition?: { day: number; slot: number };
  onClose: () => void;
  /** Mensagem de sucesso para o aviso do App. */
  onNotify?: (message: string) => void;
}

interface Draft {
  title: string;
  color: TaskColor;
  content: RichDoc;
  position: ScheduleValue;
}

function initialDraft(task: Task | undefined, initialPosition: TaskModalProps['initialPosition']): Draft {
  const span = task?.span ?? 1;
  let position: ScheduleValue = { day: null, slot: null, span };
  if (task && task.day !== null && task.slot !== null) position = { day: task.day, slot: task.slot, span };
  else if (!task && initialPosition) position = { ...initialPosition, span };
  return {
    title: task?.title ?? '',
    color: task?.color ?? DEFAULT_COLOR,
    // Defesa em profundidade: só entrega ao editor conteúdo que passa na whitelist.
    content: task && isRichDoc(task.content) ? task.content : emptyDoc(),
    position,
  };
}

function toTarget(position: ScheduleValue): MoveTarget {
  return position.day === null || position.slot === null
    ? { kind: 'deck' }
    : { kind: 'cell', day: position.day, slot: position.slot };
}

export function TaskModal({ task, columns, tasks, initialPosition, onClose, onNotify }: TaskModalProps) {
  const [initial] = useState(() => initialDraft(task, initialPosition));
  const [initialContentJson] = useState(() => JSON.stringify(initial.content));
  const [title, setTitle] = useState(initial.title);
  const [color, setColor] = useState<TaskColor>(initial.color);
  const [content, setContent] = useState<RichDoc>(initial.content);
  const [position, setPosition] = useState<ScheduleValue>(initial.position);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const titleId = useId();
  const titleErrorId = useId();
  const detailsLabelId = useId();

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const saving = createTask.isPending || updateTask.isPending;
  const deleting = deleteTask.isPending;
  const busy = saving || deleting;

  const contentChanged = JSON.stringify(content) !== initialContentJson;
  const positionChanged = position.day !== initial.position.day || position.slot !== initial.position.slot;
  const spanChanged = position.span !== initial.position.span;
  const dirty = title !== initial.title || color !== initial.color || contentChanged || positionChanged || spanChanged;

  function requestClose(): void {
    if (busy) return;
    if (dirty) setConfirm('discard');
    else onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const parsedTitle = titleSchema.safeParse(title);
    if (!parsedTitle.success) {
      setTitleError(parsedTitle.error.issues[0]?.message ?? 'Informe um título');
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    if (position.day !== null && position.slot === null) {
      setScheduleError('Escolha um horário');
      return;
    }
    setScheduleError(null);
    if (validateRichDoc(content) !== null) {
      setFormError('O conteúdo tem elementos não suportados e não pode ser salvo.');
      return;
    }

    if (!task) {
      const target = toTarget(position);
      createTask.mutate(
        {
          title: parsedTitle.data,
          color,
          content,
          // Só manda o que difere do padrão (span 1, deck).
          ...(position.span > 1 ? { span: position.span } : {}),
          ...(target.kind === 'cell' ? { position: target } : {}),
        },
        {
          onSuccess: () => {
            onNotify?.('Tarefa criada');
            onClose();
          },
          onError: (error) => setFormError(describeError(error, 'Não foi possível criar a tarefa')),
        },
      );
      return;
    }

    // PATCH só com o que mudou (horário e duração vão na mesma requisição: tudo ou nada).
    const patch: UpdateTaskInput = {};
    if (parsedTitle.data !== task.title) patch.title = parsedTitle.data;
    if (color !== initial.color) patch.color = color;
    if (contentChanged) patch.content = content;
    if (spanChanged) patch.span = position.span;
    if (positionChanged) patch.position = toTarget(position);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    updateTask.mutate(
      { id: task.id, patch },
      {
        onSuccess: () => {
          onNotify?.('Tarefa salva');
          onClose();
        },
        onError: (error) => setFormError(describeError(error, 'Não foi possível salvar a tarefa')),
      },
    );
  }

  function confirmDelete(): void {
    if (!task) return;
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        onNotify?.('Tarefa excluída');
        onClose();
      },
      onError: (error) => {
        setConfirm(null);
        setFormError(describeError(error, 'Não foi possível excluir a tarefa'));
      },
    });
  }

  return (
    <>
      <Modal
        title={task ? 'Editar tarefa' : 'Nova tarefa'}
        onClose={requestClose}
        size="large"
        initialFocusRef={titleRef}
        footer={
          <>
            {task ? (
              <button
                type="button"
                className="button button--danger-ghost"
                onClick={() => setConfirm('delete')}
                disabled={busy}
              >
                Excluir
              </button>
            ) : null}
            <span className="modal__spacer" />
            <button type="button" className="button" onClick={requestClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form={formId} className="button button--primary" disabled={busy}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        }
      >
        <form id={formId} className="task-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={titleId} className="field__label">
              Título
            </label>
            <input
              id={titleId}
              ref={titleRef}
              className="input"
              type="text"
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              autoComplete="off"
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? titleErrorId : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(null);
              }}
            />
            {titleError ? (
              <p id={titleErrorId} className="field__error">
                {titleError}
              </p>
            ) : null}
          </div>

          <SchedulePicker
            columns={columns}
            tasks={tasks}
            selfId={task?.id}
            value={position}
            error={scheduleError}
            onChange={(next) => {
              setPosition(next);
              if (scheduleError) setScheduleError(null);
            }}
          />

          <ColorPicker value={color} onChange={setColor} />

          <div className="field">
            <span id={detailsLabelId} className="field__label">
              Detalhes
            </span>
            <TaskEditor initialContent={initial.content} onChange={setContent} labelledBy={detailsLabelId} />
          </div>

          {formError ? (
            <p role="alert" className="form-error">
              {formError}
            </p>
          ) : null}
        </form>
      </Modal>

      {/* Irmãos do Modal, não filhos: os eventos não borbulham pela árvore do diálogo de baixo. */}
      {confirm === 'discard' ? (
        <ConfirmDialog
          title="Descartar alterações não salvas?"
          message="As mudanças feitas nesta tarefa serão perdidas."
          confirmLabel="Descartar"
          cancelLabel="Continuar editando"
          danger
          onConfirm={onClose}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm === 'delete' && task ? (
        <ConfirmDialog
          title="Excluir tarefa?"
          message={`“${task.title}” será excluída. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          danger
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
