import React, { useState, useMemo } from 'react';
import { Search, Check, X } from 'lucide-react';

export interface EntityOption {
  id: string;
  name: string;
  subtitle?: string | null;
  icon?: React.ReactNode;
}

interface PremiumEntitySelectProps {
  options: EntityOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  isMulti?: boolean;
  placeholder?: string;
  onClose?: () => void;
  onConfirm?: () => void;
  className?: string;
}

const PremiumEntitySelect: React.FC<PremiumEntitySelectProps> = ({
  options,
  selectedIds,
  onChange,
  isMulti = true,
  placeholder = 'Nhập từ khóa tìm kiếm',
  onClose,
  onConfirm,
  className = '',
}) => {
  const [query, setQuery] = useState('');
  const [tempSelected, setTempSelected] = useState<string[]>(selectedIds);

  // Đồng bộ khi selectedIds thay đổi từ ngoài
  React.useEffect(() => {
    setTempSelected(selectedIds);
  }, [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options;
    return options.filter(
      o =>
        o.name.toLowerCase().includes(q) ||
        (o.subtitle || '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const handleToggle = (id: string) => {
    if (isMulti) {
      setTempSelected(prev => {
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
        return next;
      });
    } else {
      onChange([id]);
      onConfirm?.();
    }
  };

  const handleConfirm = () => {
    onChange(tempSelected);
    onConfirm?.();
  };

  return (
    <div className={`bg-card text-card-foreground border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col font-sans ${className}`}>
      {/* Search Header */}
      <div className="p-3 border-b border-border flex items-center gap-2 bg-muted/40 shrink-0">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-border text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all bg-card"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Option List Group with macOS Dock-like magnifying effect */}
      <div className="flex-1 overflow-y-auto max-h-[280px] p-2 space-y-0.5 scrollbar-thin group/list">
        {filtered.map(o => {
          const isChecked = isMulti ? tempSelected.includes(o.id) : selectedIds.includes(o.id);

          return (
            <div
              key={o.id}
              onClick={() => handleToggle(o.id)}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all duration-200 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.05] hover:z-10 hover:shadow-md hover:bg-muted/40 hover:border-border group-hover/list:opacity-60 hover:!opacity-100 active:scale-[0.98] select-none ${
                isChecked
                  ? 'bg-blue-50/30 border-blue-200/40 dark:bg-blue-950/20 dark:border-blue-900/50 !opacity-100 shadow-sm'
                  : 'border-transparent'
              }`}
            >
              {/* Custom Checkbox / Radio Circle */}
              <div
                className={`w-5 h-5 border flex items-center justify-center transition-all shrink-0 ${
                  isMulti ? 'rounded-lg' : 'rounded-full'
                } ${
                  isChecked
                    ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                    : 'border-border bg-card'
                }`}
              >
                {isChecked && <Check size={11} strokeWidth={3} />}
              </div>

              {/* Icon Container */}
              {o.icon && (
                <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0 animate-pulse">
                  {o.icon}
                </div>
              )}

              {/* Text metadata */}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black text-foreground truncate leading-snug">{o.name}</div>
                {o.subtitle && (
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5 truncate">{o.subtitle}</div>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-10 text-xs font-bold text-muted-foreground italic">
            Không tìm thấy kết quả phù hợp
          </div>
        )}
      </div>

      {/* Footer with actions for Multi-select mode */}
      {isMulti && (
        <div className="px-4 py-3 border-t border-border bg-muted/40 flex justify-end gap-2 shrink-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground bg-card border border-border hover:bg-muted active:scale-95 transition-all shadow-sm"
            >
              Hủy
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 rounded-xl text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all shadow-md shadow-blue-500/15"
          >
            Thêm
          </button>
        </div>
      )}
    </div>
  );
};

export default PremiumEntitySelect;
