import { z } from 'zod';

/** O que o login guarda no servidor entre o início e a volta do provedor. */
export interface LoginChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Dados da conta que saem do provedor, já validados. Nada além disso é lido. */
export interface IdentityClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  givenName: string | null;
}

export interface IdentityProvider {
  /** Disponível agora (configurado e com o discovery feito). */
  available(): boolean;
  /** URL de autorização e os segredos do login (que ficam no servidor). `redirectUri` sai do APP_ORIGIN. */
  begin(redirectUri: string): Promise<{ authorizationUrl: URL; checks: LoginChecks }>;
  /** Troca o code e valida o ID token. `callbackUrl` é montado a partir do APP_ORIGIN, nunca do Host. */
  complete(callbackUrl: URL, checks: LoginChecks): Promise<IdentityClaims>;
}

export type IdentityErrorKind = 'unavailable' | 'rejected' | 'invalid-claims';

/**
 * Erro do provedor sem `cause`, corpo, URL nem claims: os erros das
 * bibliotecas de OAuth carregam tudo isso e o handler do Fastify logaria.
 */
export class IdentityError extends Error {
  readonly kind: IdentityErrorKind;

  constructor(kind: IdentityErrorKind) {
    super(`identity:${kind}`);
    this.name = 'IdentityError';
    this.kind = kind;
  }
}

/** Claims do ID token: só o que o app usa, com tipos conferidos. */
export const idTokenClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().min(3).max(254),
  email_verified: z.boolean(),
  given_name: z.string().max(200).optional(),
});

export function parseIdentityClaims(raw: unknown): IdentityClaims {
  const parsed = idTokenClaimsSchema.safeParse(raw);
  if (!parsed.success) throw new IdentityError('invalid-claims');
  return {
    sub: parsed.data.sub,
    email: parsed.data.email.toLowerCase(),
    emailVerified: parsed.data.email_verified,
    givenName: parsed.data.given_name ?? null,
  };
}
