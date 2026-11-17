import { useId, useRef, type ReactNode } from 'react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Ação destrutiva: botão de confirmação em vermelho. */
  danger?: boolean;
  /** Ação em andamento: desabilita a confirmação. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação. O foco começa em Cancelar, a opção segura. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      title={title}
      onClose={onCancel}
      role="alertdialog"
      size="small"
      describedBy={messageId}
      initialFocusRef={cancelRef}
      footer={
        <>
          <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'button button--danger' : 'button button--primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p id={messageId} className="confirm-dialog__message">
        {message}
      </p>
    </Modal>
  );
}
