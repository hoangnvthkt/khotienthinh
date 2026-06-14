import React from 'react';

export type ErpAction = {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
};

const ActionButton: React.FC<{ action: ErpAction; primary?: boolean }> = ({ action, primary = false }) => {
  const className = primary
    ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100'
    : 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';

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
  title: string;
  description?: string;
  meta?: React.ReactNode;
  primaryAction?: ErpAction;
  secondaryActions?: ErpAction[];
};

const PageHeader: React.FC<PageHeaderProps> = ({ eyebrow, title, description, meta, primaryAction, secondaryActions = [] }) => (
  <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0">
      {eyebrow && <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{eyebrow}</div>}
      <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h1>
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
