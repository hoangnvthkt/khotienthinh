import React from 'react';
import { ERP_TONE_STYLES, ErpStatusTone, getDefaultStatusLabel, getDefaultStatusTone } from './status';

type StatusBadgeProps = {
  status?: string | null;
  label?: string;
  tone?: ErpStatusTone;
  size?: 'sm' | 'md';
  className?: string;
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, tone, size = 'sm', className = '' }) => {
  const resolvedTone = tone || getDefaultStatusTone(status);
  const styles = ERP_TONE_STYLES[resolvedTone];
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-0.5 text-[10px]';

  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full border font-black ${sizeClass} ${styles.badge} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {label || getDefaultStatusLabel(status)}
    </span>
  );
};

export default StatusBadge;
