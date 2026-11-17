import type { AnyExtension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';

export const EDITOR_PLACEHOLDER = 'Escreva os detalhes da tarefa. Use a barra acima para criar listas e checklists.';

/** Nome acessível do checkbox de cada item do checklist. */
export function checkboxLabel(text: string, checked: boolean): string {
  return `${checked ? 'Concluído' : 'Pendente'}: ${text.trim() || 'item vazio'}`;
}

/**
 * Extensões do editor. Precisam produzir só o que a whitelist de
 * `@quadro/shared` (richDoc) aceita:
 * - títulos limitados a 1–3;
 * - Link desligado (nada de href no conteúdo);
 * - sem `textDirection`, que acrescentaria o atributo `dir` em todo nó.
 */
export function createEditorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => checkboxLabel(node.textContent, checked) },
    }),
    Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),
  ];
}
