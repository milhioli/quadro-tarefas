import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { Task } from '@quadro/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeError } from './api/client';
import { useCalendarEvents, useMoveTask, useResetBoard, useTasks } from './api/queries';
import { Board } from './components/Board';
import { CalendarHeader } from './components/CalendarHeader';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Deck } from './components/Deck';
import { TaskCardView } from './components/TaskCard';
import { TaskModal } from './components/TaskModal';
import { MobileAgenda } from './components/agenda/MobileAgenda';
import { boardColumns, deckTasks, placedTasksByCell } from './lib/board';
import { isoDate } from './lib/calendar';
import { EMPTY_DAY_EVENTS, eventsByDay } from './lib/calendarEvents';
import type { Clock } from './lib/clock';
import { POINTER_ACTIVATION, describeDropTarget, dropToMove, parseTaskDragId } from './lib/dnd';
import { useMediaQuery, MOBILE_QUERY } from './lib/useMediaQuery';
import { useToday } from './lib/useToday';

export const NOTICE_TIMEOUT_MS = 5000;

/** Solta onde o ponteiro está; se ele estiver fora de tudo, usa a maior interseção. */
export const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

export const announcements: Announcements = {
  onDragStart: () => 'Tarefa selecionada para mover.',
  onDragOver: ({ over }) => (over ? `Sobre ${describeDropTarget(over.id)}.` : 'Fora de uma área de destino.'),
  onDragEnd: ({ over }) =>
    over ? `Tarefa solta em ${describeDropTarget(over.id)}.` : 'Tarefa solta fora do quadro. Nada mudou.',
  onDragCancel: () => 'Movimento cancelado. Nada mudou.',
};

export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'Pressione Enter ou Espaço para abrir a tarefa. Com o mouse, arraste para uma célula do quadro ou de volta para o deck.',
};

export function resetNoticeText(moved: number): string {
  if (moved === 0) return 'O quadro já estava vazio.';
  if (moved === 1) return '1 tarefa voltou para o deck.';
  return `${moved} tarefas voltaram para o deck.`;
}

type ModalState =
  | { kind: 'closed' }
  | { kind: 'create'; initialPosition?: { day: number; slot: number } }
  | { kind: 'edit'; task: Task };

interface Notice {
  id: number;
  tone: 'info' | 'error';
  text: string;
}

export interface AppProps {
  clock: Clock;
}

export function App({ clock }: AppProps) {
  const today = useToday(clock);
  // Celular: agenda por toque. Desktop: deck + quadro com arraste.
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const tasksQuery = useTasks();
  const moveTask = useMoveTask();
  const resetBoard = useResetBoard();

  // A edição guarda uma cópia da tarefa: o modal não desmonta no meio da exclusão.
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);

  // Só ponteiro: Enter/Espaço no cartão abrem a tarefa.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: POINTER_ACTIVATION }));

  const tasks = tasksQuery.data;
  const columns = useMemo(() => boardColumns(today), [today]);

  // Agenda da Apple da semana mostrada (desligada no servidor = nenhuma bolinha).
  const monday = isoDate(columns[0]?.date ?? today);
  const calendarQuery = useCalendarEvents(monday);
  const calendarData = calendarQuery.data;
  const calendarEvents = useMemo(
    () => (calendarData?.enabled ? eventsByDay(calendarData.events, columns) : EMPTY_DAY_EVENTS),
    [calendarData, columns],
  );
  const calendarError = calendarQuery.isError
    ? describeError(calendarQuery.error, 'Agenda da Apple indisponível')
    : null;
  const deck = useMemo(() => deckTasks(tasks ?? []), [tasks]);
  const byCell = useMemo(() => placedTasksByCell(tasks ?? []), [tasks]);
  const activeTask = activeTaskId === null ? undefined : tasks?.find((task) => task.id === activeTaskId);

  const notify = useCallback((tone: Notice['tone'], text: string) => {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
  }, []);
  const notifyInfo = useCallback((text: string) => notify('info', text), [notify]);

  useEffect(() => {
    if (!notice || notice.tone !== 'info') return undefined;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openTask = useCallback(
    (id: number) => {
      const task = tasks?.find((t) => t.id === id);
      if (task) setModal({ kind: 'edit', task });
    },
    [tasks],
  );
  const closeModal = useCallback(() => setModal({ kind: 'closed' }), []);

  function handleDragStart(event: DragStartEvent): void {
    setActiveTaskId(parseTaskDragId(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveTaskId(null);
    const intent = dropToMove(tasks ?? [], event.active.id, event.over?.id);
    if (!intent) return;
    moveTask.mutate(intent, {
      onError: (error) => notify('error', describeError(error, 'Não foi possível mover a tarefa')),
    });
  }

  function handleReset(): void {
    resetBoard.mutate(undefined, {
      onSuccess: (result) => {
        setConfirmReset(false);
        notify('info', resetNoticeText(result.moved));
      },
      onError: (error) => {
        setConfirmReset(false);
        notify('error', describeError(error, 'Não foi possível resetar o quadro'));
      },
    });
  }

  let content: ReactNode;
  if (tasks === undefined) {
    content = tasksQuery.isError ? (
      <div className="app-status app-status--error" role="alert">
        <p>{describeError(tasksQuery.error, 'Não foi possível carregar as tarefas')}</p>
        <button type="button" className="button" onClick={() => void tasksQuery.refetch()}>
          Tentar novamente
        </button>
      </div>
    ) : (
      <p className="app-status" role="status">
        Carregando tarefas…
      </p>
    );
  } else if (isMobile) {
    content = (
      <MobileAgenda
        tasks={tasks}
        columns={columns}
        onOpenTask={openTask}
        onCreateAt={(position) => setModal({ kind: 'create', initialPosition: position })}
        eventsByDay={calendarEvents}
      />
    );
  } else {
    content = (
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTaskId(null)}
        accessibility={{ announcements, screenReaderInstructions }}
      >
        <Deck tasks={deck} onOpenTask={openTask} />
        <Board columns={columns} tasksByCell={byCell} onOpenTask={openTask} eventsByDay={calendarEvents} />
        <DragOverlay dropAnimation={null}>{activeTask ? <TaskCardView task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__intro">
          <h1 className="app-title">Quadro de tarefas</h1>
          <CalendarHeader today={today} calendarError={calendarError} />
        </div>
        <div className="app-header__actions">
          <button type="button" className="button button--primary" onClick={() => setModal({ kind: 'create' })}>
            Nova tarefa
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setConfirmReset(true)}
            disabled={byCell.size === 0 || resetBoard.isPending}
          >
            Resetar quadro
          </button>
        </div>
      </header>

      <main className={isMobile ? 'app-main app-main--mobile' : 'app-main'}>{content}</main>

      {notice ? (
        <div className={`notice notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button type="button" className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      {modal.kind === 'create' ? (
        <TaskModal
          columns={columns}
          tasks={tasks ?? []}
          initialPosition={modal.initialPosition}
          onClose={closeModal}
          onNotify={notifyInfo}
        />
      ) : null}
      {modal.kind === 'edit' ? (
        <TaskModal
          key={modal.task.id}
          task={modal.task}
          columns={columns}
          tasks={tasks ?? []}
          onClose={closeModal}
          onNotify={notifyInfo}
        />
      ) : null}

      {confirmReset ? (
        <ConfirmDialog
          title="Resetar o quadro?"
          message="Todas as tarefas do quadro voltam para o deck. Nenhuma tarefa é apagada."
          confirmLabel="Resetar"
          busy={resetBoard.isPending}
          onConfirm={handleReset}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </div>
  );
}
