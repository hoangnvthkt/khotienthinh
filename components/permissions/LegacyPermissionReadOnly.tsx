import React, { useMemo } from 'react';
import { AlertTriangle, Archive, Database } from 'lucide-react';
import { User, UserPermissionGrant } from '../../types';
import { getInheritedPermissionCodes } from '../../lib/permissions/permissionService';

interface LegacyPermissionReadOnlyProps {
  user: Pick<User,
    | 'role'
    | 'allowedModules'
    | 'allowedSubModules'
    | 'adminModules'
    | 'adminSubModules'
    | 'authorizationSnapshot'
  >;
  directGrants: readonly UserPermissionGrant[];
}

const routeCount = (routes?: Record<string, string[]>) =>
  Object.values(routes || {}).reduce((total, values) => total + values.length, 0);

const LegacyPermissionReadOnly: React.FC<LegacyPermissionReadOnlyProps> = ({ user, directGrants }) => {
  const collisionCount = useMemo(() => {
    const inherited = new Set(getInheritedPermissionCodes(user as User));
    return new Set(
      directGrants
        .filter(grant => grant.isActive !== false && inherited.has(grant.permissionCode))
        .map(grant => grant.permissionCode),
    ).size;
  }, [directGrants, user]);

  const sourceCount = (user.allowedModules?.length || 0)
    + (user.adminModules?.length || 0)
    + routeCount(user.allowedSubModules)
    + routeCount(user.adminSubModules);
  const fallbackDisabled = user.authorizationSnapshot?.flags.legacy_fallback_disabled === true;

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Dữ liệu legacy — chỉ đọc">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-600">
        <Archive size={14} /> Dữ liệu legacy — chỉ đọc
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Thông tin này chỉ phục vụ đối soát trong thời gian chuyển đổi và không thể chỉnh sửa tại đây.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase text-slate-400">
            <Database size={11} /> Nguồn
          </div>
          <div className="mt-1 text-xs font-black text-slate-700">{sourceCount} gán legacy</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase text-slate-400">
            <AlertTriangle size={11} /> Xung đột
          </div>
          <div className={`mt-1 text-xs font-black ${collisionCount ? 'text-amber-600' : 'text-emerald-600'}`}>
            {collisionCount} capability trùng direct
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="text-[9px] font-black uppercase text-slate-400">Trạng thái chuyển đổi</div>
          <div className={`mt-1 text-xs font-black ${fallbackDisabled ? 'text-emerald-600' : 'text-amber-600'}`}>
            {fallbackDisabled ? 'Fallback đã tắt' : 'Đang theo dõi fallback'}
          </div>
        </div>
      </div>
    </section>
  );
};

export default LegacyPermissionReadOnly;
