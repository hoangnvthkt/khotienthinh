import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { UserPermissionGrant } from '../../types';

interface RetainedPermissionGrantNoticeProps {
  grants: readonly UserPermissionGrant[];
}

const RetainedPermissionGrantNotice: React.FC<RetainedPermissionGrantNoticeProps> = ({ grants }) => {
  if (grants.length === 0) return null;

  return (
    <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start gap-2">
        <LockKeyhole size={15} className="mt-0.5 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-black text-slate-700">Quyền hệ thống đang giữ lại</h3>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">
              Chỉ đọc · {grants.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Các quyền chuyển đổi trước đây được giữ nguyên khi lưu, nhưng không thể cấp mới hoặc chỉnh sửa tại đây.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {grants.map(grant => (
              <code
                key={`${grant.permissionCode}-${grant.scopeType}-${grant.scopeId}-${grant.expiresAt || ''}`}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600"
              >
                {grant.permissionCode}
              </code>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default RetainedPermissionGrantNotice;
