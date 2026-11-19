import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/helpers/testApp';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('GET /api/info', () => {
  it('responde sem sessão com o contato e o responsável configurados', async () => {
    t = await createTestApp({
      signInAsAdmin: false,
      info: { contactEmail: 'contato@example.com', operatorName: 'Operador de Teste' },
    });
    const res = await t.anonymous('GET', '/api/info');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ contactEmail: 'contato@example.com', operatorName: 'Operador de Teste' });
  });

  it('sem configuração, os dois campos vêm nulos', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    expect((await t.anonymous('GET', '/api/info')).json()).toEqual({ contactEmail: null, operatorName: null });
  });

  it('só GET: outros métodos não existem', async () => {
    t = await createTestApp();
    expect((await t.request('POST', '/api/info', {})).statusCode).toBe(404);
  });
});
