import React from 'react';

export type ErpAction = {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
  tone?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger';
};

const ActionButton: React.FC<{ action: ErpAction; primary?: boolean }> = ({ action, primary = false }) => {
  const tone = action.tone || (primary ? 'primary' : 'neutral');
  const toneClass = {
    primary: 'border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100',
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
    danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
  }[tone];
  const className = `inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${toneClass}`;

  if (action.href && !action.disabled) {
    return (
      <a href={action.href} title={action.title} className={className}>
        {action.icon}
        {action.label}
      </a>
    );
  }

  return (
    <button type="button" onClick={action.onClick} disabled={action.disabled} title={action.title} className={className}>
      {action.icon}
      {action.label}
    </button>
  );
};

type PageHeaderProps = {
  eyebrow?: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  primaryAction?: ErpAction;
  secondaryActions?: ErpAction[];
};

const PageHeader: React.FC<PageHeaderProps> = ({ eyebrow, icon, title, description, meta, primaryAction, secondaryActions = [] }) => (
  <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0">
      {eyebrow && <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">{eyebrow}</div>}
      <div className="mt-1 flex min-w-0 items-center gap-2.5">
        {icon && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">{icon}</div>}
        <h1 className="min-w-0 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h1>
      </div>
      {description && <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
      {meta && <div className="mt-3 flex flex-wrap gap-2">{meta}</div>}
    </div>
    {(primaryAction || secondaryActions.length > 0) && (
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {secondaryActions.map(action => <ActionButton key={action.label} action={action} />)}
        {primaryAction && <ActionButton action={primaryAction} primary />}
      </div>
    )}
  </header>
);

export default PageHeader;
