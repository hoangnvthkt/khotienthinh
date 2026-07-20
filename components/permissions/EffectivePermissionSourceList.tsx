import React, { useMemo } from 'react';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { buildPermissionSourceBadges } from '../../lib/permissions/authorizationGovernanceViewModel';
import { getPermissionActionByCode } from '../../lib/permissions/permissionRegistry';

interface EffectivePermissionSourceListProps {
  sources: readonly EffectivePermissionSource[];
  emptyLabel?: string;
}

const formatTime = (value?: string | null) => {
  if (!value) return 'Không giới hạn';
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleString('vi-VN') : 'Không hợp lệ';
};

const EffectivePermissionSourceList: React.FC<EffectivePermissionSourceListProps> = ({
  sources,
  emptyLabel = 'Không có quyền hiệu lực',
}) => {
  const groups = useMemo(() => {
    const byPermission = new Map<string, EffectivePermissionSource[]>();
    sources.forEach(source => {
      byPermission.set(source.permissionCode, [...(byPermission.get(source.permissionCode) || []), source]);
    });
    return [...byPermission.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [sources]);

  if (groups.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400">{emptyLabel}</div>;
  }

  return (
    <div className="space-y-2">
      {groups.map(([permissionCode, permissionSources]) => {
        const action = getPermissionActionByCode(permissionCode);
        return (
          <section key={permissionCode} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs font-black text-slate-700">{action?.label || permissionCode}</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">{permissionCode}</div>
            <div className="mt-2 space-y-2">
              {permissionSources.map(source => {
                const badge = buildPermissionSourceBadges([source])[0];
                const expiry = source.expiresAt ? new Date(source.expiresAt).getTime() : null;
                const expired = expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now());
                return (
                  <div key={badge.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] font-bold text-slate-500">
                    <span className="rounded bg-violet-100 px-2 py-1 text-violet-700">{badge.label}</span>
                    <span>{source.scopeType}/{source.scopeId}</span>
                    <span>Bắt đầu: {formatTime(source.startsAt)}</span>
                    <span>Hết hạn: {formatTime(source.expiresAt)}</span>
                    {expired && <span className="rounded bg-rose-100 px-2 py-1 text-rose-700">Đã hết hạn</span>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default EffectivePermissionSourceList;
