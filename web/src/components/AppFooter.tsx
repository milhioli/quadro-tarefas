import { PRIVACY_PATH } from '@quadro/shared';
import { useInfo } from '../api/account';

/** E-mail simples (sem espaço, aspas nem sinais de tag) vira link mailto; qualquer outra coisa, nada. */
const SIMPLE_EMAIL = /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,190}\.[^\s@<>"'`]{2,63}$/;

export function contactHref(email: string | null | undefined): string | null {
  return email && SIMPLE_EMAIL.test(email) ? `mailto:${email}` : null;
}

/** Rodapé: a página de privacidade e o canal de contato (LGPD). */
export function AppFooter() {
  const info = useInfo();
  const email = info.data?.contactEmail ?? null;
  const href = contactHref(email);
  return (
    <footer className="app-footer">
      <a href={PRIVACY_PATH}>Privacidade</a>
      {href ? (
        <span>
          {' · '}Contato: <a href={href}>{email}</a>
        </span>
      ) : null}
    </footer>
  );
}
