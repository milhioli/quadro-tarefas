import { describe, expect, it } from 'vitest';
import type { Now } from '../clock';
import { RATE_LIMITS, createLimiters, createRateLimiter, ipRateKey } from './rateLimit';

function movingClock() {
  let time = Date.parse('2026-11-19T12:00:00.000Z');
  const now: Now = () => new Date(time);
  return { now, advance: (ms: number) => (time += ms) };
}

describe('createRateLimiter', () => {
  it('deixa passar até o limite e recusa depois, sem contar a recusa', () => {
    const clock = movingClock();
    const limiter = createRateLimiter(clock.now, { limit: 3, windowMs: 60_000 });
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, true]);
    expect(limiter.hit('a')).toBe(false);
    expect(limiter.hit('a')).toBe(false);
    clock.advance(59_999);
    expect(limiter.hit('a')).toBe(false);
    clock.advance(1);
    expect(limiter.hit('a')).toBe(true);
  });

  it('cada chave tem a própria contagem', () => {
    const clock = movingClock();
    const limiter = createRateLimiter(clock.now, { limit: 1, windowMs: 1000 });
    expect(limiter.hit('ana')).toBe(true);
    expect(limiter.hit('ana')).toBe(false);
    expect(limiter.hit('bia')).toBe(true);
  });

  it('poda as janelas vencidas e nunca passa do teto de chaves', () => {
    const clock = movingClock();
    const limiter = createRateLimiter(clock.now, { limit: 1, windowMs: 1000 }, 3);
    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c');
    expect(limiter.size()).toBe(3);
    // Cheio: a chave mais antiga dá lugar à nova.
    expect(limiter.hit('d')).toBe(true);
    expect(limiter.size()).toBe(3);
    expect(limiter.hit('a')).toBe(true);
    clock.advance(1000);
    limiter.hit('e');
    expect(limiter.size()).toBe(1);
  });
});

describe('createLimiters', () => {
  it('cria um limitador por regra da tabela, com troca pontual nos testes', () => {
    const clock = movingClock();
    const limiters = createLimiters(clock.now, { mutation: { limit: 1, windowMs: 1000 } });
    expect(Object.keys(limiters).sort()).toEqual(Object.keys(RATE_LIMITS).sort());
    expect(limiters.mutation.hit('u:1')).toBe(true);
    expect(limiters.mutation.hit('u:1')).toBe(false);
    for (let i = 0; i < RATE_LIMITS.loginStart.limit; i++) expect(limiters.loginStart.hit('1.2.3.4')).toBe(true);
    expect(limiters.loginStart.hit('1.2.3.4')).toBe(false);
  });

  it('os números da tabela são os do plano', () => {
    expect(RATE_LIMITS).toEqual({
      loginStart: { limit: 20, windowMs: 600_000 },
      signupGlobal: { limit: 30, windowMs: 3_600_000 },
      signupPerIp: { limit: 5, windowMs: 86_400_000 },
      signupPerSub: { limit: 2, windowMs: 86_400_000 },
      mutation: { limit: 300, windowMs: 300_000 },
      groupCreate: { limit: 10, windowMs: 3_600_000 },
      invite: { limit: 30, windowMs: 86_400_000 },
    });
    expect(Object.isFrozen(RATE_LIMITS)).toBe(true);
  });
});

describe('ipRateKey', () => {
  it('IPv4 é a própria chave, e o IPv4 mapeado em IPv6 também', () => {
    expect(ipRateKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipRateKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipRateKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('IPv6 vira o prefixo /64, com zeros normalizados', () => {
    expect(ipRateKey('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12/64');
    expect(ipRateKey('2001:0DB8:ABCD:0012:ffff:ffff:ffff:ffff')).toBe('2001:db8:abcd:12/64');
    expect(ipRateKey('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12/64');
    expect(ipRateKey('2001:db8::1')).toBe('2001:db8:0:0/64');
    expect(ipRateKey('::1')).toBe('0:0:0:0/64');
    expect(ipRateKey('fe80::1%eth0')).toBe('fe80:0:0:0/64');
    expect(ipRateKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0/64');
  });

  it('dois endereços do mesmo /64 dividem a chave; de /64 diferentes, não', () => {
    expect(ipRateKey('2001:db8:1:2::a')).toBe(ipRateKey('2001:db8:1:2:ffff::b'));
    expect(ipRateKey('2001:db8:1:2::a')).not.toBe(ipRateKey('2001:db8:1:3::a'));
  });

  it('algo que não é IP vira uma chave própria e limitada', () => {
    expect(ipRateKey('não é ip')).toBe('raw:não é ip');
    expect(ipRateKey('1:2:3')).toBe('raw:1:2:3');
    expect(ipRateKey('x'.repeat(100))).toHaveLength(4 + 64);
  });
});
