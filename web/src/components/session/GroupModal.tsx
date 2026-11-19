import { boardNameSchema, parseHandle, type BoardSummary, type Member, type MeUser } from '@quadro/shared';
import { useId, useState, type FormEvent } from 'react';
import {
  useDeleteBoard,
  useInviteMember,
  useLeaveBoard,
  useMembers,
  useRemoveMember,
  useRenameBoard,
} from '../../api/account';
import { describeError } from '../../api/client';
import { ConfirmDialog } from '../ConfirmDialog';
import { Modal } from '../Modal';

export interface GroupModalProps {
  board: BoardSummary;
  user: MeUser;
  onClose: () => void;
  /** Depois de sair do grupo ou apagá-lo: quem chamou volta para o quadro pessoal. */
  onLeft: () => void;
}

interface Message {
  tone: 'info' | 'error';
  text: string;
}

function memberStatus(member: Member): string {
  if (member.role === 'owner') return 'Dono';
  return member.status === 'invited' ? 'Convite pendente' : 'Editor';
}

/**
 * Pessoas do grupo. Só o dono renomeia, convida, remove e apaga; quem é
 * editor só pode sair. O servidor confere tudo de novo.
 */
export function GroupModal({ board, user, onClose, onLeft }: GroupModalProps) {
  const isOwner = board.role === 'owner';
  const members = useMembers(board.id);
  const invite = useInviteMember(board.id);
  const remove = useRemoveMember(board.id);
  const rename = useRenameBoard(board.id);
  const deleteBoard = useDeleteBoard(board.id);
  const leave = useLeaveBoard(board.id, user.id);

  const [name, setName] = useState(board.name);
  const [handle, setHandle] = useState('');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirm, setConfirm] = useState<'none' | 'delete' | 'leave'>('none');
  const nameId = useId();
  const handleId = useId();
  const handleHelpId = useId();

  const fail = (fallback: string) => (error: unknown) => setMessage({ tone: 'error', text: describeError(error, fallback) });

  function handleRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = boardNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Nome inválido');
      return;
    }
    setNameError(null);
    rename.mutate(parsed.data, {
      onSuccess: (renamed) => setMessage({ tone: 'info', text: `O grupo agora se chama ${renamed.name}.` }),
      onError: fail('Não foi possível renomear o grupo'),
    });
  }

  function handleInvite(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!parseHandle(handle)) {
      setHandleError('Use o nome de usuário com o número (ex.: ana_07)');
      return;
    }
    setHandleError(null);
    invite.mutate(handle.trim(), {
      onSuccess: (member) => {
        setHandle('');
        setMessage({ tone: 'info', text: `Convite enviado para ${member.handle}.` });
      },
      onError: fail('Não foi possível convidar'),
    });
  }

  function handleRemove(member: Member): void {
    remove.mutate(member.userId, {
      onSuccess: () =>
        setMessage({
          tone: 'info',
          text: member.status === 'invited' ? `Convite de ${member.handle} cancelado.` : `${member.handle} saiu do grupo.`,
        }),
      onError: fail('Não foi possível remover'),
    });
  }

  function confirmAction(): void {
    const action = confirm === 'delete' ? deleteBoard : leave;
    action.mutate(undefined, {
      onSuccess: onLeft,
      onError: (error) => {
        setConfirm('none');
        fail(confirm === 'delete' ? 'Não foi possível apagar o grupo' : 'Não foi possível sair do grupo')(error);
      },
    });
  }

  return (
    <>
      <Modal
        title={`Grupo: ${board.name}`}
        onClose={onClose}
        size="large"
        footer={
          <>
            {isOwner ? (
              <button type="button" className="button button--danger-ghost" onClick={() => setConfirm('delete')}>
                Apagar grupo
              </button>
            ) : (
              <button type="button" className="button button--danger-ghost" onClick={() => setConfirm('leave')}>
                Sair do grupo
              </button>
            )}
            <span className="modal__spacer" />
            <button type="button" className="button" onClick={onClose}>
              Fechar
            </button>
          </>
        }
      >
        <div className="task-form">
          {isOwner ? (
            <form className="group-form" onSubmit={handleRename} noValidate>
              <div className="field">
                <label className="field__label" htmlFor={nameId}>
                  Nome do grupo
                </label>
                <input
                  id={nameId}
                  className="input"
                  value={name}
                  autoComplete="off"
                  aria-invalid={nameError ? true : undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                {nameError ? <p className="field__error">{nameError}</p> : null}
              </div>
              <button type="submit" className="button" disabled={rename.isPending}>
                Salvar nome
              </button>
            </form>
          ) : null}

          <section aria-label="Pessoas do grupo">
            <h3 className="field__label">Pessoas</h3>
            {members.isPending ? <p className="auth-card__muted">Carregando…</p> : null}
            {members.isError ? (
              <p className="form-error" role="alert">
                {describeError(members.error, 'Não foi possível carregar as pessoas')}
              </p>
            ) : null}
            {members.data ? (
              <ul className="member-list">
                {members.data.map((member) => (
                  <li key={member.userId} className="member-list__item">
                    <span className="member-list__who">
                      <span className="member-list__name">{member.displayName}</span>{' '}
                      <bdi className="member-list__handle">{member.handle}</bdi>
                    </span>
                    <span className="member-list__status">{memberStatus(member)}</span>
                    {isOwner && member.userId !== user.id ? (
                      <button
                        type="button"
                        className="button button--danger-ghost"
                        aria-label={
                          member.status === 'invited' ? `Cancelar o convite de ${member.handle}` : `Remover ${member.handle}`
                        }
                        disabled={remove.isPending}
                        onClick={() => handleRemove(member)}
                      >
                        {member.status === 'invited' ? 'Cancelar convite' : 'Remover'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {isOwner ? (
            <form className="group-form" onSubmit={handleInvite} noValidate>
              <div className="field">
                <label className="field__label" htmlFor={handleId}>
                  Convidar pelo nome de usuário
                </label>
                <input
                  id={handleId}
                  className="input"
                  value={handle}
                  placeholder="ana_07"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={handleError ? true : undefined}
                  aria-describedby={handleHelpId}
                  onChange={(event) => setHandle(event.target.value)}
                />
                <p id={handleHelpId} className="field__sublabel">
                  Com o número, do jeito que aparece para a pessoa. Ela precisa aceitar o convite.
                </p>
                {handleError ? <p className="field__error">{handleError}</p> : null}
              </div>
              <button type="submit" className="button button--primary" disabled={invite.isPending}>
                Convidar
              </button>
            </form>
          ) : (
            <p className="auth-card__muted">Só quem criou o grupo convida e remove pessoas.</p>
          )}

          {message ? (
            <p
              className={message.tone === 'error' ? 'form-error' : 'group-message'}
              role={message.tone === 'error' ? 'alert' : 'status'}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </Modal>

      {confirm === 'delete' ? (
        <ConfirmDialog
          title="Apagar o grupo?"
          message="O grupo e todas as tarefas dele são apagados para todas as pessoas. Isso não pode ser desfeito."
          confirmLabel="Apagar grupo"
          danger
          busy={deleteBoard.isPending}
          onConfirm={confirmAction}
          onCancel={() => setConfirm('none')}
        />
      ) : null}
      {confirm === 'leave' ? (
        <ConfirmDialog
          title="Sair do grupo?"
          message="Você deixa de ver o quadro e as tarefas do grupo. Para voltar, o dono precisa te convidar de novo."
          confirmLabel="Sair do grupo"
          danger
          busy={leave.isPending}
          onConfirm={confirmAction}
          onCancel={() => setConfirm('none')}
        />
      ) : null}
    </>
  );
}
