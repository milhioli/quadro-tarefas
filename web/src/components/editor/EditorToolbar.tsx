import { useEditorState, type Editor } from '@tiptap/react';
import type { MouseEvent } from 'react';

/**
 * O clique num botão não tira o foco do editor. Sem isto o botão fica com o
 * foco e o TipTap só o devolve no frame seguinte: o que for digitado nesse
 * intervalo se perde ou cai fora do bloco recém-criado (ex.: checklist).
 * Pelo teclado (Tab, Enter, Espaço) os botões continuam funcionando.
 */
export function keepEditorFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export function selectToolbarState(editor: Editor): ToolbarState {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    heading1: editor.isActive('heading', { level: 1 }),
    heading2: editor.isActive('heading', { level: 2 }),
    heading3: editor.isActive('heading', { level: 3 }),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    blockquote: editor.isActive('blockquote'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

type ToggleKey = Exclude<keyof ToolbarState, 'canUndo' | 'canRedo'>;

interface ToggleButton {
  key: ToggleKey;
  label: string;
  text: string;
  run: (editor: Editor) => void;
}

const TOGGLES: readonly ToggleButton[] = [
  { key: 'bold', label: 'Negrito', text: 'N', run: (e) => e.chain().focus().toggleBold().run() },
  { key: 'italic', label: 'Itálico', text: 'I', run: (e) => e.chain().focus().toggleItalic().run() },
  { key: 'strike', label: 'Riscado', text: 'S', run: (e) => e.chain().focus().toggleStrike().run() },
  { key: 'heading1', label: 'Título 1', text: 'T1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { key: 'heading2', label: 'Título 2', text: 'T2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: 'heading3', label: 'Título 3', text: 'T3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { key: 'bulletList', label: 'Lista com marcadores', text: '•', run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'orderedList', label: 'Lista numerada', text: '1.', run: (e) => e.chain().focus().toggleOrderedList().run() },
  {
    key: 'taskList',
    label: 'Lista de tarefas (checkbox)',
    text: '☑',
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  { key: 'blockquote', label: 'Citação', text: '❝', run: (e) => e.chain().focus().toggleBlockquote().run() },
];

/** Barra de formatação em pt-BR. O estado ativo de cada botão vem do editor. */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({ editor, selector: ({ editor: current }) => selectToolbarState(current) });

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatação do texto">
      {TOGGLES.map((button) => (
        <button
          key={button.key}
          type="button"
          className="editor-toolbar__button"
          aria-label={button.label}
          title={button.label}
          aria-pressed={state[button.key]}
          onMouseDown={keepEditorFocus}
          onClick={() => button.run(editor)}
        >
          <span aria-hidden="true">{button.text}</span>
        </button>
      ))}
      <span className="editor-toolbar__separator" aria-hidden="true" />
      <button
        type="button"
        className="editor-toolbar__button"
        aria-label="Desfazer"
        title="Desfazer"
        disabled={!state.canUndo}
        onMouseDown={keepEditorFocus}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <span aria-hidden="true">↶</span>
      </button>
      <button
        type="button"
        className="editor-toolbar__button"
        aria-label="Refazer"
        title="Refazer"
        disabled={!state.canRedo}
        onMouseDown={keepEditorFocus}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <span aria-hidden="true">↷</span>
      </button>
    </div>
  );
}
