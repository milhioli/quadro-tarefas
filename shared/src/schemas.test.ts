import { describe, expect, it } from 'vitest';
import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  TITLE_MAX_LENGTH,
  calendarWeekQuerySchema,
  createTaskSchema,
  isMondayIsoDate,
  boardIdParamsSchema,
  boardNameSchema,
  devLoginSchema,
  displayNameSchema,
  formatHandle,
  handleSchema,
  inviteInputSchema,
  memberParamsSchema,
  moveBodySchema,
  parseHandle,
  profileInputSchema,
  spanSchema,
  usernameSchema,
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

describe('position em criação e edição', () => {
  it('aceita deck e células válidas', () => {
    expect(createTaskSchema.parse({ title: 'a', position: { kind: 'cell', day: 1, slot: 2 } }).position).toEqual({
      kind: 'cell',
      day: 1,
      slot: 2,
    });
    expect(createTaskSchema.parse({ title: 'a', position: { kind: 'deck' } }).position).toEqual({ kind: 'deck' });
    expect(updateTaskSchema.parse({ position: { kind: 'deck' } })).toEqual({ position: { kind: 'deck' } });
    expect(updateTaskSchema.parse({ title: 'b', position: { kind: 'cell', day: 4, slot: 33 } })).toEqual({
      title: 'b',
      position: { kind: 'cell', day: 4, slot: 33 },
    });
  });

  it('position é opcional', () => {
    expect(createTaskSchema.parse({ title: 'a' })).toEqual({ title: 'a' });
  });

  it.each([
    { kind: 'cell', day: 5, slot: 0 },
    { kind: 'cell', day: 0, slot: 34 },
    { kind: 'cell', day: 0.5, slot: 0 },
    { kind: 'cell', day: 1 },
    { kind: 'cell', day: 1, slot: 2, extra: 1 },
    { kind: 'deck', day: 0 },
    { kind: 'x' },
    null,
    'deck',
  ])('rejeita position %j', (position) => {
    expect(createTaskSchema.safeParse({ title: 'a', position }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ position }).success).toBe(false);
  });
});

describe('span (duração) em criação e edição', () => {
  it('aceita de 1 a 34 slots, e span sozinho é uma edição válida', () => {
    expect(createTaskSchema.parse({ title: 'a', span: 1 })).toEqual({ title: 'a', span: 1 });
    expect(createTaskSchema.parse({ title: 'a', span: 34, position: { kind: 'cell', day: 0, slot: 0 } }).span).toBe(34);
    expect(updateTaskSchema.parse({ span: 2 })).toEqual({ span: 2 });
    expect(spanSchema.parse(30)).toBe(30);
  });

  it.each([0, 35, -1, 1.5, '2', null, Number.NaN])('rejeita span %j', (span) => {
    expect(createTaskSchema.safeParse({ title: 'a', span }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ span }).success).toBe(false);
  });

  it('mensagens em pt-BR', () => {
    expect(spanSchema.safeParse(0).error?.issues[0]?.message).toBe('A duração mínima é de 30 minutos');
    expect(spanSchema.safeParse(35).error?.issues[0]?.message).toBe('A duração máxima vai de 05:00 a 22:00');
    expect(spanSchema.safeParse(1.5).error?.issues[0]?.message).toBe('Duração inválida');
  });
});

describe('contas: nome de usuário, nome de exibição e handle', () => {
  it('nome de usuário: 3 a 20 de [a-z0-9._], em minúsculas e sem reservados', () => {
    expect(usernameSchema.parse('  Ana.Souza_1 ')).toBe('ana.souza_1');
    for (const bad of ['ab', 'a'.repeat(21), 'ana souza', 'ana-souza', 'ãna', 'admin', 'Suporte', '']) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(usernameSchema.safeParse('admin').error?.issues[0]?.message).toBe('Esse nome de usuário é reservado');
  });

  it('nome de exibição e nome de quadro recusam controles e caracteres de direção', () => {
    expect(displayNameSchema.parse('  Ana Souza ')).toBe('Ana Souza');
    expect(displayNameSchema.parse('José Ñandú 🙂')).toBe('José Ñandú 🙂');
    for (const bad of ['', '   ', 'a'.repeat(41), 'Ana‮axe', 'Ana​', 'Ana\u0007', 'Ana⁦x']) {
      expect(displayNameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(boardNameSchema.parse('Equipe 🚀')).toBe('Equipe 🚀');
    expect(boardNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
    expect(boardNameSchema.safeParse('Time‮').success).toBe(false);
  });

  it('formatHandle e parseHandle usam a forma canônica (2 dígitos no mínimo)', () => {
    expect(formatHandle('ana', 0)).toBe('ana_00');
    expect(formatHandle('ana', 7)).toBe('ana_07');
    expect(formatHandle('ana', 100)).toBe('ana_100');
    expect(parseHandle('ana_07')).toEqual({ username: 'ana', seq: 7 });
    expect(parseHandle(' ANA_00 ')).toEqual({ username: 'ana', seq: 0 });
    expect(parseHandle('ana_b_12')).toEqual({ username: 'ana_b', seq: 12 });
    expect(parseHandle('ana_100')).toEqual({ username: 'ana', seq: 100 });
    for (const bad of ['ana_7', 'ana_007', 'ana', 'ana_', '_07', 'an_07', 'ana-07']) {
      expect(parseHandle(bad), bad).toBeNull();
    }
    expect(handleSchema.parse('ana_07')).toEqual({ username: 'ana', seq: 7 });
    expect(handleSchema.safeParse('ana_7').success).toBe(false);
  });

  it('entradas de perfil, quadro e convite são estritas', () => {
    expect(profileInputSchema.parse({ username: 'ana', displayName: 'Ana' })).toEqual({ username: 'ana', displayName: 'Ana' });
    expect(profileInputSchema.safeParse({ username: 'ana', displayName: 'Ana', role: 'admin' }).success).toBe(false);
    expect(profileInputSchema.safeParse({ username: 'ana', displayName: 'Ana', seq: 0 }).success).toBe(false);
    expect(inviteInputSchema.parse({ handle: 'bia_01' })).toEqual({ handle: { username: 'bia', seq: 1 } });
    expect(boardIdParamsSchema.parse({ boardId: '12' })).toEqual({ boardId: 12 });
    expect(boardIdParamsSchema.safeParse({ boardId: '012' }).success).toBe(false);
    expect(memberParamsSchema.parse({ boardId: '1', userId: '2' })).toEqual({ boardId: 1, userId: 2 });
  });

  it('login de desenvolvimento aceita só e-mails @example.com e nada além do e-mail', () => {
    expect(devLoginSchema.parse({ email: ' Admin@Example.com ' })).toEqual({ email: 'admin@example.com' });
    for (const email of ['ana@gmail.com', 'ana@example.com.br', 'ana@sub.example.com', 'example.com', '@example.com']) {
      expect(devLoginSchema.safeParse({ email }).success, email).toBe(false);
    }
    expect(devLoginSchema.safeParse({ email: 'a@example.com', role: 'admin' }).success).toBe(false);
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

describe('semana da agenda', () => {
  it('isMondayIsoDate aceita só segundas válidas', () => {
    expect(isMondayIsoDate('2026-11-16')).toBe(true);
    expect(isMondayIsoDate('2026-11-17')).toBe(false);
    expect(isMondayIsoDate('2026-02-30')).toBe(false);
    expect(isMondayIsoDate('2026-11-16T00:00')).toBe(false);
    expect(isMondayIsoDate('16/11/2026')).toBe(false);
    expect(isMondayIsoDate('')).toBe(false);
  });

  it('calendarWeekQuerySchema é estrito', () => {
    expect(calendarWeekQuerySchema.parse({ week: '2026-11-16' })).toEqual({ week: '2026-11-16' });
    expect(calendarWeekQuerySchema.safeParse({ week: '2026-11-18' }).success).toBe(false);
    expect(calendarWeekQuerySchema.safeParse({ week: '2026-11-16', extra: '1' }).success).toBe(false);
    expect(calendarWeekQuerySchema.safeParse({ week: ['2026-11-16', '2026-11-23'] }).success).toBe(false);
    expect(calendarWeekQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('header do cliente', () => {
  it('exporta o nome e o valor esperados pelo guard', () => {
    expect(CLIENT_HEADER).toBe('X-Quadro-Client');
    expect(CLIENT_HEADER_VALUE).toBe('1');
  });
});
