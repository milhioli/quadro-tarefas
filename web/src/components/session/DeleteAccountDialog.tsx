import type { MeUser } from '@quadro/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useDeleteAccount } from '../../api/account';
import { ApiError, describeError } from '../../api/client';
import { googleStartUrl } from '../../lib/login';
import { Modal } from '../Modal';

export interface DeleteAccountDialogProps {
  user: MeUser;
  /** Nomes dos grupos que a pessoa criou (o destino de cada um é explicado). */
  ownedGroups: readonly string[];
  onCancel: () => void;
  /** Depois de apagar, antes de o cache ser zerado (o Shell mostra o aviso na tela de entrada). */
  onDeleted: () => void;
}

/**
 * Confirmação de "apagar minha conta": explica o que acontece e só libera o
 * botão quando a pessoa digita o próprio nome de usuário. O servidor exige uma
 * sessão recém-aberta; se ela for antiga, o diálogo oferece entrar de novo.
 */
export function DeleteAccountDialog({ user, ownedGroups, onCancel, onDeleted }: DeleteAccountDialogProps) {
  const remove = useDeleteAccount(onDeleted);
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const descriptionId = useId();
  const matches = typed.trim().toLowerCase() === user.handle;
  const needsReauth = remove.error instanceof ApiError && remove.error.code === 'REAUTH_REQUIRED';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (matches && !remove.isPending) remove.mutate();
  }

  return (
    <Modal
      title="Apagar sua conta?"
      onClose={onCancel}
      role="alertdialog"
      describedBy={descriptionId}
      initialFocusRef={inputRef}
      footer={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="submit"
            form={`${inputId}-form`}
            className="button button--danger"
            disabled={!matches || remove.isPending}
          >
            Apagar minha conta
          </button>
        </>
      }
    >
      <form id={`${inputId}-form`} className="task-form" onSubmit={handleSubmit} noValidate>
        <div id={descriptionId}>
          <ul className="delete-account__list">
            <li>Seu quadro pessoal e as tarefas dele são apagados.</li>
            <li>Você sai de todos os grupos, e os convites pendentes somem.</li>
            <li>
              Cada grupo que você criou passa para a pessoa que participa dele há mais tempo. Um grupo sem mais ninguém é
              apagado com as tarefas.
            </li>
            <li>As tarefas que você criou em grupos de outras pessoas continuam lá, sem o seu nome.</li>
            <li>
              O nome de usuário{' '}
              <bdi>{user.handle}</bdi> não volta a ser usado. Entrar de novo com a mesma conta Google começa uma conta nova.
            </li>
            <li>As cópias de segurança guardam o que foi apagado por até 10 dias.</li>
          </ul>
          {ownedGroups.length > 0 ? (
            <p>
              Grupos que você criou: <span className="delete-account__groups">{ownedGroups.join(', ')}</span>.
            </p>
          ) : null}
          <p>
            <strong>Isto não pode ser desfeito.</strong>
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={inputId}>
            Para confirmar, digite seu nome de usuário:{' '}
            <bdi>{user.handle}</bdi>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>

        {needsReauth ? (
          <p className="form-error" role="alert">
            Por segurança, entre de novo para apagar a conta.{' '}
            <a href={googleStartUrl('/')}>Entrar de novo</a>
          </p>
        ) : remove.isError ? (
          <p className="form-error" role="alert">
            {describeError(remove.error, 'Não foi possível apagar a conta')}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
