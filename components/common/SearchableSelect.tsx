import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

interface SearchableSelectProps<T> {
  value?: string | null;
  options: T[];
  onChange: (option: T | null) => void;
  getOptionValue: (option: T) => string;
  getOptionLabel: (option: T) => string;
  getOptionSearchText?: (option: T) => string;
  renderOption?: (option: T) => React.ReactNode;
  renderValue?: (option: T) => string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  inputClassName?: string;
  menuClassName?: string;
}

export default function SearchableSelect<T>({
  value,
  options,
  onChange,
  getOptionValue,
  getOptionLabel,
  getOptionSearchText,
  renderOption,
  renderValue,
  placeholder = 'Tìm kiếm...',
  emptyLabel = 'Không có kết quả',
  disabled = false,
  clearable = true,
  className = '',
  inputClassName = '',
  menuClassName = '',
}: SearchableSelectProps<T>) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const updateMenuPosition = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof window === 'undefined') return;
    const rect = wrapper.getBoundingClientRect();
    const gap = 4;
    const viewportHeight = window.innerHeight || 720;
    const spaceBelow = viewportHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const available = Math.max(120, openBelow ? spaceBelow : spaceAbove);
    const maxHeight = Math.min(256, available);
    setMenuPosition({
      left: Math.max(8, rect.left),
      top: openBelow ? rect.bottom + gap : Math.max(8, rect.top - maxHeight - gap),
      width: rect.width,
      maxHeight,
    });
  }, []);

  const selected = useMemo(
    () => options.find(option => getOptionValue(option) === value) || null,
    [getOptionValue, options, value]
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options.slice(0, 40);
    return options
      .filter(option => {
        const haystack = getOptionSearchText?.(option) || getOptionLabel(option);
        return matchesSearchQueryMultiple([haystack], query);
      })
      .slice(0, 40);
  }, [getOptionLabel, getOptionSearchText, options, query]);

  const displayText = selected ? (renderValue?.(selected) || getOptionLabel(selected)) : '';

  const menu = open && !disabled && menuPosition ? (
    <div
      ref={menuRef}
      style={{
        top: menuPosition.top,
        left: menuPosition.left,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
      }}
      className={`fixed z-[1300] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${menuClassName}`}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-xs font-semibold text-slate-400">{emptyLabel}</div>
      ) : (
        filtered.map(option => {
          const optionValue = getOptionValue(option);
          const active = optionValue === value;
          return (
            <button
              key={optionValue}
              type="button"
              onClick={() => {
                onChange(option);
                setOpen(false);
                setQuery('');
              }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-blue-50 hover:text-blue-700 ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 dark:text-slate-100'}`}
            >
              {renderOption?.(option) || getOptionLabel(option)}
            </button>
          );
        })
      )}
    </div>
  ) : null;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={open ? query : displayText}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-slate-200 bg-white px-8 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${inputClassName}`}
        />
        {clearable && !disabled && selected && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : menu}
    </div>
  );
}
