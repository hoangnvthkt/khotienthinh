import React from 'react';
import { ErpAction } from './PageHeader';

type ActionBarProps = {
  children?: React.ReactNode;
  primaryAction?: ErpAction;
  secondaryActions?: ErpAction[];
  stickyOnMobile?: boolean;
  className?: string;
};

const renderAction = (action: ErpAction, primary = false) => {
  const tone = action.tone || (primary ? 'primary' : 'neutral');
  const toneClass = {
    primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900',
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
    danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
  }[tone];
  const className = `inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${toneClass}`;

  if (action.href && !action.disabled) {
    return <a key={action.label} href={action.href} title={action.title} className={className}>{action.icon}{action.label}</a>;
  }
  return <button key={action.label} type="button" title={action.title} onClick={action.onClick} disabled={action.disabled} className={className}>{action.icon}{action.label}</button>;
};

const ActionBar: React.FC<ActionBarProps> = ({ children, primaryAction, secondaryActions = [], stickyOnMobile = true, className = '' }) => (
  <div className={`${stickyOnMobile ? 'sticky bottom-[52px] z-30 lg:static' : ''} flex flex-col gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 lg:flex-row lg:items-center lg:justify-between ${className}`}>
    <div className="min-w-0 flex-1">{children}</div>
    <div className="flex flex-wrap gap-2 lg:justify-end">
      {secondaryActions.map(action => renderAction(action))}
      {primaryAction && renderAction(primaryAction, true)}
    </div>
  </div>
);

export default ActionBar;
