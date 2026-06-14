import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, UserRound } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { ErpStatusTone } from './status';

export type NextActionCardProps = {
  title: string;
  code?: string;
  status?: string | null;
  statusLabel?: string;
  tone?: ErpStatusTone;
  nextAction: string;
  actorName?: string;
  dueAt?: string | null;
  href?: string;
  onClick?: () => void;
  actionLabel?: string;
};

const formatDue = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const NextActionCard: React.FC<NextActionCardProps> = ({
  title,
  code,
  status,
  statusLabel,
  tone,
  nextAction,
  actorName,
  dueAt,
  href,
  onClick,
  actionLabel = 'Mở',
}) => {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {code && <div className="mb-1 font-mono text-[10px] font-black uppercase text-slate-400">{code}</div>}
          <h3 className="line-clamp-2 text-sm font-black leading-5 text-slate-900 dark:text-white">{title}</h3>
        </div>
        <StatusBadge status={status} label={statusLabel} tone={tone} />
      </div>
      <p className="mt-3 text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">{nextAction}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-slate-400">
        {actorName && <span className="inline-flex items-center gap-1"><UserRound size={12} />{actorName}</span>}
        {dueAt && <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{formatDue(dueAt)}</span>}
      </div>
      {(href || onClick) && (
        <div className="mt-4 inline-flex items-center gap-1 text-xs font-black text-slate-900 dark:text-white">
          {actionLabel} <ArrowRight size={13} />
        </div>
      )}
    </>
  );

  const className = 'block h-full rounded-2xl border border-slate-100/80 bg-gradient-to-br from-white to-slate-50/50 p-5 text-left shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5 dark:border-slate-750 dark:from-slate-800 dark:to-slate-900/50 group';

  if (href) return <Link to={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
};

export default NextActionCard;
