import React from 'react';
import { Search, X } from 'lucide-react';

type FilterBarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  onClear?: () => void;
  canClear?: boolean;
};

const FilterBar: React.FC<FilterBarProps> = ({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Tìm kiếm...',
  filters,
  onClear,
  canClear,
}) => (
  <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:flex-row lg:items-center">
    {onSearchChange && (
      <div className="relative min-w-0 flex-1">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={searchValue}
          onChange={event => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        />
      </div>
    )}
    {filters && <div className="flex flex-wrap gap-2">{filters}</div>}
    {onClear && canClear && (
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <X size={14} /> Xoá lọc
      </button>
    )}
  </div>
);

export default FilterBar;
