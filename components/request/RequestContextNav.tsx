import React from 'react';
import { BellRing, Inbox, PanelLeftClose, PanelLeftOpen, Send, UserRoundCheck } from 'lucide-react';
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
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}> = ({ view, onChange, summary, isCollapsed = false, onToggleCollapse }) => (
  <nav
    aria-label="Điều hướng đề xuất"
    className={`flex shrink-0 transition-all duration-200 border-b border-slate-200 bg-slate-50/80 px-2 py-2 dark:border-slate-800 dark:bg-slate-950/80 ${
      isCollapsed
        ? 'overflow-x-auto md:w-16 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-2 md:py-3'
        : 'overflow-x-auto md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4'
    }`}
  >
    <div className="hidden items-center justify-between px-2 pb-3 md:flex">
      {!isCollapsed && (
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Đề xuất</span>
      )}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition ${
            isCollapsed ? 'mx-auto' : ''
          }`}
          title={isCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
        >
          {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      )}
    </div>

    <div className="flex flex-row gap-1 md:flex-col">
      {items.map(item => {
        const Icon = item.icon;
        const active = view === item.view;
        const count = summary ? summary[item.summaryKey] : null;

        if (isCollapsed) {
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onChange(item.view)}
              title={`${item.label}${count !== null ? ` (${count})` : ''}`}
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                active
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:bg-slate-900'
              }`}
            >
              <Icon size={18} />
              {count !== null && count > 0 && (
                <span className={`absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                  active ? 'bg-amber-400 text-slate-900' : 'bg-emerald-600 text-white'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        }

        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onChange(item.view)}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
              active
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white'
            }`}
          >
            <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />
            <span className="whitespace-nowrap font-semibold">{item.label}</span>
            {count !== null && (
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
                  active ? 'bg-emerald-700/60 text-emerald-100' : 'bg-slate-200/60 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  </nav>
);

