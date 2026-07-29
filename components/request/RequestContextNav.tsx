import React from 'react';
import { BellRing, Inbox, Send, UserRoundCheck } from 'lucide-react';
import type { RequestListFilter } from '../../hooks/useRequestList';
import type { RequestSummary } from '../../lib/requestRuntimeService';

const items: Array<{ view: RequestListFilter['view']; label: string; icon: typeof Inbox; summaryKey: keyof RequestSummary }> = [
  { view: 'ALL', label: 'Tất cả', icon: Inbox, summaryKey: 'all' },
  { view: 'ASSIGNED_TO_ME', label: 'Gửi đến tôi', icon: UserRoundCheck, summaryKey: 'assignedToMe' },
  { view: 'CREATED_BY_ME', label: 'Tôi gửi đi', icon: Send, summaryKey: 'createdByMe' },
  { view: 'WATCHING', label: 'Đang theo dõi', icon: BellRing, summaryKey: 'watching' },
];

export const RequestContextNav: React.FC<{
  view: RequestListFilter['view'];
  onChange: (view: RequestListFilter['view']) => void;
  summary?: RequestSummary | null;
}> = ({ view, onChange, summary }) => (
  <nav aria-label="Điều hướng đề xuất" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-2 md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4 dark:border-slate-800 dark:bg-slate-950">
    <p className="hidden px-2 pb-2 text-xs font-bold uppercase tracking-wide text-slate-400 md:block">Đề xuất</p>
    {items.map(item => {
      const Icon = item.icon;
      const active = view === item.view;
      return <button key={item.view} type="button" onClick={() => onChange(item.view)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${active ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900'}`}>
        <Icon size={16} /><span className="whitespace-nowrap">{item.label}</span>
        {summary && <span className={`ml-auto text-xs ${active ? 'text-emerald-100' : 'text-slate-400'}`}>{summary[item.summaryKey]}</span>}
      </button>;
    })}
  </nav>
);
