import React, { useMemo } from 'react';
import { Building2, KeyRound, UserRound, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { ERP_PERMISSION_APPLICATIONS } from '../../../lib/permissions/erpPermissionRegistry';
import type { RequestScopeKind, RequestTemplateDraft, RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';
import SearchableSelect from '../../common/SearchableSelect';
import UserSearchSelect from '../../common/UserSearchSelect';

type Scope = RequestTemplateDraft['scopes'][number];
type Option = { value: string; label: string };
interface Props { scopes: Scope[]; dispatch: (action: RequestTemplateDraftAction) => void; }

const scopeKey = (scope: Scope) => `${scope.kind}:${scope.targetId ?? ''}`;
const dedupe = (scopes: Scope[]) => Array.from(new Map(scopes.map(scope => [scopeKey(scope), scope])).values());

// Chips of the current selection plus a searchable picker for adding more.
const SearchableMultiPicker: React.FC<{
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}> = ({ options, values, onChange, placeholder, disabled }) => {
  const labelOf = (value: string) => options.find(option => option.value === value)?.label ?? 'Không còn tồn tại';
  const remaining = useMemo(() => options.filter(option => !values.includes(option.value)), [options, values]);
  return <div className="space-y-2">
    {values.length > 0 && <ul className="flex flex-wrap gap-1.5">{values.map(value => <li key={value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      <span className="truncate">{labelOf(value)}</span>
      <button type="button" disabled={disabled} onClick={() => onChange(values.filter(item => item !== value))} aria-label={`Bỏ ${labelOf(value)}`} className="rounded-full p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900"><X size={12} /></button>
    </li>)}</ul>}
    <SearchableSelect<Option>
      value={null}
      options={remaining}
      onChange={option => option && onChange([...values, option.value])}
      getOptionValue={option => option.value}
      getOptionLabel={option => option.label}
      placeholder={placeholder}
      disabled={disabled}
      clearable={false}
    />
  </div>;
};

const RequestTemplateScopeEditor: React.FC<Props> = ({ scopes, dispatch }) => {
  const { users, orgUnits } = useApp();
  const permissionOptions = useMemo(() => ERP_PERMISSION_APPLICATIONS.flatMap(application => application.modules.flatMap(module => module.actions.map(action => ({ value: action.permissionCode, label: `${module.label} · ${action.label}` })))), []);
  const orgUnitOptions = useMemo(() => orgUnits.map(unit => ({ value: unit.id, label: unit.name })), [orgUnits]);
  const hasCompany = scopes.some(scope => scope.kind === 'COMPANY');
  const values = (kind: RequestScopeKind) => scopes.filter(scope => scope.kind === kind).map(scope => scope.targetId!).filter(Boolean);
  const setScopes = (next: Scope[]) => dispatch({ type: 'SET_SCOPES', scopes: next });
  const setValues = (kind: Exclude<RequestScopeKind, 'COMPANY'>, targetIds: string[]) => setScopes(dedupe([...scopes.filter(scope => scope.kind !== kind && scope.kind !== 'COMPANY'), ...targetIds.map(targetId => ({ kind, targetId }))]));
  const onCompany = () => {
    if (hasCompany) return setScopes([]);
    if (scopes.length && !window.confirm('Phạm vi “Toàn công ty” sẽ thay thế các phạm vi chi tiết. Tiếp tục?')) return;
    setScopes([{ kind: 'COMPANY', targetId: null }]);
  };
  const card = (icon: React.ReactNode, label: string, hint: string, control: React.ReactNode) => <div className={`rounded-xl border p-4 ${hasCompany ? 'border-slate-100 opacity-50 dark:border-slate-800' : 'border-slate-200 dark:border-slate-700'}`}>
    <p className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">{icon}{label}</p>
    <p className="mb-2 mt-0.5 text-xs text-slate-400">{hint}</p>
    {control}
  </div>;

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
      <h2 className="text-lg font-bold text-slate-800 dark:text-white">Phạm vi sử dụng</h2>
      <p className="mt-1 text-sm text-slate-500">Chỉ những người thuộc phạm vi này mới thấy mẫu để tạo đề xuất. Chọn nhiều nhóm thì người thuộc bất kỳ nhóm nào cũng dùng được.</p>
    </header>
    <div className="space-y-4 p-5">
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <input type="checkbox" checked={hasCompany} onChange={onCompany} className="h-4 w-4 accent-emerald-600" />
        <span><span className="block text-sm font-bold text-slate-700 dark:text-slate-200">Toàn công ty</span><span className="text-xs text-slate-400">Dùng cho mọi nhân viên đang hoạt động.</span></span>
      </label>
      <div className="grid gap-4 lg:grid-cols-3">
        {card(<Building2 size={16} />, 'Phòng ban / đơn vị', 'Gõ tên để tìm phòng ban.',
          <SearchableMultiPicker options={orgUnitOptions} values={values('ORG_UNIT')} onChange={ids => setValues('ORG_UNIT', ids)} placeholder="Tìm phòng ban..." disabled={hasCompany} />)}
        {card(<KeyRound size={16} />, 'Nhóm quyền', 'Người có quyền này sẽ dùng được mẫu.',
          <SearchableMultiPicker options={permissionOptions} values={values('PERMISSION_GROUP')} onChange={codes => setValues('PERMISSION_GROUP', codes)} placeholder="Tìm quyền, vd: Nghỉ phép..." disabled={hasCompany} />)}
        {card(<UserRound size={16} />, 'Người dùng cụ thể', 'Gõ tên hoặc vị trí.',
          <UserSearchSelect users={users} multiple values={values('USER')} onValuesChange={ids => setValues('USER', ids)} placeholder="Tìm người dùng..." disabled={hasCompany} />)}
      </div>
    </div>
  </section>;
};

export default RequestTemplateScopeEditor;
