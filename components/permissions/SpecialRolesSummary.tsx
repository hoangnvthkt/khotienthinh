import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { getUserSpecialRoles, type UserSpecialRole } from '../../lib/permissions/businessRoleAdminService';

interface SpecialRolesSummaryProps {
  userId: string;
}

const ROLE_LABELS: Record<string, { label: string; where: string }> = {
  HR: { label: 'Nhân sự (HR)', where: 'Đổi ở ngăn kéo người dùng → tab Vai trò nhân sự' },
  HR_MANAGE: { label: 'Quản lý nhân sự (HR Manage)', where: 'Đổi ở ngăn kéo người dùng → tab Vai trò nhân sự' },
  SYSTEM_ADMIN: { label: 'Quản trị hệ thống', where: 'Đổi ở Cài đặt → Vai trò đặc biệt' },
  PERMISSION_ADMIN: { label: 'Quản trị phân quyền', where: 'Đổi ở Cài đặt → Vai trò đặc biệt' },
  AUDITOR: { label: 'Kiểm toán', where: 'Đổi ở Cài đặt → Vai trò đặc biệt' },
};

const formatDate = (value?: string) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? '' : new Date(time).toLocaleDateString('vi-VN');
};

// Roles that carry more than everyday permissions (HR data, administration, audit). They are
// given in Settings, not here, so this card only shows what the person holds.
const SpecialRolesSummary: React.FC<SpecialRolesSummaryProps> = ({ userId }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [roles, setRoles] = useState<UserSpecialRole[]>([]);
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload(count => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getUserSpecialRoles(userId)
      .then(result => { if (!cancelled) { setRoles(result); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [userId, reload]);

  return (
    <section className="rounded-xl border border-indigo-100 bg-white p-3">
      <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Vai trò đặc biệt</div>
      <p className="mt-1 text-[11px] text-slate-500">
        Dành cho dữ liệu nhạy cảm (nhân sự, lương) hoặc quyền quản trị. Ở đây chỉ để xem người này đang giữ vai trò nào.
      </p>

      {state === 'loading' && (
        <p className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-400"><Loader2 size={14} className="animate-spin" /> Đang tải…</p>
      )}
      {state === 'error' && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          Không tải được vai trò đặc biệt của người này.
          <button type="button" onClick={retry} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-black">
            <RefreshCw size={12} /> Thử lại
          </button>
        </div>
      )}
      {state === 'ready' && roles.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
          Không giữ vai trò đặc biệt nào.
        </p>
      )}
      {state === 'ready' && roles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {roles.map(role => {
            const info = ROLE_LABELS[role.roleCode];
            const expires = formatDate(role.expiresAt);
            return (
              <li key={role.assignmentId} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs font-black text-slate-800">{info?.label || role.roleName}</span>
                  <span className="text-[11px] text-slate-500">{expires ? `Hết hạn ${expires}` : 'Không giới hạn thời gian'}</span>
                </div>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{info?.where || 'Đổi ở Cài đặt → Vai trò đặc biệt'}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default SpecialRolesSummary;
