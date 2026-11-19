import { describe, expect, it } from 'vitest';
import { PENDING_LOGIN_TTL_MS, createPendingLogins, type PendingLogin } from './pendingLogins';

const LOGIN: PendingLogin = {
  checks: { state: 'estado', nonce: 'nonce', codeVerifier: 'verificador' },
  next: '/',
};

function clock(iso = '2026-11-18T12:00:00.000Z') {
  let time = Date.parse(iso);
  return {
    now: () => new Date(time),
    advance(ms: number) {
      time += ms;
    },
  };
}

describe('createPendingLogins', () => {
  it('put devolve um id aleatório de 43 caracteres base64url, diferente a cada login', () => {
    const pending = createPendingLogins(clock().now);
    const a = pending.put(LOGIN);
    const b = pending.put(LOGIN);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).not.toBe(a);
  });

  it('take devolve a entrada uma vez só: o segundo take do mesmo id dá null', () => {
    const pending = createPendingLogins(clock().now);
    const id = pending.put(LOGIN) as string;
    expect(pending.take(id)).toEqual(LOGIN);
    expect(pending.take(id)).toBeNull();
    expect(pending.size()).toBe(0);
  });

  it('a entrada expira em 10 minutos e o take da expirada também a apaga', () => {
    const c = clock();
    const pending = createPendingLogins(c.now);
    const id = pending.put(LOGIN) as string;
    c.advance(PENDING_LOGIN_TTL_MS - 1);
    expect(pending.size()).toBe(1);
    c.advance(1);
    expect(pending.take(id)).toBeNull();
    expect(pending.size()).toBe(0);
  });

  it('com o mapa cheio, recusa logins novos (null) sem expulsar os que estão em andamento', () => {
    const c = clock();
    const pending = createPendingLogins(c.now, { max: 2 });
    const first = pending.put(LOGIN) as string;
    expect(pending.put(LOGIN)).not.toBeNull();
    expect(pending.put(LOGIN)).toBeNull();
    expect(pending.take(first)).toEqual(LOGIN);
    expect(pending.put(LOGIN)).not.toBeNull();
  });

  it('as expiradas saem antes de contar o teto', () => {
    const c = clock();
    const pending = createPendingLogins(c.now, { max: 1 });
    pending.put(LOGIN);
    expect(pending.put(LOGIN)).toBeNull();
    c.advance(PENDING_LOGIN_TTL_MS);
    expect(pending.put(LOGIN)).not.toBeNull();
  });

  it('id com formato estranho não acha nada', () => {
    const pending = createPendingLogins(clock().now);
    pending.put(LOGIN);
    for (const id of ['', 'curto', `${'a'.repeat(43)}=`, '../../etc/passwd', 'a'.repeat(44)]) {
      expect(pending.take(id), id).toBeNull();
    }
    expect(pending.size()).toBe(1);
  });
});
