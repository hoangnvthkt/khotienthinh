import React, { useId } from 'react';
import { Loader2, X } from 'lucide-react';
import { formatDailyLogDate, type DailyLogDocumentMode } from '../../../lib/dailyLogPresentation';
import './daily-log-document.css';

export interface DailyLogDocumentAction {
  label: string;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void | Promise<void>;
}

export interface DailyLogDocumentHeaderProps {
  title: string;
  date: string;
  authorName: string;
  areaName?: string;
  statusLabel: string;
  statusTone?: 'neutral' | 'pending' | 'returned' | 'verified';
  mode: DailyLogDocumentMode;
  busyAction?: 'primary' | 'secondary' | null;
  primaryAction?: DailyLogDocumentAction;
  secondaryAction?: DailyLogDocumentAction;
  onClose: () => void;
}

export const DailyLogDocumentHeader: React.FC<DailyLogDocumentHeaderProps> = ({
  title, date, authorName, areaName, statusLabel, statusTone = 'neutral', mode,
  busyAction, primaryAction, secondaryAction, onClose,
}) => {
  const id = useId();
  const busy = Boolean(busyAction);
  const actions = mode === 'verified' ? [] : [
    secondaryAction && { action: secondaryAction, key: 'secondary' as const },
    primaryAction && { action: primaryAction, key: 'primary' as const },
  ].filter((value): value is { action: DailyLogDocumentAction; key: 'primary' | 'secondary' } => Boolean(value));
  const authorLabel = mode === 'author' ? 'Người lập' : 'Người tổng hợp';
  const unknownAuthor = mode === 'author' ? 'Chưa xác định người lập' : 'Chưa xác định người tổng hợp';

  return <header className="daily-log-document daily-log-document-header" aria-busy={busy}>
    <div className="daily-log-document-heading">
      <h2>{title}</h2>
      <span role="status" className={`daily-log-document-status daily-log-document-status--${mode === 'verified' ? 'verified' : statusTone}`}>{statusLabel}</span>
    </div>
    <dl className="daily-log-document-metadata">
      <div><dt>Ngày báo cáo</dt><dd>{formatDailyLogDate(date)}</dd></div>
      <div><dt>{authorLabel}</dt><dd>{authorName.trim() || unknownAuthor}</dd></div>
      {areaName !== undefined && <div><dt>Khu vực / mũi thi công</dt><dd>{areaName.trim() || 'Chưa xác định khu vực'}</dd></div>}
    </dl>
    <div className="daily-log-document-actionbar" aria-label="Thao tác phiếu">
      <div className="daily-log-document-buttons">
        {actions.map(({ action, key }) => {
          const reasonId = `${id}-${key}-reason`;
          return <button key={key} type="button" className={`daily-log-document-button daily-log-document-button--${key}`}
            disabled={busy || action.disabled} onClick={action.onClick}
            aria-describedby={action.disabled && action.disabledReason ? reasonId : undefined}>
            {busyAction === key && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            <span>{action.label}</span>
          </button>;
        })}
        <button type="button" className="daily-log-document-button daily-log-document-button--close" disabled={busy} onClick={onClose}>
          <X size={16} aria-hidden="true" /><span>Đóng</span>
        </button>
      </div>
      {actions.map(({ action, key }) => action.disabled && action.disabledReason
        ? <p key={key} id={`${id}-${key}-reason`} className="daily-log-document-action-reason">{action.disabledReason}</p>
        : null)}
    </div>
  </header>;
};
