import * as oidc from 'openid-client';
import { CalendarFetchError, allowedUrl, createOidcFetch, type OidcFetch } from '../calendar/guardedFetch';
import type { Now } from '../clock';
import type { GoogleConfig } from './config';
import { IdentityError, parseIdentityClaims, type IdentityClaims, type IdentityProvider, type LoginChecks } from './identity';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
/** Só estes escopos: não exigem verificação do app no Google. */
export const GOOGLE_SCOPE = 'openid email profile';
/** Espera mínima entre duas tentativas de discovery depois de uma falha. */
export const DISCOVERY_RETRY_MS = 60_000;
/** Timeout das requisições do openid-client (segundos); o `createOidcFetch` tem o próprio teto. */
const OIDC_TIMEOUT_SECONDS = 10;

/** Tipo da falha do discovery, para o log (`{ kind }`): nunca URL, corpo nem mensagem. */
export type DiscoveryErrorKind = CalendarFetchError['kind'] | 'invalid';

/** O openid-client embrulha o erro do fetch (`ClientError` com `cause`): procura o nosso na cadeia. */
export function discoveryErrorKind(error: unknown): DiscoveryErrorKind {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof CalendarFetchError) return current.kind;
    current = current.cause;
  }
  return 'invalid';
}

export interface GoogleProviderOptions {
  google: GoogleConfig;
  now: Now;
  /** Saída de rede. Padrão: `createOidcFetch()`, preso aos hosts do Google. */
  fetch?: OidcFetch;
  onDiscoveryError?: (kind: DiscoveryErrorKind) => void;
}

export interface GoogleProvider extends IdentityProvider {
  /** Faz o discovery. Nunca rejeita: uma falha deixa o login indisponível e chama `onDiscoveryError`. */
  init(): Promise<boolean>;
}

/**
 * Login Google com authorization code, PKCE (S256), state e nonce, via
 * openid-client. `enableNonRepudiationChecks` confere a assinatura do ID
 * token pelo JWKS (sem ele, a assinatura não é verificada).
 *
 * O `available()` dispara uma nova tentativa do discovery em segundo plano
 * quando a anterior falhou, no máximo uma por minuto.
 */
export function createGoogleProvider(options: GoogleProviderOptions): GoogleProvider {
  const { clientId, clientSecret } = options.google;
  const fetch = options.fetch ?? createOidcFetch();

  // client_secret_post com o segredo lido da closure do config na hora da
  // troca do code: ele nunca fica guardado no Configuration do openid-client.
  const clientAuth: oidc.ClientAuth = (_as, client, body) => {
    body.set('client_id', client.client_id);
    body.set('client_secret', clientSecret());
  };

  let config: oidc.Configuration | null = null;
  let inFlight: Promise<boolean> | null = null;
  let lastFailureAt: number | null = null;

  async function discover(): Promise<boolean> {
    try {
      const discovered = await oidc.discovery(new URL(GOOGLE_ISSUER), clientId, undefined, clientAuth, {
        [oidc.customFetch]: fetch,
        timeout: OIDC_TIMEOUT_SECONDS,
        execute: [oidc.enableNonRepudiationChecks],
      });
      const metadata = discovered.serverMetadata();
      // O navegador é mandado ao authorization_endpoint: ele precisa ser do Google.
      for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
        if (typeof endpoint !== 'string' || !allowedUrl('google', endpoint)) throw new IdentityError('unavailable');
      }
      config = discovered;
      lastFailureAt = null;
      return true;
    } catch (error) {
      lastFailureAt = options.now().getTime();
      options.onDiscoveryError?.(discoveryErrorKind(error));
      return false;
    } finally {
      inFlight = null;
    }
  }

  function init(): Promise<boolean> {
    if (config) return Promise.resolve(true);
    inFlight ??= discover();
    return inFlight;
  }

  function ready(): oidc.Configuration {
    if (!config) throw new IdentityError('unavailable');
    return config;
  }

  return {
    init,

    available() {
      if (config) return true;
      if (!inFlight && lastFailureAt !== null && options.now().getTime() - lastFailureAt >= DISCOVERY_RETRY_MS) {
        void init();
      }
      return false;
    },

    async begin(redirectUri) {
      const cfg = ready();
      let authorizationUrl: URL;
      let checks: LoginChecks;
      try {
        checks = { state: oidc.randomState(), nonce: oidc.randomNonce(), codeVerifier: oidc.randomPKCECodeVerifier() };
        authorizationUrl = oidc.buildAuthorizationUrl(cfg, {
          redirect_uri: redirectUri,
          scope: GOOGLE_SCOPE,
          code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
          code_challenge_method: 'S256',
          state: checks.state,
          nonce: checks.nonce,
          // Sempre mostra a escolha de conta: numa máquina com várias contas Google, entra a que a pessoa escolher.
          prompt: 'select_account',
        });
      } catch {
        throw new IdentityError('unavailable');
      }
      if (!allowedUrl('google', authorizationUrl)) throw new IdentityError('unavailable');
      return { authorizationUrl, checks };
    },

    async complete(callbackUrl, checks): Promise<IdentityClaims> {
      const cfg = ready();
      let claims: unknown;
      try {
        const tokens = await oidc.authorizationCodeGrant(cfg, callbackUrl, {
          pkceCodeVerifier: checks.codeVerifier,
          expectedState: checks.state,
          expectedNonce: checks.nonce,
          idTokenExpected: true,
        });
        // Só as claims do ID token; o access token é descartado aqui.
        claims = tokens.claims();
      } catch {
        // Os erros da biblioteca levam corpo, claims e URL no `cause`: nada disso sai daqui.
        throw new IdentityError('rejected');
      }
      return parseIdentityClaims(claims);
    },
  };
}
