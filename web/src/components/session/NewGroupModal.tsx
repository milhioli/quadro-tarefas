import { boardNameSchema, type BoardSummary } from '@quadro/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useCreateBoard } from '../../api/account';
import { describeError } from '../../api/client';
import { Modal } from '../Modal';

export interface NewGroupModalProps {
  onClose: () => void;
  onCreated: (board: BoardSummary) => void;
}

export function NewGroupModal({ onClose, onCreated }: NewGroupModalProps) {
  const create = useCreateBoard();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = boardNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Nome inválido');
      return;
    }
    setError(null);
    create.mutate(parsed.data, {
      onSuccess: onCreated,
      onError: (failure) => setError(describeError(failure, 'Não foi possível criar o grupo')),
    });
  }

  return (
    <Modal
      title="Novo grupo"
      onClose={onClose}
      initialFocusRef={nameRef}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="button button--primary" disabled={create.isPending}>
            Criar grupo
          </button>
        </>
      }
    >
      <form id={formId} className="task-form" onSubmit={handleSubmit} noValidate>
        <p className="confirm-dialog__message">
          Um grupo tem um quadro próprio. Depois de criar, convide as pessoas pelo nome de usuário delas.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={nameId}>
            Nome do grupo
          </label>
          <input
            ref={nameRef}
            id={nameId}
            className="input"
            value={name}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
