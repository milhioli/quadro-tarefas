import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC,
  RICH_DOC_MAX_DEPTH,
  checklistProgress,
  emptyDoc,
  isRichDoc,
  richDocDepth,
  validateRichDoc,
  type RichNode,
} from './richDoc';

/** Documento com tudo que o editor produz (formato real do editor.getJSON()). */
const FULL_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Título' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'negrito' },
        { type: 'hardBreak', marks: [{ type: 'italic' }] },
        { type: 'text', marks: [{ type: 'italic' }, { type: 'strike' }, { type: 'underline' }], text: 'x' },
        { type: 'text', marks: [{ type: 'code' }], text: 'code' },
      ],
    },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }],
    },
    {
      type: 'orderedList',
      attrs: { start: 1, type: null },
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'feito' }] }] },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            { type: 'paragraph' },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] }] },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph' }] },
    { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'let a = 1' }] },
    { type: 'codeBlock', attrs: { language: 'c++' } },
    { type: 'horizontalRule' },
  ],
};

function nest(levels: number): RichNode {
  let node: RichNode = { type: 'paragraph' };
  for (let i = 0; i < levels - 2; i++) node = { type: 'blockquote', content: [node] };
  return { type: 'doc', content: [node] };
}

describe('validateRichDoc', () => {
  it('aceita o documento vazio e um documento completo do editor', () => {
    expect(validateRichDoc(EMPTY_DOC)).toBeNull();
    expect(validateRichDoc(emptyDoc())).toBeNull();
    expect(validateRichDoc({ type: 'doc' })).toBeNull();
    expect(validateRichDoc(FULL_DOC)).toBeNull();
    expect(isRichDoc(FULL_DOC)).toBe(true);
  });

  it('aceita orderedList.start nulo (vindo de colagem com start inválido)', () => {
    expect(validateRichDoc({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: null, type: 'a' } }] })).toBeNull();
  });

  it.each([
    ['raiz que não é doc', { type: 'paragraph' }],
    ['doc aninhado', { type: 'doc', content: [{ type: 'doc' }] }],
    ['não objeto', 'texto'],
    ['null', null],
    ['array', []],
    ['nó image', { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] }],
    ['nó iframe', { type: 'doc', content: [{ type: 'iframe' }] }],
    ['marca link', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }],
    ['marca com attrs', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold', attrs: {} }] }] }] }],
    ['attr href', { type: 'doc', content: [{ type: 'paragraph', attrs: { href: 'x' } }] }],
    ['attr onclick', { type: 'doc', content: [{ type: 'heading', attrs: { level: 1, onclick: 'alert(1)' } }] }],
    ['attr style', { type: 'doc', content: [{ type: 'taskItem', attrs: { checked: true, style: 'x' } }] }],
    ['heading level 4', { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 } }] }],
    ['checked como string', { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: 'true' } }] }] }],
    ['language com script', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: '<script>' } }] }],
    ['orderedList.type estranho', { type: 'doc', content: [{ type: 'orderedList', attrs: { type: 'disc' } }] }],
    ['chave extra no nó', { type: 'doc', content: [{ type: 'paragraph', html: '<b>x</b>' }] }],
    ['__proto__ como chave', JSON.parse('{"type":"doc","__proto__":{"polluted":true}}')],
    ['texto vazio', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }],
    ['texto não string', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 1 }] }] }],
    ['texto em nó de bloco', { type: 'doc', content: [{ type: 'paragraph', text: 'oi' }] }],
    ['conteúdo em nó folha', { type: 'doc', content: [{ type: 'horizontalRule', content: [] }] }],
    ['marcas em nó de bloco', { type: 'doc', content: [{ type: 'paragraph', marks: [{ type: 'bold' }] }] }],
    ['content que não é lista', { type: 'doc', content: { type: 'paragraph' } }],
  ])('rejeita %s', (_label, value) => {
    expect(validateRichDoc(value)).toEqual(expect.any(String));
    expect(isRichDoc(value)).toBe(false);
  });

  it(`aceita profundidade ${RICH_DOC_MAX_DEPTH} e rejeita ${RICH_DOC_MAX_DEPTH + 1}`, () => {
    expect(richDocDepth(nest(RICH_DOC_MAX_DEPTH))).toBe(RICH_DOC_MAX_DEPTH);
    expect(validateRichDoc(nest(RICH_DOC_MAX_DEPTH))).toBeNull();
    expect(validateRichDoc(nest(RICH_DOC_MAX_DEPTH + 1))).toMatch(/aninhado demais/);
  });

  it('rejeita aninhamento extremo sem estourar a pilha', () => {
    expect(validateRichDoc(nest(100_000))).toMatch(/aninhado demais/);
  });
});

describe('checklistProgress', () => {
  it('conta itens marcados e total, inclusive aninhados', () => {
    expect(checklistProgress(FULL_DOC as RichNode)).toEqual({ done: 2, total: 3 });
  });

  it('devolve zero para documento sem checklist', () => {
    expect(checklistProgress(EMPTY_DOC)).toEqual({ done: 0, total: 0 });
  });
});
