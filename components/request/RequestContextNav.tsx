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
    className={`flex shrink-0 transition-all duration-200 border-b border-border bg-card px-2 py-1.5 ${
      isCollapsed
        ? 'overflow-x-auto no-scrollbar md:w-16 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-2 md:py-3'
        : 'overflow-x-auto no-scrollbar md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4'
    }`}
  >
    <div className="hidden items-center justify-between px-2 pb-3 md:flex">
      {!isCollapsed && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đề xuất</span>
      )}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground ${
            isCollapsed ? 'mx-auto' : ''
          }`}
          title={isCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
        >
          {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      )}
    </div>

    <div className="flex flex-row items-center gap-1.5 md:flex-col md:items-stretch">
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
              className={`relative flex h-9 w-9 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-xl transition ${
                active
                  ? 'bg-teal-700 text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon size={17} />
              {count !== null && count > 0 && (
                <span className={`absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                  item.view === 'ASSIGNED_TO_ME' ? 'bg-leaf-600 text-white' : 'bg-slate-600 text-white'
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
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition sm:px-3 sm:py-2 sm:text-sm ${
              active
                ? 'bg-mint-50 font-semibold text-teal-800 ring-1 ring-inset ring-mint-200 dark:bg-mint-900/40 dark:text-teal-200 dark:ring-mint-900'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon size={16} className={`shrink-0 ${active ? 'text-teal-700 dark:text-teal-300' : ''}`} />
            <span className="whitespace-nowrap">{item.label}</span>
            {count !== null && (
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums sm:ml-auto ${
                  item.view === 'ASSIGNED_TO_ME' && count > 0
                    ? 'bg-leaf-600 text-white'
                    : active ? 'bg-teal-700 text-white' : 'bg-muted text-muted-foreground'
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
