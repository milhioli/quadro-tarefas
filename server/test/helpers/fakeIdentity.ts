import { IdentityError, type IdentityClaims, type IdentityProvider, type LoginChecks } from '../../src/auth/identity';

/** Provedor de identidade falso para os testes de rota: nada sai da máquina. */
export interface FakeIdentity extends IdentityProvider {
  /** O que `available()` responde. */
  ready: boolean;
  /** O que o próximo `complete` devolve, ou o erro que ele lança. */
  result: IdentityClaims | IdentityError;
  readonly begun: Array<{ redirectUri: string; checks: LoginChecks }>;
  readonly completed: Array<{ callbackUrl: URL; checks: LoginChecks }>;
}

export const FAKE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export function fakeClaims(overrides: Partial<IdentityClaims> = {}): IdentityClaims {
  return { sub: '109876543210', email: 'ana@example.com', emailVerified: true, givenName: 'Ana', ...overrides };
}

export function createFakeIdentity(result: IdentityClaims | IdentityError = fakeClaims()): FakeIdentity {
  let count = 0;
  const fake: FakeIdentity = {
    ready: true,
    result,
    begun: [],
    completed: [],
    available: () => fake.ready,
    async begin(redirectUri) {
      count += 1;
      const checks: LoginChecks = {
        state: `state-${count}-${'s'.repeat(32)}`,
        nonce: `nonce-${count}`,
        codeVerifier: `verifier-${count}`,
      };
      fake.begun.push({ redirectUri, checks });
      const url = new URL(FAKE_AUTHORIZATION_ENDPOINT);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', checks.state);
      return { authorizationUrl: url, checks };
    },
    async complete(callbackUrl, checks) {
      fake.completed.push({ callbackUrl, checks });
      // Como o provedor real: o state da volta precisa ser o do login.
      if (callbackUrl.searchParams.get('state') !== checks.state) throw new IdentityError('rejected');
      if (fake.result instanceof IdentityError) throw fake.result;
      return fake.result;
    },
  };
  return fake;
}
