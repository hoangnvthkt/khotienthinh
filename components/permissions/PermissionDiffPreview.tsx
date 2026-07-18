import React, { useMemo } from 'react';
import { UserPermissionGrant } from '../../types';
import { getPermissionActionByCode } from '../../lib/permissions/permissionRegistry';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';

const activeCodeSet = (grants: readonly UserPermissionGrant[]) =>
  new Set(grants.filter(grant => grant.isActive !== false).map(grant => `${grant.permissionCode}::${grant.scopeType || 'global'}::${grant.scopeId || '*'}`));

const formatGrantKey = (key: string) => {
  const [permissionCode, scopeType, scopeId] = key.split('::');
  const action = getPermissionActionByCode(permissionCode);
  return `${action?.label || permissionCode} - ${permissionCode} (${scopeType}/${scopeId})`;
};

interface PermissionDiffPreviewProps {
  before: readonly UserPermissionGrant[];
  after: readonly UserPermissionGrant[];
  effectiveSources?: readonly EffectivePermissionSource[];
}

const PermissionDiffPreview: React.FC<PermissionDiffPreviewProps> = ({ before, after, effectiveSources = [] }) => {
  const diff = useMemo(() => {
    const beforeSet = activeCodeSet(before);
    const afterSet = activeCodeSet(after);
    return {
      added: [...afterSet].filter(key => !beforeSet.has(key)),
      removed: [...beforeSet].filter(key => !afterSet.has(key)),
    };
  }, [before, after]);
  const inheritedEffectiveCount = useMemo(() => new Set(
    effectiveSources
      .filter(source => source.sourceType === 'ROLE' || source.sourceType === 'LEGACY')
      .map(source => `${source.permissionCode}::${source.scopeType}::${source.scopeId}`)
  ).size, [effectiveSources]);

  if (diff.added.length === 0 && diff.removed.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
        <div>Grant trực tiếp chưa thay đổi.</div>
        <div className="mt-1 text-[10px] text-violet-600">{inheritedEffectiveCount} quyền vẫn hiệu lực từ Business Role/Legacy</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-wide text-blue-700">Preview thay đổi grant mới</span>
        <span className="text-[10px] font-black text-slate-500">+{diff.added.length} / -{diff.removed.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-black uppercase text-emerald-600">Thêm</div>
          <ul className="space-y-1">
            {(diff.added.length > 0 ? diff.added.slice(0, 6) : ['Không có']).map(key => (
              <li key={key} className="truncate text-[10px] font-semibold text-slate-600">{key === 'Không có' ? key : formatGrantKey(key)}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-black uppercase text-rose-600">Gỡ</div>
          <ul className="space-y-1">
            {(diff.removed.length > 0 ? diff.removed.slice(0, 6) : ['Không có']).map(key => (
              <li key={key} className="truncate text-[10px] font-semibold text-slate-600">{key === 'Không có' ? key : formatGrantKey(key)}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-2 border-t border-blue-100 pt-2 text-[10px] font-bold text-violet-600">
        {inheritedEffectiveCount} quyền vẫn hiệu lực từ Business Role/Legacy
      </div>
    </div>
  );
};

export default PermissionDiffPreview;
