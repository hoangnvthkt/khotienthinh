import React from 'react';

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
  compact?: boolean;
};

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, message, action, compact = false }) => (
  <div className={`rounded-lg border border-dashed border-slate-200 bg-white px-4 text-center dark:border-slate-700 dark:bg-slate-900 ${compact ? 'py-6' : 'py-10'}`}>
    {icon && <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500">{icon}</div>}
    <p className="text-sm font-black text-slate-700 dark:text-slate-200">{title}</p>
    {message && <p className="mx-auto mt-1 max-w-md text-xs font-medium leading-5 text-slate-400 dark:text-slate-500">{message}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;
