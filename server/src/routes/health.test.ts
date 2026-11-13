import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/helpers/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => t.close());

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const res = await t.request('GET', '/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
