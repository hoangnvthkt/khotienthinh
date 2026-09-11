import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Copy, ExternalLink, Layers, ShieldCheck } from 'lucide-react';
import {
  AuthorizationRoomAction,
  EffectivePermissionSource,
  User,
  UserPermissionGrant,
} from '../../types';
import { listPermissionAdminCatalog } from '../../lib/permissions/permissionCatalogService';
import { PermissionAdminCatalog, PermissionScope } from '../../lib/permissions/permissionTypes';
import {
  AuthorizationValidationIssue,
  getCatalogEditableGrants,
  getRetainedHiddenGrants,
} from '../../lib/permissions/authorizationUpdateValidation';
import PermissionDiffPreview from './PermissionDiffPreview';
import PermissionModuleEditor from './PermissionModuleEditor';
import LegacyPermissionReadOnly from './LegacyPermissionReadOnly';
import RetainedPermissionGrantNotice from './RetainedPermissionGrantNotice';

interface AuthorizationEditorProps {
  targetUser: User;
  directGrants: readonly UserPermissionGrant[];
  originalDirectGrants: readonly UserPermissionGrant[];
  inheritedPermissionCodes: readonly string[];
  effectivePermissionSources?: readonly EffectivePermissionSource[];
  roomActions?: readonly AuthorizationRoomAction[];
  reason: string;
  validationIssues?: readonly AuthorizationValidationIssue[];
  disabled?: boolean;
  onCatalogChange?: (catalog: PermissionAdminCatalog | null) => void;
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
  effectivePermissionSources = [],
  roomActions = [],
  reason,
  validationIssues = [],
  disabled = false,
  onCatalogChange,
  onDirectGrantsChange,
  onReasonChange,
}) => {
  const [catalog, setCatalog] = useState<PermissionAdminCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogReload, setCatalogReload] = useState(0);
  const [clipboard, setClipboard] = useState<AuthorizationClipboard | null>(() => readClipboard());
  const inheritedSources = useMemo<EffectivePermissionSource[]>(() => {
    if (effectivePermissionSources.length > 0) {
      return effectivePermissionSources.filter(source => source.sourceType !== 'DIRECT');
    }
    return inheritedPermissionCodes.map(permissionCode => ({
      permissionCode,
      sourceType: 'INHERITED',
      sourceLabel: 'nguồn hiện có',
      scopeType: 'global',
      scopeId: '*',
      isBusinessApproval: false,
      metadata: {},
    }));
  }, [effectivePermissionSources, inheritedPermissionCodes]);
  const projectRooms = useMemo(() => {
    const keys = new Set(roomActions.map(action => [
      action.projectId,
      action.constructionSiteId || '*',
      action.roomCode,
    ].join('::')));
    return { roomCount: keys.size, actionCount: roomActions.length };
  }, [roomActions]);
  const retainedHiddenGrants = useMemo(() => catalog
    ? getRetainedHiddenGrants({
      grants: directGrants,
      originalGrants: originalDirectGrants,
      catalog,
    })
    : [], [catalog, directGrants, originalDirectGrants]);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);
    onCatalogChange?.(null);
    listPermissionAdminCatalog()
      .then(nextCatalog => {
        if (!cancelled) {
          setCatalog(nextCatalog);
          onCatalogChange?.(nextCatalog);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : 'Không tải được danh mục phân quyền.');
          onCatalogChange?.(null);
        }
      });
    return () => { cancelled = true; };
  }, [catalogReload, onCatalogChange]);

  const copyDirectGrants = () => {
    if (!catalog) return;
    const payload: AuthorizationClipboard = {
      version: 2,
      copiedAt: new Date().toISOString(),
      scope: { scopeType: 'global', scopeId: '*' },
      directGrants: getCatalogEditableGrants({ grants: directGrants, catalog })
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
    if (!payload || !catalog) return;
    const pastedGrants = payload.directGrants.map((grant, index) => ({
      id: `clipboard-${index}-${grant.permissionCode}`,
      userId: targetUser.id,
      permissionCode: grant.permissionCode,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      expiresAt: grant.expiresAt,
      isActive: true,
    }));
    onDirectGrantsChange([
      ...retainedHiddenGrants,
      ...getCatalogEditableGrants({ grants: pastedGrants, catalog }),
    ]);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/30 p-4">
      <section>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-700">
          <Layers size={14} /> Quyền truy cập module
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Tích Module để tự chọn toàn bộ quyền Xem hợp lệ; mở chi tiết khi cần điều chỉnh từng phân hệ.
        </p>
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
            <button type="button" onClick={copyDirectGrants} disabled={disabled || !catalog} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-black text-slate-600 disabled:opacity-50">
              <Copy size={12} /> Sao chép direct grants
            </button>
            <button type="button" onClick={pasteDirectGrants} disabled={disabled || !catalog || !clipboard} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-black text-amber-700 disabled:opacity-50">
              <ClipboardPaste size={12} /> Dán grants + scope
            </button>
          </div>
        </div>
        {!catalog && !catalogError && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            Đang tải danh mục phân quyền…
          </div>
        )}
        {catalogError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <p className="font-bold">Không tải được danh mục phân quyền</p>
            <p className="mt-1">{catalogError}</p>
            <button
              type="button"
              onClick={() => setCatalogReload(value => value + 1)}
              className="mt-2 min-h-10 rounded-lg border border-rose-300 bg-white px-3 font-bold"
            >
              Thử lại
            </button>
          </div>
        )}
        {catalog && (
          <>
            <RetainedPermissionGrantNotice grants={retainedHiddenGrants} />
            <PermissionModuleEditor
              catalog={catalog}
              grants={directGrants}
              inheritedSources={inheritedSources}
              targetUserId={targetUser.id}
              disabled={disabled}
              onChange={onDirectGrantsChange}
            />
          </>
        )}
        {validationIssues.filter(issue => issue.field !== 'reason').length > 0 && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <p className="font-bold">Cần kiểm tra lại quyền đã chọn</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {validationIssues.filter(issue => issue.field !== 'reason').map((issue, index) => (
                <li key={`${issue.code}-${issue.permissionCode || index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
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
