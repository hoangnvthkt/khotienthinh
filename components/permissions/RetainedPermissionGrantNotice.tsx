import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { UserPermissionGrant } from '../../types';
import { getPermissionActionByCode, getPermissionModuleByCode } from '../../lib/permissions/permissionRegistry';

interface RetainedPermissionGrantNoticeProps {
  grants: readonly UserPermissionGrant[];
}

// Where a retained permission can actually be changed, when another screen owns it.
const MANAGED_ELSEWHERE: Record<string, string> = {
  'system.finance': 'Đổi ở Tài chính → Cài đặt',
};

const viDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
};

type RetainedModuleGroup = {
  moduleCode: string;
  label: string;
  sortOrder: number;
  grants: UserPermissionGrant[];
};

export const groupRetainedGrantsByModule = (grants: readonly UserPermissionGrant[]): RetainedModuleGroup[] => {
  const groups = new Map<string, RetainedModuleGroup>();
  grants.forEach(grant => {
    const moduleCode = grant.permissionCode.split('.').slice(0, -1).join('.') || grant.permissionCode;
    const module = getPermissionModuleByCode(moduleCode);
    const group = groups.get(moduleCode) || {
      moduleCode,
      label: module?.label || moduleCode,
      sortOrder: module?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      grants: [],
    };
    group.grants.push(grant);
    groups.set(moduleCode, group);
  });
  const actionOrder = (grant: UserPermissionGrant) =>
    getPermissionActionByCode(grant.permissionCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return [...groups.values()]
    .map(group => ({ ...group, grants: [...group.grants].sort((a, b) => actionOrder(a) - actionOrder(b)) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'vi'));
};

const RetainedPermissionGrantNotice: React.FC<RetainedPermissionGrantNoticeProps> = ({ grants }) => {
  if (grants.length === 0) return null;
  const groups = groupRetainedGrantsByModule(grants);

  return (
    <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start gap-2">
        <LockKeyhole size={15} className="mt-0.5 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-black text-slate-700">Quyền hệ thống đang giữ lại</h3>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">
              Chỉ đọc · {grants.length} quyền · {groups.length} module
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Người này đang có các quyền dưới đây nhưng không chỉnh được ở màn này. Khi lưu, chúng được giữ nguyên;
            {' '}bỏ tích Module bên dưới cũng không gỡ chúng.
          </p>
          <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {groups.map(group => (
              <li key={group.moduleCode} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
                <span className="min-w-[7rem] text-[11px] font-bold text-slate-700">{group.label}</span>
                <span className="flex flex-wrap gap-1">
                  {group.grants.map(grant => {
                    const expiry = viDate(grant.expiresAt);
                    return (
                      <span
                        key={`${grant.permissionCode}-${grant.scopeType}-${grant.scopeId}-${grant.expiresAt || ''}`}
                        title={grant.permissionCode}
                        className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600"
                      >
                        {getPermissionActionByCode(grant.permissionCode)?.label || grant.permissionCode}
                        {expiry && <span className="font-medium text-slate-400"> · đến {expiry}</span>}
                      </span>
                    );
                  })}
                </span>
                {MANAGED_ELSEWHERE[group.moduleCode] && (
                  <span className="ml-auto text-[10px] text-slate-400">{MANAGED_ELSEWHERE[group.moduleCode]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
};

export default RetainedPermissionGrantNotice;
