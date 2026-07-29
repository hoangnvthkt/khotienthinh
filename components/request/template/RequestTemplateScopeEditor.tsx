import React, { useMemo } from 'react';
import { Building2, KeyRound, UserRound } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { ERP_PERMISSION_APPLICATIONS } from '../../../lib/permissions/erpPermissionRegistry';
import type { RequestScopeKind, RequestTemplateDraft, RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';

type Scope = RequestTemplateDraft['scopes'][number];
interface Props { scopes: Scope[]; dispatch: (action: RequestTemplateDraftAction) => void; }

const scopeKey = (scope: Scope) => `${scope.kind}:${scope.targetId ?? ''}`;
const dedupe = (scopes: Scope[]) => Array.from(new Map(scopes.map(scope => [scopeKey(scope), scope])).values());

const RequestTemplateScopeEditor: React.FC<Props> = ({ scopes, dispatch }) => {
  const { users, orgUnits } = useApp();
  const permissionOptions = useMemo(() => ERP_PERMISSION_APPLICATIONS.flatMap(application => application.modules.flatMap(module => module.actions.map(action => ({ value: action.permissionCode, label: `${module.label} · ${action.label}` })))), []);
  const hasCompany = scopes.some(scope => scope.kind === 'COMPANY');
  const values = (kind: RequestScopeKind) => scopes.filter(scope => scope.kind === kind).map(scope => scope.targetId!).filter(Boolean);
  const setScopes = (next: Scope[]) => dispatch({ type: 'SET_SCOPES', scopes: next });
  const setValues = (kind: Exclude<RequestScopeKind, 'COMPANY'>, targetIds: string[]) => setScopes(dedupe([...scopes.filter(scope => scope.kind !== kind && scope.kind !== 'COMPANY'), ...targetIds.map(targetId => ({ kind, targetId }))]));
  const onCompany = () => {
    if (hasCompany) return setScopes([]);
    if (scopes.length && !window.confirm('Phạm vi “Toàn công ty” sẽ thay thế các phạm vi chi tiết. Tiếp tục?')) return;
    setScopes([{ kind: 'COMPANY', targetId: null }]);
  };
  const multi = (kind: Exclude<RequestScopeKind, 'COMPANY'>, options: Array<{ value: string; label: string }>, icon: React.ReactNode, label: string) => <label className={`block rounded-xl border p-4 ${hasCompany ? 'cursor-not-allowed border-slate-100 opacity-50 dark:border-slate-800' : 'border-slate-200 dark:border-slate-700'}`}><span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">{icon}{label}</span><select multiple disabled={hasCompany} value={values(kind)} onChange={event => setValues(kind, Array.from(event.currentTarget.selectedOptions, option => option.value))} className="h-28 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="mt-1 block text-xs text-slate-400">Giữ Ctrl/Cmd để chọn nhiều mục.</span></label>;
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700"><h2 className="text-lg font-bold text-slate-800 dark:text-white">Phạm vi sử dụng</h2><p className="mt-1 text-sm text-slate-500">Chỉ những người thuộc phạm vi này mới thấy mẫu để tạo đề xuất.</p></header><div className="space-y-4 p-5"><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><input type="checkbox" checked={hasCompany} onChange={onCompany} className="h-4 w-4 accent-emerald-600" /><span><span className="block text-sm font-bold text-slate-700 dark:text-slate-200">Toàn công ty</span><span className="text-xs text-slate-400">Dùng cho mọi nhân viên đang hoạt động.</span></span></label><div className="grid gap-4 lg:grid-cols-3">{multi('ORG_UNIT', orgUnits.map(unit => ({ value: unit.id, label: unit.name })), <Building2 size={16} />, 'Phòng ban / đơn vị')}{multi('PERMISSION_GROUP', permissionOptions, <KeyRound size={16} />, 'Nhóm quyền')}{multi('USER', users.map(user => ({ value: user.id, label: user.name })), <UserRound size={16} />, 'Người dùng cụ thể')}</div></div></section>;
};

export default RequestTemplateScopeEditor;
