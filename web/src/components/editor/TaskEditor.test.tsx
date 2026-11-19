import { emptyDoc, validateRichDoc, type RichDoc } from '@quadro/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskEditor } from './TaskEditor';

const checklist: RichDoc = {
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'feito' }] }] },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pendente' }] }],
        },
      ],
    },
  ],
};

function lastDoc(onChange: ReturnType<typeof vi.fn>): RichDoc {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as RichDoc;
}

describe('TaskEditor', () => {
  it('renderiza a toolbar e uma caixa de texto rotulada', () => {
    render(
      <>
        <span id="rotulo">Detalhes</span>
        <TaskEditor initialContent={emptyDoc()} onChange={() => {}} labelledBy="rotulo" />
      </>,
    );
    expect(screen.getByRole('toolbar', { name: 'Formatação do texto' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Detalhes' })).toHaveAttribute('contenteditable', 'true');
  });

  it('não injeta <style> no documento (a CSP do HTML bloquearia; as regras estão no app.css)', () => {
    render(<TaskEditor initialContent={emptyDoc()} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Detalhes da tarefa' })).toBeInTheDocument();
    expect(document.querySelector('style[data-tiptap-style]')).toBeNull();
  });

  it('sem rótulo externo usa "Detalhes da tarefa"', () => {
    render(<TaskEditor initialContent={emptyDoc()} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Detalhes da tarefa' })).toBeInTheDocument();
  });

  it('mostra o checklist inicial com checkboxes nomeados em pt-BR', () => {
    render(<TaskEditor initialContent={checklist} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Concluído: feito' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pendente: pendente' })).not.toBeChecked();
  });

  it('marcar um item avisa o novo conteúdo', async () => {
    const onChange = vi.fn();
    render(<TaskEditor initialContent={checklist} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Pendente: pendente' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const doc = lastDoc(onChange);
    expect(validateRichDoc(doc)).toBeNull();
    const items = doc.content?.[0]?.content ?? [];
    expect(items.map((item) => item.attrs?.checked)).toEqual([true, true]);
  });

  it('o botão de checklist da toolbar gera um taskList válido', async () => {
    const onChange = vi.fn();
    render(<TaskEditor initialContent={emptyDoc()} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lista de tarefas (checkbox)' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const doc = lastDoc(onChange);
    expect(doc.content?.[0]?.type).toBe('taskList');
    expect(validateRichDoc(doc)).toBeNull();
  });

  it('conteúdo de texto é exibido como texto', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }],
    };
    const { container } = render(<TaskEditor initialContent={doc} onChange={() => {}} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
