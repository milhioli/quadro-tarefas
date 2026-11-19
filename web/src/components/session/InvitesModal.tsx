import type { BoardSummary } from '@quadro/shared';
import { useState } from 'react';
import { useAcceptInvite, useDeclineInvite, useInvites } from '../../api/account';
import { describeError } from '../../api/client';
import { Modal } from '../Modal';

export interface InvitesModalProps {
  onClose: () => void;
  /** Depois de aceitar: quem chamou abre o quadro do grupo. */
  onAccepted: (board: BoardSummary) => void;
}

/** Convites recebidos: só o nome do quadro e quem convidou. */
export function InvitesModal({ onClose, onAccepted }: InvitesModalProps) {
  const invites = useInvites();
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const [error, setError] = useState<string | null>(null);
  const busy = accept.isPending || decline.isPending;

  return (
    <Modal
      title="Convites"
      onClose={onClose}
      footer={
        <button type="button" className="button" onClick={onClose}>
          Fechar
        </button>
      }
    >
      {invites.isError ? (
        <p className="form-error" role="alert">
          {describeError(invites.error, 'Não foi possível carregar os convites')}
        </p>
      ) : null}
      {invites.data && invites.data.length === 0 ? <p className="auth-card__muted">Nenhum convite pendente.</p> : null}
      {invites.data && invites.data.length > 0 ? (
        <ul className="member-list">
          {invites.data.map((invite) => (
            <li key={invite.boardId} className="member-list__item">
              <span className="member-list__who">
                <span className="member-list__name">{invite.boardName}</span>
                {invite.invitedBy ? (
                  <>
                    {' '}
                    <span className="member-list__status">
                      convite de <bdi className="member-list__handle">{invite.invitedBy}</bdi>
                    </span>
                  </>
                ) : null}
              </span>
              <button
                type="button"
                className="button button--primary"
                aria-label={`Aceitar o convite para ${invite.boardName}`}
                disabled={busy}
                onClick={() =>
                  accept.mutate(invite.boardId, {
                    onSuccess: onAccepted,
                    onError: (failure) => setError(describeError(failure, 'Não foi possível aceitar o convite')),
                  })
                }
              >
                Aceitar
              </button>
              <button
                type="button"
                className="button"
                aria-label={`Recusar o convite para ${invite.boardName}`}
                disabled={busy}
                onClick={() =>
                  decline.mutate(invite.boardId, {
                    onError: (failure) => setError(describeError(failure, 'Não foi possível recusar o convite')),
                  })
                }
              >
                Recusar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
