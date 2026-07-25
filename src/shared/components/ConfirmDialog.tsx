import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useI18n } from '../../core/i18n/I18nContext';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

    const dialog = dialogRef.current;
    const initialFocus = cancelRef.current?.disabled
      ? focusableElements(dialog ?? document.body)[0]
      : cancelRef.current;
    (initialFocus ?? dialog)?.focus();

    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <button
          className="icon-button confirm-dialog__close"
          aria-label={t('common.close')}
          onClick={onCancel}
        >
          <X size={17} />
        </button>
        <div className="confirm-dialog__icon" aria-hidden="true">
          <AlertTriangle size={20} />
        </div>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        <div className="confirm-dialog__actions">
          <button
            className="button button--secondary"
            onClick={onCancel}
            disabled={pending}
            ref={cancelRef}
          >
            {t('common.cancel')}
          </button>
          <button className="button button--danger" onClick={onConfirm} disabled={pending}>
            {pending ? t('common.removing') : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
