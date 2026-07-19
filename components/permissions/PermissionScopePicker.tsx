import React from 'react';
import { PermissionScope, PermissionScopeType } from '../../lib/permissions/permissionTypes';
import type { PermissionScopeLookupOptionsByType } from '../../lib/permissions/permissionScopeLookupService';
import SearchableSelect from '../common/SearchableSelect';

const SCOPE_OPTIONS: Array<{ value: PermissionScopeType; label: string }> = [
  { value: 'global', label: 'Toàn hệ thống' },
  { value: 'own', label: 'Của mình' },
  { value: 'assigned', label: 'Được giao' },
  { value: 'project', label: 'Dự án' },
  { value: 'construction_site', label: 'Công trình' },
  { value: 'warehouse', label: 'Kho' },
  { value: 'department', label: 'Phòng ban' },
];

const ENTITY_SCOPE_TYPES = new Set(['project', 'construction_site', 'warehouse', 'department']);
const DEFAULT_SCOPE_ID = { scopeId: '*' } as const;

export interface PermissionScopePickerProps {
  value: PermissionScope;
  onChange: (value: PermissionScope) => void;
  disabled?: boolean;
  lookupOptions?: PermissionScopeLookupOptionsByType;
}

const PermissionScopePicker: React.FC<PermissionScopePickerProps> = ({
  value,
  onChange,
  disabled = false,
  lookupOptions,
}) => {
  const scopeType = value.scopeType || 'global';
  const isEntityScope = ENTITY_SCOPE_TYPES.has(scopeType);
  const options = isEntityScope
    ? lookupOptions?.[scopeType as keyof PermissionScopeLookupOptionsByType] || []
    : [];
  const selectedId = value.scopeId || '*';
  const selectedOption = options.find(option => option.id === selectedId);
  const showLookup = isEntityScope && options.length > 0 && (selectedId === '*' || Boolean(selectedOption));
  const rawIdDisabled = disabled || !isEntityScope;

  const changeScopeType = (nextScopeType: PermissionScopeType) => {
    onChange({
      scopeType: nextScopeType,
      scopeId: nextScopeType === 'global' || nextScopeType === 'own' || nextScopeType === 'assigned'
        ? DEFAULT_SCOPE_ID.scopeId
        : value.scopeId || '*',
    });
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
      <select
        value={scopeType}
        disabled={disabled}
        onChange={event => changeScopeType(event.target.value as PermissionScopeType)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-200"
      >
        {SCOPE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {showLookup ? (
        <SearchableSelect
          value={selectedId === '*' ? '' : selectedId}
          options={options}
          onChange={option => onChange({ scopeType, scopeId: option?.id || DEFAULT_SCOPE_ID.scopeId })}
          getOptionValue={option => option.id}
          getOptionLabel={option => option.label}
          getOptionSearchText={option => option.searchText}
          renderOption={option => (
            <span className="block">
              <span className="block font-black">{option.label}</span>
              {option.subtitle && <span className="block text-[10px] text-slate-400">{option.subtitle}</span>}
            </span>
          )}
          placeholder="Gõ để tìm scope..."
          emptyLabel="Không tìm thấy scope phù hợp"
          disabled={disabled}
          clearable={false}
          inputClassName="py-2 text-xs"
        />
      ) : (
        <input
          aria-label="raw id"
          type="text"
          value={value.scopeId || '*'}
          onChange={event => onChange({ scopeType, scopeId: event.target.value || '*' })}
          disabled={rawIdDisabled}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 disabled:text-slate-400"
          placeholder={isEntityScope ? 'Nhập raw id khi chưa tải được danh sách' : '*'}
        />
      )}
    </div>
  );
};

export default PermissionScopePicker;
