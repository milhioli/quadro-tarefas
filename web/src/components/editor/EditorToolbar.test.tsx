import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorToolbar, selectToolbarState } from './EditorToolbar';
import { createEditorExtensions } from './extensions';

const editors: Editor[] = [];

function setup(content = '<p>texto</p>') {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({ element, extensions: createEditorExtensions(), content });
  editors.push(editor);
  render(<EditorToolbar editor={editor} />);
  return { editor, user: userEvent.setup() };
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element;
    editor.destroy();
    if (element instanceof HTMLElement) element.remove();
  }
});

const LABELS = [
  'Negrito',
  'Itálico',
  'Riscado',
  'Título 1',
  'Título 2',
  'Título 3',
  'Lista com marcadores',
  'Lista numerada',
  'Lista de tarefas (checkbox)',
  'Citação',
];

describe('EditorToolbar', () => {
  it('tem os botões em pt-BR, todos desligados no início', () => {
    setup();
    expect(screen.getByRole('toolbar', { name: 'Formatação do texto' })).toBeInTheDocument();
    for (const label of LABELS) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refazer' })).toBeDisabled();
  });

  it('Negrito aplica a marca e fica pressionado', async () => {
    const { editor, user } = setup();
    editor.commands.selectAll();
    await user.click(screen.getByRole('button', { name: 'Negrito' }));
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Negrito' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('o clique num botão não tira o foco do editor (mousedown sem ação padrão)', async () => {
    const { editor, user } = setup();
    // view.focus() é síncrono (o focus() do TipTap espera um frame).
    editor.view.focus();
    expect(editor.view.hasFocus()).toBe(true);

    // fireEvent devolve false quando o handler chamou preventDefault.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Lista de tarefas (checkbox)' }))).toBe(false);
    // Desfazer começa desabilitado (botão desabilitado não recebe mousedown): uma edição o habilita.
    editor.commands.insertContent(' mais');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desfazer' })).toBeEnabled());
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Desfazer' }))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Lista de tarefas (checkbox)' }));
    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe('taskList');
  });

  it('Lista de tarefas cria um checklist', async () => {
    const { editor, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Lista de tarefas (checkbox)' }));
    expect(editor.getJSON().content?.[0]?.type).toBe('taskList');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lista de tarefas (checkbox)' })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('Título 2 troca o bloco atual', async () => {
    const { editor, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Título 2' }));
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('Desfazer e Refazer acompanham o histórico', async () => {
    const { editor, user } = setup();
    editor.commands.selectAll();
    await user.click(screen.getByRole('button', { name: 'Riscado' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desfazer' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(JSON.stringify(editor.getJSON())).not.toContain('"strike"');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refazer' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Refazer' }));
    expect(JSON.stringify(editor.getJSON())).toContain('"strike"');
  });

  it('selectToolbarState lê o estado do editor', () => {
    const { editor } = setup('<h1>t</h1>');
    expect(selectToolbarState(editor)).toMatchObject({ heading1: true, heading2: false, bold: false, canUndo: false });
  });
});
