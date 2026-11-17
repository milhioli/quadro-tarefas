import type { RichDoc } from '@quadro/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { EditorToolbar } from './EditorToolbar';
import { createEditorExtensions } from './extensions';

export interface TaskEditorProps {
  /** Conteúdo ao abrir. Mudanças posteriores nesta prop são ignoradas. */
  initialContent: RichDoc;
  onChange: (doc: RichDoc) => void;
  /** id do rótulo visível do campo. */
  labelledBy?: string;
}

/**
 * Editor rico da tarefa. O conteúdo é sempre o JSON do ProseMirror,
 * renderizado pelo próprio editor; nunca HTML montado à mão.
 */
export function TaskEditor({ initialContent, onChange, labelledBy }: TaskEditorProps) {
  const [extensions] = useState(createEditorExtensions);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const labelAttribute: Record<string, string> = labelledBy
    ? { 'aria-labelledby': labelledBy }
    : { 'aria-label': 'Detalhes da tarefa' };

  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'task-editor__content',
        role: 'textbox',
        'aria-multiline': 'true',
        ...labelAttribute,
      },
    },
    onUpdate: ({ editor: current }) => {
      onChangeRef.current(current.getJSON() as RichDoc);
    },
  });

  return (
    <div className="task-editor">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
