import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Copy, ExternalLink, Layers, ShieldCheck } from 'lucide-react';
import { AuthorizationRoomAction, User, UserPermissionGrant } from '../../types';
import { getPermissionApplications } from '../../lib/permissions/permissionRegistry';
import { PermissionScope } from '../../lib/permissions/permissionTypes';
import PermissionDiffPreview from './PermissionDiffPreview';
import PermissionMatrix from './PermissionMatrix';
import PermissionScopePicker from './PermissionScopePicker';
import LegacyPermissionReadOnly from './LegacyPermissionReadOnly';

interface AuthorizationEditorProps {
  targetUser: User;
  directGrants: readonly UserPermissionGrant[];
  originalDirectGrants: readonly UserPermissionGrant[];
  inheritedPermissionCodes: readonly string[];
  roomActions?: readonly AuthorizationRoomAction[];
  reason: string;
  disabled?: boolean;
  onDirectGrantsChange: (grants: UserPermissionGrant[]) => void;
  onReasonChange: (reason: string) => void;
}

type AuthorizationClipboard = {
  version: 2;
  copiedAt: string;
  scope: Required<PermissionScope>;
  directGrants: Array<{
    permissionCode: string;
    scopeType: UserPermissionGrant['scopeType'];
    scopeId: string;
    expiresAt?: string;
  }>;
};

const AUTHORIZATION_CLIPBOARD_KEY = 'vioo:authorization-v2-clipboard';

const readClipboard = (): AuthorizationClipboard | null => {
  try {
    const raw = window.localStorage.getItem(AUTHORIZATION_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthorizationClipboard;
    return parsed.version === 2 && Array.isArray(parsed.directGrants) ? parsed : null;
  } catch {
    return null;
  }
};

const AuthorizationEditor: React.FC<AuthorizationEditorProps> = ({
  targetUser,
  directGrants,
  originalDirectGrants,
  inheritedPermissionCodes,
  roomActions = [],
  reason,
  disabled = false,
  onDirectGrantsChange,
  onReasonChange,
}) => {
  const applications = useMemo(() => getPermissionApplications(), []);
  const [applicationCode, setApplicationCode] = useState('all');
  const [scope, setScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
  const [clipboard, setClipboard] = useState<AuthorizationClipboard | null>(() => readClipboard());
  const projectRooms = useMemo(() => {
    const keys = new Set(roomActions.map(action => [
      action.projectId,
      action.constructionSiteId || '*',
      action.roomCode,
    ].join('::')));
    return { roomCount: keys.size, actionCount: roomActions.length };
  }, [roomActions]);

  const copyDirectGrants = () => {
    const payload: AuthorizationClipboard = {
      version: 2,
      copiedAt: new Date().toISOString(),
      scope: { scopeType: scope.scopeType || 'global', scopeId: scope.scopeId || '*' },
      directGrants: directGrants
        .filter(grant => grant.isActive !== false)
        .map(grant => ({
          permissionCode: grant.permissionCode,
          scopeType: grant.scopeType || 'global',
          scopeId: grant.scopeId || '*',
          expiresAt: grant.expiresAt,
        })),
    };
    window.localStorage.setItem(AUTHORIZATION_CLIPBOARD_KEY, JSON.stringify(payload));
    setClipboard(payload);
  };

  const pasteDirectGrants = () => {
    const payload = clipboard || readClipboard();
    if (!payload) return;
    setScope(payload.scope);
    onDirectGrantsChange(payload.directGrants.map((grant, index) => ({
      id: `clipboard-${index}-${grant.permissionCode}`,
      userId: targetUser.id,
      permissionCode: grant.permissionCode,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      expiresAt: grant.expiresAt,
      isActive: true,
    })));
  };

  return (
    <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/30 p-4">
      <section>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-700">
          <Layers size={14} /> Quyền truy cập module
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Module shell được suy ra từ capability hiệu lực; chọn ứng dụng để thu gọn ma trận bên dưới.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setApplicationCode('all')} className={`rounded-full border px-3 py-1 text-[10px] font-black ${applicationCode === 'all' ? 'border-blue-300 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>
            Tất cả
          </button>
          {applications.map(application => (
            <button key={application.code} type="button" onClick={() => setApplicationCode(application.code)} className={`rounded-full border px-3 py-1 text-[10px] font-black ${applicationCode === application.code ? 'border-blue-300 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>
              {application.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-700">
              <ShieldCheck size={14} /> Năng lực theo phạm vi
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Chỉ direct grant được sửa; quyền kế thừa luôn hiển thị ở trạng thái khóa.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={copyDirectGrants} disabled={disabled} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-black text-slate-600 disabled:opacity-50">
              <Copy size={12} /> Sao chép direct grants
            </button>
            <button type="button" onClick={pasteDirectGrants} disabled={disabled || !clipboard} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-black text-amber-700 disabled:opacity-50">
              <ClipboardPaste size={12} /> Dán grants + scope
            </button>
          </div>
        </div>
        <PermissionScopePicker value={scope} onChange={setScope} />
        <PermissionMatrix
          grants={directGrants}
          inheritedPermissionCodes={inheritedPermissionCodes}
          applicationCodes={applicationCode === 'all' ? undefined : [applicationCode]}
          targetUserId={targetUser.id}
          scope={scope}
          disabled={disabled}
          onChange={onDirectGrantsChange}
        />
        <PermissionDiffPreview before={originalDirectGrants} after={directGrants} />
      </section>

      <section className="rounded-xl border border-indigo-100 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Phân quyền Room dự án</div>
            <p className="mt-1 text-[10px] text-slate-500">
              {projectRooms.roomCount} Room / {projectRooms.actionCount} action hiệu lực. Thành viên và action Room được quản lý tại từng dự án.
            </p>
          </div>
          <a href="/da?tab=permissions" className="inline-flex shrink-0 items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-800">
            Mở quản trị Room <ExternalLink size={11} />
          </a>
        </div>
      </section>

      <LegacyPermissionReadOnly user={targetUser} directGrants={directGrants} />

      <label className="block space-y-1">
        <span className="text-xs font-black uppercase tracking-wide text-slate-600">Lý do thay đổi</span>
        <textarea
          required
          value={reason}
          onChange={event => onReasonChange(event.target.value)}
          disabled={disabled}
          rows={2}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50"
          placeholder="Mô tả lý do thay đổi hồ sơ hoặc quyền"
        />
      </label>
    </div>
  );
};

export default AuthorizationEditor;
