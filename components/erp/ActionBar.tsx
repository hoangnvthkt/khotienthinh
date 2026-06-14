import React from 'react';
import { ErpAction } from './PageHeader';

type ActionBarProps = {
  children?: React.ReactNode;
  primaryAction?: ErpAction;
  secondaryActions?: ErpAction[];
  stickyOnMobile?: boolean;
};

const renderAction = (action: ErpAction, primary = false) => {
  const className = primary
    ? 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900'
    : 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

  if (action.href && !action.disabled) {
    return <a key={action.label} href={action.href} title={action.title} className={className}>{action.icon}{action.label}</a>;
  }
  return <button key={action.label} type="button" title={action.title} onClick={action.onClick} disabled={action.disabled} className={className}>{action.icon}{action.label}</button>;
};

const ActionBar: React.FC<ActionBarProps> = ({ children, primaryAction, secondaryActions = [], stickyOnMobile = true }) => (
  <div className={`${stickyOnMobile ? 'sticky bottom-[52px] z-30 lg:static' : ''} flex flex-col gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 lg:flex-row lg:items-center lg:justify-between`}>
    <div className="min-w-0 flex-1">{children}</div>
    <div className="flex flex-wrap gap-2 lg:justify-end">
      {secondaryActions.map(action => renderAction(action))}
      {primaryAction && renderAction(primaryAction, true)}
    </div>
  </div>
);

export default ActionBar;
