import { useId, useState, type FormEvent } from 'react';
import { useAuthMethods, useDevLogin } from '../../api/account';
import { describeError } from '../../api/client';
import { LOGIN_OUTCOME_MESSAGES, googleStartUrl, type LoginOutcome } from '../../lib/login';

export interface LoginScreenProps {
  /** Resultado do último login (`?login=...`), se não deu certo. */
  outcome: LoginOutcome | null;
  /** Para onde voltar depois de entrar (caminho do app). */
  next: string;
}

/**
 * Tela de entrada. O "Entrar com Google" é um link comum (navegação), para o
 * servidor receber `Sec-Fetch-Site: same-origin` e mandar ao Google. O login de
 * teste só aparece no servidor de E2E (`npm run dev:e2e`).
 */
export function LoginScreen({ outcome, next }: LoginScreenProps) {
  const methods = useAuthMethods();
  const devLogin = useDevLogin();
  const [email, setEmail] = useState('');
  const emailId = useId();
  const titleId = useId();

  function handleDevLogin(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    devLogin.mutate(email.trim());
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby={titleId}>
        <h1 id={titleId} className="app-title">
          Quadro de tarefas
        </h1>
        <p className="auth-card__lead">Entre para ver seus quadros e os grupos de que você participa.</p>

        {outcome ? (
          <p className="form-error" role="alert">
            {LOGIN_OUTCOME_MESSAGES[outcome]}
          </p>
        ) : null}

        {methods.isPending ? (
          <p className="auth-card__muted" role="status">
            Carregando…
          </p>
        ) : null}
        {methods.isError ? (
          <p className="form-error" role="alert">
            {describeError(methods.error, 'Não foi possível falar com o servidor')}
          </p>
        ) : null}

        {methods.data?.google ? (
          <a className="button button--primary auth-card__google" href={googleStartUrl(next)}>
            Entrar com Google
          </a>
        ) : null}
        {methods.data && !methods.data.google ? (
          <p className="auth-card__muted">
            O login com Google não está configurado neste servidor. Veja no README como preencher GOOGLE_CLIENT_ID e
            GOOGLE_CLIENT_SECRET no .env.
          </p>
        ) : null}

        {methods.data?.dev ? (
          <form className="auth-card__dev" onSubmit={handleDevLogin}>
            <div className="field">
              <label className="field__label" htmlFor={emailId}>
                E-mail de teste
              </label>
              <input
                id={emailId}
                className="input"
                type="email"
                value={email}
                placeholder="pessoa@example.com"
                autoComplete="off"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {devLogin.isError ? (
              <p className="form-error" role="alert">
                {describeError(devLogin.error, 'Não foi possível entrar')}
              </p>
            ) : null}
            <button type="submit" className="button" disabled={devLogin.isPending || email.trim() === ''}>
              Entrar (teste)
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
