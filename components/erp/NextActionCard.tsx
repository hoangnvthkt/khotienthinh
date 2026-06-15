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
  category?: 'workflow' | 'rq' | 'material' | 'transaction' | 'tracking' | 'warning';
};

const formatDue = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const CATEGORY_STYLES = {
  workflow: {
    border: 'border-l-4 border-l-indigo-500',
    bgDecor: 'bg-indigo-500/5 dark:bg-indigo-400/5',
    text: 'text-indigo-600 dark:text-indigo-400'
  },
  rq: {
    border: 'border-l-4 border-l-teal-500',
    bgDecor: 'bg-teal-500/5 dark:bg-teal-400/5',
    text: 'text-teal-600 dark:text-teal-400'
  },
  material: {
    border: 'border-l-4 border-l-amber-500',
    bgDecor: 'bg-amber-500/5 dark:bg-amber-400/5',
    text: 'text-amber-600 dark:text-amber-400'
  },
  transaction: {
    border: 'border-l-4 border-l-cyan-500',
    bgDecor: 'bg-cyan-500/5 dark:bg-cyan-400/5',
    text: 'text-cyan-600 dark:text-cyan-400'
  },
  warning: {
    border: 'border-l-4 border-l-red-500',
    bgDecor: 'bg-red-500/5 dark:bg-red-400/5',
    text: 'text-red-600 dark:text-red-400'
  },
  tracking: {
    border: 'border-l-4 border-l-slate-400',
    bgDecor: 'bg-slate-500/5 dark:bg-slate-450/5',
    text: 'text-slate-500 dark:text-slate-400'
  }
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
  category,
}) => {
  const style = CATEGORY_STYLES[category || 'tracking'];

  const content = (
    <>
      {/* Decorative circle shape */}
      <div className={`absolute top-0 right-0 w-20 h-20 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110 ${style.bgDecor}`} />

      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {code && <div className={`mb-1 font-mono text-[10px] font-bold uppercase tracking-wider ${style.text}`}>{code}</div>}
              <h3 className="line-clamp-2 text-sm font-black leading-5 text-slate-800 dark:text-white">{title}</h3>
            </div>
            <StatusBadge status={status} label={statusLabel} tone={tone} />
          </div>
          <div className="mt-3 bg-slate-50/70 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100/50 dark:border-slate-800/30">
            <p className="text-xs font-bold leading-relaxed text-slate-600 dark:text-slate-300">{nextAction}</p>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400">
            {actorName && <span className="inline-flex items-center gap-1"><UserRound size={11} />{actorName}</span>}
            {dueAt && <span className="inline-flex items-center gap-1"><CalendarClock size={11} />{formatDue(dueAt)}</span>}
          </div>
          {(href || onClick) && (
            <div className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-350 group-hover:text-teal-650 dark:group-hover:text-teal-400 transition-colors">
              {actionLabel} <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform duration-300" />
            </div>
          )}
        </div>
      </div>
    </>
  );

  const className = `relative overflow-hidden block h-full rounded-2xl border border-slate-100/80 bg-gradient-to-br from-white to-slate-50/50 p-5 text-left shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5 dark:border-slate-750 dark:from-slate-800 dark:to-slate-900/50 group ${style.border}`;

  if (href) return <Link to={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
};

export default NextActionCard;
