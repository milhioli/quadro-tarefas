import { isPublicOrigin, type AuthConfig } from './auth/config';
import { AGENDA_FLAG } from './calendar/config';
import type { Env } from './config';

/**
 * Modo de execução do servidor normal (`index.ts`).
 * - local: dev em 127.0.0.1, APP_ORIGIN http de loopback (como sempre foi).
 * - public: o pacote de deploy (`deploy/`), atrás do Caddy com TLS. Exige os
 *   dois sinais juntos: NODE_ENV=production (o Dockerfile define) e um
 *   APP_ORIGIN https. Um sinal sozinho é erro, para um dev nunca subir em
 *   modo público por engano, nem o deploy subir em modo local.
 */
export type DeployMode = 'local' | 'public';

export class DeployModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployModeError';
  }
}

const ICLOUD_PREFIX = 'ICLOUD_';

/**
 * Decide o modo e confere o que a produção exige. Precisa rodar antes do
 * `loadCalendarConfig`, que apaga as chaves ICLOUD_* do ambiente. As
 * mensagens nunca ecoam valores.
 */
export function resolveDeployMode(env: Env, argv: readonly string[], auth: AuthConfig): DeployMode {
  const production = env.NODE_ENV === 'production';
  const https = isPublicOrigin(auth.appOrigin);
  if (!production) {
    if (https) throw new DeployModeError('APP_ORIGIN https só sobe pelo pacote de deploy (NODE_ENV=production)');
    return 'local';
  }
  if (!https) throw new DeployModeError('Em produção, o APP_ORIGIN precisa ser https');

  const missing: string[] = [];
  if (auth.googleOffReason === 'tls-disabled') {
    throw new DeployModeError('Em produção, a verificação de TLS não pode ser desligada (NODE_TLS_REJECT_UNAUTHORIZED=0)');
  }
  if (auth.google === null) missing.push('GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET');
  if (auth.adminEmail === null) missing.push('QUADRO_ADMIN_EMAIL');
  if (auth.contactEmail === null) missing.push('QUADRO_CONTACT_EMAIL');
  if (auth.operatorName === null) missing.push('QUADRO_OPERATOR_NAME');
  if (!env.DB_PATH?.trim()) missing.push('DB_PATH');
  if (missing.length > 0) throw new DeployModeError(`Em produção, informe: ${missing.join(', ')}`);

  // A agenda global (senha de app no ambiente do servidor) não sobe em produção:
  // a agenda por pessoa, cifrada, é a Fase 4.
  if (argv.includes(AGENDA_FLAG)) throw new DeployModeError('A agenda global (--agenda) não sobe em produção');
  if (Object.keys(env).some((key) => key.startsWith(ICLOUD_PREFIX) && env[key]?.trim())) {
    throw new DeployModeError('Em produção, não deixe credenciais da agenda (ICLOUD_*) no ambiente');
  }
  return 'public';
}
