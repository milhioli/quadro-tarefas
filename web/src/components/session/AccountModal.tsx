import { PRIVACY_PATH, type BoardSummary, type MeUser } from '@quadro/shared';
import { useState } from 'react';
import { Modal } from '../Modal';
import { DeleteAccountDialog } from './DeleteAccountDialog';

export interface AccountModalProps {
  user: MeUser;
  boards: readonly BoardSummary[];
  onClose: () => void;
  onAccountDeleted: () => void;
}

/** "Minha conta": quem está logado, a privacidade e o "Apagar minha conta" (LGPD). */
export function AccountModal({ user, boards, onClose, onAccountDeleted }: AccountModalProps) {
  const [confirming, setConfirming] = useState(false);
  const ownedGroups = boards.filter((b) => b.kind === 'group' && b.role === 'owner').map((b) => b.name);

  if (confirming) {
    return (
      <DeleteAccountDialog
        user={user}
        ownedGroups={ownedGroups}
        onCancel={() => setConfirming(false)}
        onDeleted={onAccountDeleted}
      />
    );
  }

  return (
    <Modal
      title="Minha conta"
      onClose={onClose}
      footer={
        <button type="button" className="button" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <div className="task-form">
        <p>
          Você entrou como {user.displayName}{' '}
          <bdi>{user.handle}</bdi>.
        </p>
        <p>
          Veja o que guardamos e por quanto tempo na <a href={PRIVACY_PATH}>página de privacidade</a>.
        </p>
        <section aria-label="Apagar minha conta" className="account-modal__danger">
          {user.role === 'admin' ? (
            <p className="auth-card__muted">
              A conta de administrador não pode ser apagada pelo app. Veja em docs/deploy.md como fazer isso no servidor.
            </p>
          ) : (
            <>
              <p className="auth-card__muted">Apagar a conta tira seus dados do app. Isto não pode ser desfeito.</p>
              <button type="button" className="button button--danger-ghost" onClick={() => setConfirming(true)}>
                Apagar minha conta
              </button>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
