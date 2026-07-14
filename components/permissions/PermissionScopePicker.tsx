import React from 'react';
import { PermissionScope, PermissionScopeType } from '../../lib/permissions/permissionTypes';

const SCOPE_OPTIONS: Array<{ value: PermissionScopeType; label: string }> = [
  { value: 'global', label: 'Toàn hệ thống' },
  { value: 'own', label: 'Của mình' },
  { value: 'assigned', label: 'Được giao' },
  { value: 'project', label: 'Dự án' },
  { value: 'construction_site', label: 'Công trình' },
  { value: 'warehouse', label: 'Kho' },
  { value: 'department', label: 'Phòng ban' },
];

interface PermissionScopePickerProps {
  value: PermissionScope;
  onChange: (value: PermissionScope) => void;
}

const PermissionScopePicker: React.FC<PermissionScopePickerProps> = ({ value, onChange }) => (
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
    <select
      value={value.scopeType || 'global'}
      onChange={event => onChange({
        scopeType: event.target.value as PermissionScopeType,
        scopeId: event.target.value === 'global' ? '*' : value.scopeId || '*',
      })}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-200"
    >
      {SCOPE_OPTIONS.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    <input
      type="text"
      value={value.scopeId || '*'}
      onChange={event => onChange({ scopeType: value.scopeType || 'global', scopeId: event.target.value || '*' })}
      disabled={(value.scopeType || 'global') === 'global'}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 disabled:text-slate-400"
      placeholder="scope id"
    />
  </div>
);

export default PermissionScopePicker;
