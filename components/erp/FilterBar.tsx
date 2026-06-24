import React from 'react';
import { Search, X } from 'lucide-react';

type FilterBarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  summary?: React.ReactNode;
  onClear?: () => void;
  canClear?: boolean;
  className?: string;
};

const FilterBar: React.FC<FilterBarProps> = ({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Tìm kiếm...',
  filters,
  summary,
  onClear,
  canClear,
  className = '',
}) => (
  <div className={`flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {onSearchChange && (
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchValue}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
        </div>
      )}
      {filters && <div className="flex flex-wrap gap-2">{filters}</div>}
      {onClear && canClear && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 transition hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <X size={14} /> Xoá lọc
        </button>
      )}
    </div>
    {summary && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">{summary}</div>}
  </div>
);

export default FilterBar;
