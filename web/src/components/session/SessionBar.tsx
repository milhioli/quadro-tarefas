import type { BoardSummary, MeUser } from '@quadro/shared';
import { useState } from 'react';
import { useInvites, useLogout } from '../../api/account';
import { describeError } from '../../api/client';
import { AccountModal } from './AccountModal';
import { AccountsModal } from './AccountsModal';
import { BoardPicker } from './BoardPicker';
import { InvitesModal } from './InvitesModal';

export interface SessionBarProps {
  user: MeUser;
  boards: readonly BoardSummary[];
  boardId: number;
  onChooseBoard: (boardId: number) => void;
  /** Chamado depois de sair (para esquecer o quadro escolhido). */
  onLoggedOut?: () => void;
  /** Chamado depois de apagar a conta (o Shell mostra o aviso na tela de entrada). */
  onAccountDeleted?: () => void;
}

/** Barra no topo: quadro aberto, convites recebidos, quem está logado, "Minha conta", "Contas" (admin) e "Sair". */
export function SessionBar({ user, boards, boardId, onChooseBoard, onLoggedOut, onAccountDeleted }: SessionBarProps) {
  const logout = useLogout(onLoggedOut);
  const invites = useInvites();
  const [showInvites, setShowInvites] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const pending = invites.data?.length ?? 0;

  return (
    <div className="session-bar">
      <BoardPicker user={user} boards={boards} boardId={boardId} onChoose={onChooseBoard} />
      <div className="session-bar__account">
        {pending > 0 ? (
          <button type="button" className="button" onClick={() => setShowInvites(true)}>
            Convites ({pending})
          </button>
        ) : null}
        <span className="session-bar__who">
          <span className="session-bar__name">{user.displayName}</span>{' '}
          <bdi className="session-bar__handle">{user.handle}</bdi>
        </span>
        {/* Só esconde o botão: quem decide é o servidor (404 para quem não é admin). */}
        {user.role === 'admin' ? (
          <button type="button" className="button" onClick={() => setShowAccounts(true)}>
            Contas
          </button>
        ) : null}
        <button type="button" className="button" onClick={() => setShowAccount(true)}>
          Minha conta
        </button>
        <button type="button" className="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
          Sair
        </button>
      </div>
      {logout.isError ? (
        <p className="form-error session-bar__error" role="alert">
          {describeError(logout.error, 'Não foi possível sair')}
        </p>
      ) : null}
      {showAccount ? (
        <AccountModal
          user={user}
          boards={boards}
          onClose={() => setShowAccount(false)}
          onAccountDeleted={() => onAccountDeleted?.()}
        />
      ) : null}
      {showAccounts ? <AccountsModal user={user} onClose={() => setShowAccounts(false)} /> : null}
      {showInvites ? (
        <InvitesModal
          onClose={() => setShowInvites(false)}
          onAccepted={(board) => {
            setShowInvites(false);
            onChooseBoard(board.id);
          }}
        />
      ) : null}
    </div>
  );
}
