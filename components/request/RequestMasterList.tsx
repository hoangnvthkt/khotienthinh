import React from 'react';
import { ChevronLeft, ChevronRight, ListFilter } from 'lucide-react';
import type { RequestListItem } from '../../lib/requestRuntimeService';
import { ApproverStack, RequestStatusBadge } from './RequestTable';
import { useRequestHoverPreview } from './RequestHoverPreview';

export const RequestMasterList: React.FC<{
  items: RequestListItem[];
  selectedId?: string;
  onSelect: (requestId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}> = ({ items, selectedId, onSelect, isCollapsed = false, onToggleCollapse }) => {
  const { bind, preview } = useRequestHoverPreview('right');
  if (isCollapsed) {
    return (
      <aside className="hidden md:flex w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="Mở rộng danh sách đề xuất"
          >
            <ChevronRight size={18} />
          </button>
        )}
        <div className="mt-4 flex flex-col gap-2 items-center">
          <span className="writing-vertical text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Danh sách ({items.length})
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full shrink-0 flex flex-col overflow-hidden border-r border-border bg-card md:w-[320px] lg:w-[340px] transition-all duration-200">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ListFilter size={15} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">
            Đề xuất ({items.length})
          </span>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="Thu gọn danh sách"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {items.map(item => {
          const isSelected = item.id === selectedId;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              aria-current={isSelected}
              className={`group relative block w-full border-l-4 px-4 py-3 text-left transition-colors ${
                isSelected
                  ? 'border-l-teal-600 bg-mint-50 dark:bg-mint-900/30'
                  : 'border-l-transparent hover:bg-mint-50/60 dark:hover:bg-mint-900/20'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] font-semibold text-muted-foreground">{item.code}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {new Intl.DateTimeFormat('vi-VN', { month: '2-digit', day: '2-digit' }).format(new Date(item.updatedAt))}
                </span>
              </div>

              <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug">
                <span {...(isSelected ? {} : bind(item))} className={isSelected ? 'text-teal-800 dark:text-teal-200' : 'text-foreground group-hover:text-teal-700 dark:group-hover:text-teal-300'}>{item.title}</span>
              </h3>

              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {item.templateName} · <span className="font-medium text-mint-700 dark:text-mint-300">{item.creator.name}</span>
              </p>

              <div className="mt-2 flex items-center justify-between gap-2">
                <RequestStatusBadge status={item.status} />
                <ApproverStack item={item} max={3} />
              </div>
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Không có đề xuất nào trong danh mục này.
          </div>
        )}
        {preview}
      </div>
    </aside>
  );
};
