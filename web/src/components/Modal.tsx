import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
  );
}

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  size?: 'small' | 'large';
  describedBy?: string;
  /** Elemento que recebe o foco ao abrir. Padrão: o primeiro focável. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Diálogo modal acessível: portal em document.body, foco preso dentro,
 * Escape e clique no fundo fecham, e o foco volta para quem abriu.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  role = 'dialog',
  size = 'small',
  describedBy,
  initialFocusRef,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const target = initialFocusRef?.current ?? (dialog ? focusableElements(dialog)[0] : undefined) ?? dialog;
    target?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
    // O foco só muda ao abrir e ao fechar.
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onClose();
      return;
    }
    // Tab já tratado por quem está dentro (ex.: lista de tarefas do editor).
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    event.stopPropagation();
    const nodes = focusableElements(dialog);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      event.stopPropagation();
      onClose();
    }
  }

  return createPortal(
    <div className="modal-backdrop" data-testid="modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
