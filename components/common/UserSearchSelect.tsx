import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, UserRound, X } from 'lucide-react';
import type { User } from '../../types';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

export interface UserSearchSelectSingleProps {
  multiple?: false;
  value?: string | null;
  onChange: (userId: string | null) => void;
  values?: never;
  onValuesChange?: never;
}

export interface UserSearchSelectMultiProps {
  multiple: true;
  values: string[];
  onValuesChange: (userIds: string[]) => void;
  value?: never;
  onChange?: never;
}

export type UserSearchSelectProps = (UserSearchSelectSingleProps | UserSearchSelectMultiProps) & {
  users: User[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  inputClassName?: string;
  menuClassName?: string;
  excludeUserIds?: string[];
};

export const UserSearchSelect: React.FC<UserSearchSelectProps> = (props) => {
  const {
    users,
    placeholder = 'Gõ tên hoặc vị trí để tìm...',
    disabled = false,
    clearable = true,
    className = '',
    inputClassName = '',
    menuClassName = '',
    excludeUserIds = [],
  } = props;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
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
    const maxHeight = Math.min(240, available);
    setMenuPosition({
      left: Math.max(8, rect.left),
      top: openBelow ? rect.bottom + gap : Math.max(8, rect.top - maxHeight - gap),
      width: rect.width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
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

  const selectedUser = useMemo(() => {
    if (props.multiple) return null;
    return users.find(u => u.id === props.value) || null;
  }, [props.multiple, props.value, users]);

  const selectedUsersMulti = useMemo(() => {
    if (!props.multiple) return [];
    return (props.values || [])
      .map(id => users.find(u => u.id === id))
      .filter((u): u is User => Boolean(u));
  }, [props.multiple, props.values, users]);

  const filteredUsers = useMemo(() => {
    const excludedSet = new Set(excludeUserIds);
    if (props.multiple && props.values) {
      props.values.forEach(id => excludedSet.add(id));
    } else if (!props.multiple && props.value) {
      // In single mode, don't filter out selected user from dropdown so user can see it
    }

    let candidates = users.filter(u => !excludedSet.has(u.id) && u.isActive !== false);

    if (query.trim()) {
      candidates = candidates.filter(u => {
        const searchTargets = [
          u.name,
          u.position,
          u.email,
          u.username,
          u.phone,
        ];
        return matchesSearchQueryMultiple(searchTargets, query);
      });
    }

    return candidates.slice(0, 50);
  }, [users, excludeUserIds, props.multiple, props.values, props.value, query]);

  const handleSelectUser = (user: User) => {
    if (props.multiple) {
      props.onValuesChange([...(props.values || []), user.id]);
      setQuery('');
      inputRef.current?.focus();
    } else {
      props.onChange(user.id);
      setOpen(false);
      setQuery('');
    }
  };

  const handleRemoveUserMulti = (userId: string) => {
    if (props.multiple) {
      props.onValuesChange((props.values || []).filter(id => id !== userId));
    }
  };

  const handleClearSingle = () => {
    if (!props.multiple) {
      props.onChange(null);
      setQuery('');
      setOpen(false);
    }
  };

  const menu = open && !disabled && menuPosition ? (
    <div
      ref={menuRef}
      style={{
        top: menuPosition.top,
        left: menuPosition.left,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
      }}
      className={`fixed z-[1300] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${menuClassName}`}
    >
      {filteredUsers.length === 0 ? (
        <div className="px-3 py-2.5 text-center text-xs font-medium text-slate-400">
          Không tìm thấy nhân viên phù hợp
        </div>
      ) : (
        filteredUsers.map(u => {
          const isSelected = props.multiple
            ? (props.values || []).includes(u.id)
            : props.value === u.id;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => handleSelectUser(u)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/40 ${
                isSelected
                  ? 'bg-violet-50 text-violet-700 font-semibold dark:bg-violet-950/50 dark:text-violet-300'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {u.avatar ? (
                <img src={u.avatar} alt={u.name} className="h-6 w-6 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-800 dark:text-white">
                  {u.name}
                </div>
                {u.position && (
                  <div className="truncate text-[11px] text-slate-400 dark:text-slate-400">
                    {u.position}
                  </div>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  ) : null;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {props.multiple && selectedUsersMulti.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedUsersMulti.map(u => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300 border border-violet-200 dark:border-violet-800"
            >
              {u.avatar ? (
                <img src={u.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
              ) : (
                <UserRound size={12} className="text-violet-500" />
              )}
              <span>{u.name}</span>
              {u.position && <span className="text-[10px] opacity-75">· {u.position}</span>}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveUserMulti(u.id)}
                  aria-label={`Bỏ ${u.name}`}
                  className="rounded p-0.5 text-violet-500 hover:bg-violet-200 hover:text-violet-900 dark:hover:bg-violet-900"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="relative flex items-center">
        <Search size={15} className="pointer-events-none absolute left-3 text-slate-400" />
        <input
          ref={inputRef}
          value={open ? query : (props.multiple ? '' : (selectedUser ? `${selectedUser.name}${selectedUser.position ? ` · ${selectedUser.position}` : ''}` : ''))}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            updateMenuPosition();
          }}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={props.multiple && selectedUsersMulti.length > 0 ? 'Gõ để tìm thêm...' : placeholder}
          className={`w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 py-2 text-xs text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-violet-500 ${inputClassName}`}
        />
        {clearable && !disabled && !props.multiple && selectedUser && (
          <button
            type="button"
            onClick={handleClearSingle}
            className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            title="Xóa lựa chọn"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : menu}
    </div>
  );
};

export default UserSearchSelect;
