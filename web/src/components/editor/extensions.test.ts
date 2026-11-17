import { ALLOWED_MARK_TYPES, ALLOWED_NODE_TYPES, validateRichDoc, type RichNode } from '@quadro/shared';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { checkboxLabel, createEditorExtensions } from './extensions';

/**
 * De-risk: o JSON que o editor configurado realmente gera precisa passar na
 * whitelist do servidor. Se uma extensão mudar e passar a emitir um atributo
 * ou nó novo, este teste quebra antes do usuário perder um salvamento.
 */

const editors: Editor[] = [];

function makeEditor(content?: string | JSONContent): Editor {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({ element, extensions: createEditorExtensions(), content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element;
    editor.destroy();
    if (element instanceof HTMLElement) element.remove();
  }
});

function collect(doc: JSONContent): { nodes: Set<string>; marks: Set<string> } {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const stack: JSONContent[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop() as JSONContent;
    if (node.type) nodes.add(node.type);
    for (const mark of node.marks ?? []) marks.add(mark.type);
    if (node.content) stack.push(...node.content);
  }
  return { nodes, marks };
}

const RICH_HTML = [
  '<h1>Título 1</h1><h2>Título 2</h2><h3>Título 3</h3>',
  '<p>Texto <strong>negrito</strong> <em>itálico</em> <s>riscado</s> <u>sublinhado</u> <code>código</code><br>quebra</p>',
  '<ul><li><p>marcador</p></li></ul>',
  '<ol start="3" type="a"><li><p>numerada</p></li></ol>',
  '<ul data-type="taskList">',
  '<li data-type="taskItem" data-checked="true"><p>feito</p></li>',
  '<li data-type="taskItem" data-checked="false"><p>pendente</p>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>aninhado</p></li></ul>',
  '</li></ul>',
  '<blockquote><p>citação</p></blockquote>',
  '<pre><code class="language-ts">const x = 1;</code></pre>',
  '<hr>',
  '<p>fim</p>',
].join('');

describe('extensões do editor × whitelist do richDoc', () => {
  it('documento vazio é válido', () => {
    expect(validateRichDoc(makeEditor().getJSON())).toBeNull();
  });

  it('todos os nós e marcas do editor passam na whitelist', () => {
    const json = makeEditor(RICH_HTML).getJSON();
    expect(validateRichDoc(json)).toBeNull();

    const { nodes, marks } = collect(json);
    expect([...nodes].sort()).toEqual([...ALLOWED_NODE_TYPES].sort());
    expect([...marks].sort()).toEqual([...ALLOWED_MARK_TYPES].sort());
  });

  it('o conteúdo salvo reabre igual no editor', () => {
    const json = makeEditor(RICH_HTML).getJSON();
    const reopened = makeEditor(json).getJSON();
    expect(reopened).toEqual(json);
  });

  it('link é descartado (extensão desligada)', () => {
    const json = makeEditor('<p><a href="https://exemplo.com" onclick="x()">clique</a></p>').getJSON();
    expect(validateRichDoc(json)).toBeNull();
    expect(collect(json).marks.has('link')).toBe(false);
    expect(JSON.stringify(json)).not.toContain('href');
  });

  it('imagem e iframe não existem no schema', () => {
    const json = makeEditor('<p>a<img src="x" onerror="alert(1)"></p><iframe src="https://x"></iframe>').getJSON();
    expect(validateRichDoc(json)).toBeNull();
    const { nodes } = collect(json);
    expect(nodes.has('image')).toBe(false);
    expect(nodes.has('iframe')).toBe(false);
    expect(JSON.stringify(json)).not.toContain('onerror');
  });

  it('h4 não vira título de nível 4', () => {
    const json = makeEditor('<h4>quatro</h4>').getJSON();
    expect(validateRichDoc(json)).toBeNull();
    const headings = (json.content ?? []).filter((n) => n.type === 'heading');
    expect(headings.every((n) => [1, 2, 3].includes(Number(n.attrs?.level)))).toBe(true);
  });

  it('atributos de estilo e eventos não entram no JSON', () => {
    const json = makeEditor('<p style="color:red" class="x" onclick="alert(1)">texto</p>').getJSON();
    expect(validateRichDoc(json)).toBeNull();
    expect(json.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'texto' }] });
  });

  it('o JSON tem o formato de RichNode', () => {
    const json = makeEditor('<p>a</p>').getJSON() as RichNode;
    expect(json.type).toBe('doc');
  });
});

describe('checkboxLabel', () => {
  it('descreve o estado e o texto do item', () => {
    expect(checkboxLabel('Comprar pão', true)).toBe('Concluído: Comprar pão');
    expect(checkboxLabel('Comprar pão', false)).toBe('Pendente: Comprar pão');
    expect(checkboxLabel('   ', false)).toBe('Pendente: item vazio');
  });
});
