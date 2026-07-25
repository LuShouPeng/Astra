import { AlertTriangle, X } from 'lucide-react';
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
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
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
          <button className="button button--secondary" onClick={onCancel} disabled={pending}>
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
