import { describe, expect, it } from 'vitest';
import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  TITLE_MAX_LENGTH,
  createTaskSchema,
  moveBodySchema,
  taskIdParamsSchema,
  updateTaskSchema,
} from './schemas';

describe('createTaskSchema', () => {
  it('aceita título com cor e conteúdo opcionais e apara espaços', () => {
    const parsed = createTaskSchema.parse({ title: '  Estudar  ' });
    expect(parsed).toEqual({ title: 'Estudar' });
    const full = createTaskSchema.parse({
      title: 'Ler',
      color: 'azul',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(full.color).toBe('azul');
  });

  it('rejeita título vazio, só espaços ou longo demais', () => {
    expect(createTaskSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: '    ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'a'.repeat(TITLE_MAX_LENGTH) }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(createTaskSchema.safeParse({}).success).toBe(false);
  });

  it('rejeita cor fora da lista, conteúdo inválido e chaves extras', () => {
    expect(createTaskSchema.safeParse({ title: 'a', color: 'red' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'a', content: { type: 'script' } }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'a', day: 1 }).success).toBe(false);
  });
});

describe('updateTaskSchema', () => {
  it('aceita atualização parcial', () => {
    expect(updateTaskSchema.parse({ color: 'verde' })).toEqual({ color: 'verde' });
  });

  it('rejeita corpo vazio e chaves de posição', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
    expect(updateTaskSchema.safeParse({ day: 0 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ title: 'a', slot: 3 }).success).toBe(false);
  });
});

describe('moveBodySchema', () => {
  it('aceita deck e células válidas', () => {
    expect(moveBodySchema.parse({ to: { kind: 'deck' } })).toEqual({ to: { kind: 'deck' } });
    expect(moveBodySchema.parse({ to: { kind: 'cell', day: 4, slot: 33 } }).to).toEqual({ kind: 'cell', day: 4, slot: 33 });
  });

  it.each([
    { to: { kind: 'cell', day: 5, slot: 0 } },
    { to: { kind: 'cell', day: 0, slot: 34 } },
    { to: { kind: 'cell', day: -1, slot: 0 } },
    { to: { kind: 'cell', day: 1.5, slot: 0 } },
    { to: { kind: 'cell', day: '1', slot: 0 } },
    { to: { kind: 'cell', day: 1 } },
    { to: { kind: 'deck', day: 1 } },
    { to: { kind: 'lixo' } },
    {},
    { to: { kind: 'deck' }, extra: true },
  ])('rejeita %j', (body) => {
    expect(moveBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('taskIdParamsSchema', () => {
  it('converte ids decimais positivos', () => {
    expect(taskIdParamsSchema.parse({ id: '42' })).toEqual({ id: 42 });
  });

  it.each(['0', '-1', '01', '1e3', '0x10', '1.5', 'abc', '', '9999999999999999'])('rejeita "%s"', (id) => {
    expect(taskIdParamsSchema.safeParse({ id }).success).toBe(false);
  });
});

describe('header do cliente', () => {
  it('exporta o nome e o valor esperados pelo guard', () => {
    expect(CLIENT_HEADER).toBe('X-Quadro-Client');
    expect(CLIENT_HEADER_VALUE).toBe('1');
  });
});
