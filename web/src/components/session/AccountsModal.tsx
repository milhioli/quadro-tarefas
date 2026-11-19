import type { AdminUser, MeUser } from '@quadro/shared';
import { useState } from 'react';
import { useAccounts, useDeleteDisabledAccount, useSetAccountStatus } from '../../api/account';
import { describeError } from '../../api/client';
import { ACCOUNT_STATUS_LABELS, formatLastSeen } from '../../lib/accounts';
import { ConfirmDialog } from '../ConfirmDialog';
import { Modal } from '../Modal';

export interface AccountsModalProps {
  /** O admin logado (a linha dele não tem botões). */
  user: MeUser;
  onClose: () => void;
}

interface Message {
  tone: 'info' | 'error';
  text: string;
}

type Pending = { kind: 'disable' | 'delete'; account: AdminUser } | null;

const nameOf = (account: AdminUser) => account.handle ?? account.email;

/**
 * Tela "Contas" do admin. O botão só aparece para o admin, mas quem decide é o
 * servidor (404 para os demais). O admin vê só handle, e-mail, situação e
 * último acesso: nada de quadros nem tarefas.
 */
export function AccountsModal({ user, onClose }: AccountsModalProps) {
  const accounts = useAccounts();
  const setStatus = useSetAccountStatus();
  const remove = useDeleteDisabledAccount();
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const fail = (fallback: string) => (error: unknown) => {
    setPending(null);
    setMessage({ tone: 'error', text: describeError(error, fallback) });
  };

  function reactivate(account: AdminUser): void {
    setStatus.mutate(
      { userId: account.id, status: 'active' },
      {
        onSuccess: () => setMessage({ tone: 'info', text: `${nameOf(account)} foi reativada.` }),
        onError: fail('Não foi possível reativar a conta'),
      },
    );
  }

  function confirm(): void {
    if (!pending) return;
    const { kind, account } = pending;
    if (kind === 'disable') {
      setStatus.mutate(
        { userId: account.id, status: 'disabled' },
        {
          onSuccess: () => {
            setPending(null);
            setMessage({ tone: 'info', text: `${nameOf(account)} foi desativada.` });
          },
          onError: fail('Não foi possível desativar a conta'),
        },
      );
    } else {
      remove.mutate(account.id, {
        onSuccess: () => {
          setPending(null);
          setMessage({ tone: 'info', text: `A conta ${nameOf(account)} foi apagada.` });
        },
        onError: fail('Não foi possível apagar a conta'),
      });
    }
  }

  return (
    <>
      <Modal
        title="Contas"
        onClose={onClose}
        size="large"
        footer={
          <button type="button" className="button" onClick={onClose}>
            Fechar
          </button>
        }
      >
        <div className="task-form">
          {message ? (
            <p className={message.tone === 'error' ? 'form-error' : 'group-message'} role={message.tone === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          ) : null}
          {accounts.isPending ? <p className="auth-card__muted">Carregando…</p> : null}
          {accounts.isError ? (
            <p className="form-error" role="alert">
              {describeError(accounts.error, 'Não foi possível carregar as contas')}
            </p>
          ) : null}
          {accounts.data ? (
            <ul className="member-list" aria-label="Contas">
              {accounts.data.map((account) => (
                <li key={account.id} className="member-list__item">
                  <span className="member-list__who">
                    {account.handle ? <bdi className="member-list__handle">{account.handle}</bdi> : <span>(sem perfil)</span>}{' '}
                    <span className="member-list__email">{account.email}</span>
                  </span>
                  <span className="member-list__status">
                    {ACCOUNT_STATUS_LABELS[account.status]} · último acesso {formatLastSeen(account.lastSeenAt)}
                  </span>
                  {account.id === user.id ? (
                    <span className="member-list__status">Você</span>
                  ) : account.status === 'active' ? (
                    <button
                      type="button"
                      className="button button--danger-ghost"
                      aria-label={`Desativar ${nameOf(account)}`}
                      onClick={() => setPending({ kind: 'disable', account })}
                    >
                      Desativar
                    </button>
                  ) : (
                    <span className="account-actions">
                      <button
                        type="button"
                        className="button"
                        aria-label={`Reativar ${nameOf(account)}`}
                        disabled={setStatus.isPending}
                        onClick={() => reactivate(account)}
                      >
                        Reativar
                      </button>
                      <button
                        type="button"
                        className="button button--danger-ghost"
                        aria-label={`Apagar ${nameOf(account)}`}
                        onClick={() => setPending({ kind: 'delete', account })}
                      >
                        Apagar
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>
      {pending ? (
        <ConfirmDialog
          title={pending.kind === 'disable' ? `Desativar ${nameOf(pending.account)}?` : `Apagar ${nameOf(pending.account)}?`}
          message={
            pending.kind === 'disable'
              ? 'A pessoa sai na hora de todas as sessões e não consegue entrar até você reativar. Os quadros e as tarefas dela continuam guardados.'
              : 'A conta é apagada de vez: os grupos dela passam para o membro mais antigo, e o quadro pessoal some. Isto não pode ser desfeito.'
          }
          confirmLabel={pending.kind === 'disable' ? 'Desativar' : 'Apagar conta'}
          danger
          busy={setStatus.isPending || remove.isPending}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
