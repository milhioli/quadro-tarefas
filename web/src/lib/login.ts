import { isLoginOutcome, type LoginOutcome } from '@quadro/shared';

/** Como o login Google terminou: o servidor volta para `/?login=...` quando não deu certo (lista do shared). */
export type { LoginOutcome };

/**
 * Avisos da tela de entrada: os resultados do login (lidos da URL) e o
 * "conta apagada", que é interno e nunca vem da URL (um link não consegue
 * fingir que a conta de alguém foi apagada).
 */
export type LoginNotice = LoginOutcome | 'conta-apagada';

export const LOGIN_PARAM = 'login';
export const GOOGLE_START_PATH = '/api/auth/google/start';

export const LOGIN_NOTICES: Readonly<Record<LoginNotice, { text: string; tone: 'error' | 'info' }>> = Object.freeze({
  erro: { text: 'Não foi possível entrar. Tente de novo.', tone: 'error' },
  cancelado: { text: 'O login foi cancelado.', tone: 'error' },
  indisponivel: { text: 'O login com Google está indisponível agora. Tente de novo em instantes.', tone: 'error' },
  limite: { text: 'Muitas tentativas de entrar em pouco tempo. Espere alguns minutos e tente de novo.', tone: 'error' },
  desativada: {
    text: 'Esta conta foi desativada. Se você acha que é um engano, escreva para o contato no rodapé.',
    tone: 'error',
  },
  'conta-apagada': { text: 'Sua conta foi apagada.', tone: 'info' },
});

/** Lista fechada: qualquer outro valor de `?login=` é ignorado. */
export function parseLoginOutcome(search: string): LoginOutcome | null {
  const value = new URLSearchParams(search).get(LOGIN_PARAM);
  return value !== null && isLoginOutcome(value) ? value : null;
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
