import React from 'react';
import { ChevronLeft, ChevronRight, ListFilter } from 'lucide-react';
import type { RequestListItem } from '../../lib/requestRuntimeService';
import { RequestStatusBadge } from './RequestTable';

export const RequestMasterList: React.FC<{
  items: RequestListItem[];
  selectedId?: string;
  onSelect: (requestId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}> = ({ items, selectedId, onSelect, isCollapsed = false, onToggleCollapse }) => {
  if (isCollapsed) {
    return (
      <aside className="hidden md:flex w-12 shrink-0 flex-col items-center border-r border-slate-200 bg-slate-50/60 py-3 dark:border-slate-800 dark:bg-slate-900/60">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            title="Mở rộng danh sách đề xuất"
          >
            <ChevronRight size={18} />
          </button>
        )}
        <div className="mt-4 flex flex-col gap-2 items-center">
          <span className="writing-vertical text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Danh sách ({items.length})
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full shrink-0 flex flex-col overflow-hidden border-r border-slate-200 bg-white md:w-[320px] lg:w-[340px] dark:border-slate-800 dark:bg-slate-900 transition-all duration-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
        <div className="flex items-center gap-2">
          <ListFilter size={15} className="text-slate-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Đề xuất ({items.length})
          </span>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            title="Thu gọn danh sách"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
        {items.map(item => {
          const isSelected = item.id === selectedId;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`group relative block w-full p-4 text-left transition-all duration-150 ${
                isSelected
                  ? 'border-l-4 border-l-emerald-600 bg-emerald-50/80 shadow-sm dark:border-l-emerald-500 dark:bg-emerald-950/30'
                  : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold font-mono text-emerald-700 dark:text-emerald-400">
                  {item.code}
                </p>
                <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                  {new Intl.DateTimeFormat('vi-VN', { month: '2-digit', day: '2-digit' }).format(new Date(item.updatedAt))}
                </span>
              </div>

              <h3 className={`mt-1 line-clamp-2 text-sm font-semibold leading-snug transition-colors ${
                isSelected
                  ? 'text-emerald-950 dark:text-emerald-100 font-bold'
                  : 'text-slate-800 group-hover:text-emerald-700 dark:text-slate-200 dark:group-hover:text-emerald-400'
              }`}>
                {item.title}
              </h3>

              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                {item.templateName} <span className="text-slate-300 dark:text-slate-600">•</span> {item.creator.name}
              </p>

              <div className="mt-2.5 flex items-center justify-between">
                <RequestStatusBadge status={item.status} />
              </div>
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="p-8 text-center text-xs text-slate-400">
            Không có đề xuất nào trong danh mục này.
          </div>
        )}
      </div>
    </aside>
  );
};
