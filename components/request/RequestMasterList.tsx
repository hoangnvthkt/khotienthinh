import React from 'react';
import type { RequestListItem } from '../../lib/requestRuntimeService';
import { RequestStatusBadge } from './RequestTable';

export const RequestMasterList: React.FC<{
  items: RequestListItem[];
  selectedId?: string;
  onSelect: (requestId: string) => void;
}> = ({ items, selectedId, onSelect }) => (
  <aside className="w-full shrink-0 overflow-y-auto border-r border-slate-200 bg-white md:w-[340px] dark:border-slate-800 dark:bg-slate-900">
    {items.map(item => <button type="button" key={item.id} onClick={() => onSelect(item.id)} className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition dark:border-slate-800 ${item.id === selectedId ? 'border-l-4 border-l-emerald-600 bg-emerald-50 dark:bg-emerald-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}><p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{item.title}</p><p className="mt-1 truncate text-xs text-slate-500">{item.templateName} · {item.creator.name}</p><div className="mt-2 flex items-center justify-between gap-2"><RequestStatusBadge status={item.status} /><span className="text-xs text-slate-400">{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(item.updatedAt))}</span></div></button>)}
  </aside>
);
