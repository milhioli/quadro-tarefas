import { displayNameSchema, usernameSchema } from '@quadro/shared';
import { useId, useState, type FormEvent } from 'react';
import { useCreateProfile, useLogout } from '../../api/account';
import { describeError } from '../../api/client';
import { AppFooter } from '../AppFooter';

export interface ProfileScreenProps {
  /** Sugestão para o nome de exibição (o primeiro nome da conta Google). */
  suggestedName: string;
  /** Chamado depois de sair (para esquecer o quadro escolhido). */
  onLoggedOut?: () => void;
}

interface FieldErrors {
  username?: string;
  displayName?: string;
}

/**
 * Primeiro acesso: a pessoa escolhe o nome de usuário (o servidor acrescenta
 * o número e devolve o handle, ex.: ana_07) e o nome que os outros veem.
 * A validação aqui só adianta a mensagem; quem decide é o servidor.
 */
export function ProfileScreen({ suggestedName, onLoggedOut }: ProfileScreenProps) {
  const createProfile = useCreateProfile();
  const logout = useLogout(onLoggedOut);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(suggestedName);
  const [errors, setErrors] = useState<FieldErrors>({});
  const titleId = useId();
  const usernameId = useId();
  const usernameHelpId = useId();
  const displayNameId = useId();
  const displayNameHelpId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedUsername = usernameSchema.safeParse(username);
    const parsedDisplayName = displayNameSchema.safeParse(displayName);
    const next: FieldErrors = {};
    if (!parsedUsername.success) next.username = parsedUsername.error.issues[0]?.message;
    if (!parsedDisplayName.success) next.displayName = parsedDisplayName.error.issues[0]?.message;
    setErrors(next);
    if (!parsedUsername.success || !parsedDisplayName.success) return;
    createProfile.mutate({ username: parsedUsername.data, displayName: parsedDisplayName.data });
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby={titleId}>
        <h1 id={titleId} className="app-title">
          Bem-vindo ao Quadro de tarefas
        </h1>
        <p className="auth-card__lead">Antes de começar, escolha como as outras pessoas vão te encontrar.</p>

        <form className="task-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={usernameId}>
              Nome de usuário
            </label>
            <input
              id={usernameId}
              className="input"
              value={username}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={errors.username ? true : undefined}
              aria-describedby={usernameHelpId}
              onChange={(event) => setUsername(event.target.value)}
            />
            <p id={usernameHelpId} className="field__sublabel">
              De 3 a 20 letras minúsculas, números, ponto ou sublinhado. O sistema acrescenta um número (ex.: ana_07), e
              é por esse nome que te convidam para um grupo.
            </p>
            {errors.username ? <p className="field__error">{errors.username}</p> : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor={displayNameId}>
              Nome de exibição
            </label>
            <input
              id={displayNameId}
              className="input"
              value={displayName}
              autoComplete="off"
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={displayNameHelpId}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <p id={displayNameHelpId} className="field__sublabel">
              É o nome que aparece para quem está nos seus grupos.
            </p>
            {errors.displayName ? <p className="field__error">{errors.displayName}</p> : null}
          </div>

          {createProfile.isError ? (
            <p className="form-error" role="alert">
              {describeError(createProfile.error, 'Não foi possível criar o perfil')}
            </p>
          ) : null}

          <div className="auth-card__actions">
            <button type="submit" className="button button--primary" disabled={createProfile.isPending}>
              Começar
            </button>
            <button type="button" className="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
              Sair
            </button>
          </div>
        </form>
      </section>
      <AppFooter />
    </main>
  );
}
