import { describe, expect, it } from 'vitest';
import { IdentityError, parseIdentityClaims } from './identity';

describe('parseIdentityClaims', () => {
  it('lê só sub, e-mail (em minúsculas), email_verified e given_name', () => {
    expect(
      parseIdentityClaims({
        sub: '1234567890',
        email: 'Ana@Example.com',
        email_verified: true,
        given_name: 'Ana',
        name: 'Ana Souza',
        picture: 'https://x/y.png',
      }),
    ).toEqual({ sub: '1234567890', email: 'ana@example.com', emailVerified: true, givenName: 'Ana' });
  });

  it('sem given_name a sugestão fica nula', () => {
    expect(parseIdentityClaims({ sub: '1', email: 'a@example.com', email_verified: false }).givenName).toBeNull();
  });

  it.each([
    {},
    { sub: '', email: 'a@example.com', email_verified: true },
    { sub: '1', email_verified: true },
    { sub: '1', email: 'a@example.com', email_verified: 'true' },
    { sub: 1, email: 'a@example.com', email_verified: true },
    null,
  ])('claims inválidas viram IdentityError sem detalhes: %j', (raw) => {
    try {
      parseIdentityClaims(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityError);
      expect((error as IdentityError).kind).toBe('invalid-claims');
      expect((error as Error).message).toBe('identity:invalid-claims');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
