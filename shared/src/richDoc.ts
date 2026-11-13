/**
 * Conteúdo rico das tarefas: JSON do TipTap/ProseMirror.
 *
 * A validação é uma whitelist estrita. Só passam os nós, marcas e atributos
 * que o editor configurado realmente produz. Qualquer chave desconhecida é
 * rejeitada, para que nada além do schema do editor chegue ao banco ou à tela.
 */

export interface RichMark {
  type: string;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
}

export interface RichDoc extends RichNode {
  type: 'doc';
}

export const RICH_DOC_MAX_DEPTH = 32;

export const EMPTY_DOC: RichDoc = Object.freeze({
  type: 'doc',
  content: Object.freeze([Object.freeze({ type: 'paragraph' })]) as RichNode[],
}) as RichDoc;

export function emptyDoc(): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

type AttrCheck = (value: unknown) => boolean;

interface NodeSpec {
  /** Atributos permitidos e o validador de cada um. */
  attrs?: Readonly<Record<string, AttrCheck>>;
  /** Nó folha (sem `content`). */
  leaf?: boolean;
  /** Nó inline: pode carregar `marks`. */
  inline?: boolean;
}

const CODE_LANGUAGE = /^[a-z0-9+#-]{1,32}$/;
const ORDERED_LIST_TYPES: readonly unknown[] = ['1', 'a', 'A', 'i', 'I'];

const isNullableInt: AttrCheck = (v) =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 1_000_000);

const NODE_SPECS: Readonly<Record<string, NodeSpec>> = Object.freeze({
  doc: {},
  paragraph: {},
  text: { leaf: true, inline: true },
  heading: { attrs: { level: (v) => v === 1 || v === 2 || v === 3 } },
  bulletList: {},
  orderedList: {
    attrs: {
      start: isNullableInt,
      type: (v) => v === null || ORDERED_LIST_TYPES.includes(v),
    },
  },
  listItem: {},
  taskList: {},
  taskItem: { attrs: { checked: (v) => typeof v === 'boolean' } },
  blockquote: {},
  codeBlock: {
    attrs: { language: (v) => v === null || (typeof v === 'string' && CODE_LANGUAGE.test(v)) },
  },
  hardBreak: { leaf: true, inline: true },
  horizontalRule: { leaf: true },
});

export const ALLOWED_NODE_TYPES: readonly string[] = Object.freeze(Object.keys(NODE_SPECS));
export const ALLOWED_MARK_TYPES: readonly string[] = Object.freeze([
  'bold',
  'italic',
  'strike',
  'underline',
  'code',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Mede a profundidade de forma iterativa, sem recursão, para que uma entrada
 * profunda demais não estoure a pilha antes de ser rejeitada.
 */
export function richDocDepth(value: unknown): number {
  let max = 0;
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [unknown, number];
    if (depth > max) max = depth;
    if (depth > RICH_DOC_MAX_DEPTH) return depth;
    if (isPlainObject(node) && Array.isArray(node.content)) {
      for (const child of node.content) stack.push([child, depth + 1]);
    }
  }
  return max;
}

function validateMarks(marks: unknown, path: string): string | null {
  if (!Array.isArray(marks)) return `${path}.marks deve ser uma lista`;
  for (let i = 0; i < marks.length; i++) {
    const mark: unknown = marks[i];
    const markPath = `${path}.marks[${i}]`;
    if (!isPlainObject(mark)) return `${markPath} inválida`;
    const keys = Object.keys(mark);
    if (keys.length !== 1 || keys[0] !== 'type') return `${markPath} tem chaves não permitidas`;
    if (typeof mark.type !== 'string' || !ALLOWED_MARK_TYPES.includes(mark.type)) {
      return `${markPath}: marca não permitida`;
    }
  }
  return null;
}

function validateAttrs(attrs: unknown, spec: NodeSpec, path: string): string | null {
  if (!spec.attrs) return `${path} não aceita atributos`;
  if (!isPlainObject(attrs)) return `${path}.attrs inválido`;
  for (const [name, value] of Object.entries(attrs)) {
    const check = Object.hasOwn(spec.attrs, name) ? spec.attrs[name] : undefined;
    if (!check) return `${path}.attrs.${name} não é permitido`;
    if (!check(value)) return `${path}.attrs.${name} tem valor inválido`;
  }
  return null;
}

function validateNode(node: unknown, path: string, isRoot: boolean): string | null {
  if (!isPlainObject(node)) return `${path} deve ser um objeto`;
  const type = node.type;
  if (typeof type !== 'string' || !Object.hasOwn(NODE_SPECS, type)) {
    return `${path}: tipo de nó não permitido`;
  }
  if (isRoot !== (type === 'doc')) {
    return isRoot ? 'A raiz deve ser do tipo doc' : `${path}: doc só é permitido na raiz`;
  }
  const spec = NODE_SPECS[type] as NodeSpec;

  for (const key of Object.keys(node)) {
    switch (key) {
      case 'type':
        break;
      case 'attrs': {
        const error = validateAttrs(node.attrs, spec, path);
        if (error) return error;
        break;
      }
      case 'content': {
        if (spec.leaf) return `${path} não aceita conteúdo`;
        if (!Array.isArray(node.content)) return `${path}.content deve ser uma lista`;
        for (let i = 0; i < node.content.length; i++) {
          const error = validateNode(node.content[i], `${path}.content[${i}]`, false);
          if (error) return error;
        }
        break;
      }
      case 'marks': {
        if (!spec.inline) return `${path} não aceita marcas`;
        const error = validateMarks(node.marks, path);
        if (error) return error;
        break;
      }
      case 'text': {
        if (type !== 'text') return `${path} não aceita texto`;
        break;
      }
      default:
        return `${path}.${key} não é permitido`;
    }
  }

  if (type === 'text' && (typeof node.text !== 'string' || node.text.length === 0)) {
    return `${path}: texto inválido`;
  }
  return null;
}

/**
 * Valida o documento. Devolve `null` se for válido, ou uma mensagem
 * descrevendo o primeiro problema encontrado.
 */
export function validateRichDoc(value: unknown): string | null {
  if (richDocDepth(value) > RICH_DOC_MAX_DEPTH) {
    return `Conteúdo aninhado demais (máximo ${RICH_DOC_MAX_DEPTH} níveis)`;
  }
  return validateNode(value, 'doc', true);
}

export function isRichDoc(value: unknown): value is RichDoc {
  return validateRichDoc(value) === null;
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

/** Conta os itens de checklist (taskItem) e quantos estão marcados. */
export function checklistProgress(doc: RichNode): ChecklistProgress {
  let done = 0;
  let total = 0;
  const stack: RichNode[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop() as RichNode;
    if (node.type === 'taskItem') {
      total += 1;
      if (node.attrs?.checked === true) done += 1;
    }
    if (node.content) stack.push(...node.content);
  }
  return { done, total };
}
