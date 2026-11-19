/** Como o login Google terminou: o servidor volta para `/?login=...` quando não deu certo. */
export type LoginOutcome = 'erro' | 'cancelado' | 'indisponivel';

export const LOGIN_PARAM = 'login';
export const GOOGLE_START_PATH = '/api/auth/google/start';

const OUTCOMES: readonly string[] = ['erro', 'cancelado', 'indisponivel'];

export const LOGIN_OUTCOME_MESSAGES: Readonly<Record<LoginOutcome, string>> = Object.freeze({
  erro: 'Não foi possível entrar. Tente de novo.',
  cancelado: 'O login foi cancelado.',
  indisponivel: 'O login com Google está indisponível agora. Tente de novo em instantes.',
});

/** Lista fechada: qualquer outro valor de `?login=` é ignorado. */
export function parseLoginOutcome(search: string): LoginOutcome | null {
  const value = new URLSearchParams(search).get(LOGIN_PARAM);
  return value !== null && OUTCOMES.includes(value) ? (value as LoginOutcome) : null;
}

/** O endereço atual sem o `?login=`: é o destino depois do login e o que fica na barra. */
export function withoutLoginParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(LOGIN_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Link do "Entrar com Google". O servidor confere o `next` de novo (só caminho da mesma origem). */
export function googleStartUrl(next: string): string {
  return next === '/' || next === '' ? GOOGLE_START_PATH : `${GOOGLE_START_PATH}?next=${encodeURIComponent(next)}`;
}
