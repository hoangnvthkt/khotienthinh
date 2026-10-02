import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Role } from '../../types';
import {
  assignBusinessRole,
  getBusinessRoleAdminSnapshot,
  getUserSpecialRoles,
  previewBusinessRoleAssignment,
  revokeBusinessRoleAssignment,
  type UserSpecialRole,
} from '../../lib/permissions/businessRoleAdminService';
import { previewUserHrmBusinessRole, setUserHrmBusinessRole } from '../../lib/hrmAuthorizationService';
import {
  endOfDayIso,
  specialRoleChangeFor,
  specialRoleChangeLabel,
  specialRoleInfo,
  unknownHeldRoles,
  visibleSpecialRoles,
  type SpecialRoleChange,
} from '../../lib/permissions/specialRoles';

interface SpecialRolesEditorProps {
  userId: string;
}

type Draft = {
  change: SpecialRoleChange;
  until: string;
  reason: string;
  selfAccepted: boolean;
  busy: boolean;
  error: string;
  /** Set when the server asks for a confirmation (self-grant) before applying. */
  needsSelfAccept: boolean;
};

const formatDate = (value?: string) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? '' : new Date(time).toLocaleDateString('vi-VN');
};

const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

// Special roles are given here, one role at a time, and take effect at once —
// separately from the "Lưu thông tin" button that saves profile and permission boxes.
const SpecialRolesEditor: React.FC<SpecialRolesEditorProps> = ({ userId }) => {
  const { user: currentUser, refreshProfile } = useAuth();
  const toast = useToast();
  const canManage = currentUser?.role === Role.ADMIN;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [held, setHeld] = useState<UserSpecialRole[]>([]);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const retry = useCallback(() => setReload(count => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getUserSpecialRoles(userId)
      .then(result => { if (!cancelled) { setHeld(result); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [userId, reload]);

  useEffect(() => { setDraft(null); }, [userId]);

  const patchDraft = (patch: Partial<Draft>) => setDraft(current => current ? { ...current, ...patch } : current);

  const apply = async () => {
    if (!draft) return;
    const { change } = draft;
    const reason = draft.reason.trim();
    if (reason.length < 10) { patchDraft({ error: 'Lý do cần ít nhất 10 ký tự.' }); return; }
    patchDraft({ busy: true, error: '' });
    try {
      const info = specialRoleInfo(change.role);
      const expiresAt = change.kind === 'revoke' ? null : endOfDayIso(draft.until);
      if (info?.channel === 'hr') {
        const target = change.kind === 'revoke' ? 'NONE' : change.role as 'HR' | 'HR_MANAGE';
        const preview = await previewUserHrmBusinessRole(userId, target, expiresAt);
        if (preview.hardDenies.length > 0) {
          throw new Error(String(preview.hardDenies[0]?.message || 'Máy chủ không cho phép thay đổi này.'));
        }
        const selfGrant = preview.warnings.some(warning => warning.ruleCode === 'HRM_ADMIN_SELF_GRANT');
        if (selfGrant && !draft.selfAccepted) {
          patchDraft({ busy: false, needsSelfAccept: true });
          return;
        }
        await setUserHrmBusinessRole({
          targetUserId: userId,
          targetRoleCode: target,
          expiresAt,
          reason,
          warningAcceptances: selfGrant ? [{ ruleCode: 'HRM_ADMIN_SELF_GRANT', accepted: true }] : [],
          expectedFingerprint: preview.fingerprint,
        });
      } else if (change.kind === 'revoke') {
        await revokeBusinessRoleAssignment(change.assignmentId, reason);
      } else {
        const snapshot = await getBusinessRoleAdminSnapshot();
        const template = snapshot.templates.find(item => item.code === change.role && item.isActive);
        if (!template) throw new Error('Không tìm thấy mẫu vai trò này trên máy chủ.');
        const preview = await previewBusinessRoleAssignment({
          targetUserId: userId, roleTemplateId: template.id, scopeType: 'global', scopeId: '*',
        });
        if (preview.hardDenies.length > 0) {
          throw new Error(preview.hardDenies[0].message || 'Máy chủ không cho phép gán vai trò này.');
        }
        if (preview.warnings.length > 0) {
          throw new Error('Vai trò này cần khai báo kiểm soát bù (tách nhiệm). Hãy gán ở Cài đặt → Vai trò đặc biệt.');
        }
        await assignBusinessRole({
          targetUserId: userId,
          roleTemplateId: template.id,
          expectedRoleVersion: preview.roleVersion,
          scopeType: 'global',
          scopeId: '*',
          expiresAt: expiresAt || undefined,
          reason,
          warningAcceptances: [],
          expectedPreviewFingerprint: preview.fingerprint,
        });
      }
      toast.success('Đã cập nhật vai trò đặc biệt', `${specialRoleChangeLabel(change)}. Đã có hiệu lực.`);
      setDraft(null);
      retry();
      if (userId === currentUser?.id) await refreshProfile().catch(() => undefined);
    } catch (cause) {
      patchDraft({ busy: false, error: messageOf(cause, 'Không lưu được thay đổi vai trò.') });
    }
  };

  const rows = visibleSpecialRoles(held);
  const unknown = unknownHeldRoles(held);

  return (
    <section className="space-y-3 rounded-2xl border border-indigo-100 bg-white p-4">
      <div>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-indigo-700">
          <ShieldCheck size={14} /> Vai trò đặc biệt
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Chỉ vài người cần: mở dữ liệu nhân sự nhạy cảm (hồ sơ, lương) hoặc quyền kiểm toán. Thay đổi ở đây
          <b className="font-bold text-slate-700"> có hiệu lực ngay khi xác nhận</b>, không cần bấm "Lưu thông tin".
        </p>
      </div>

      {state === 'loading' && (
        <p className="flex items-center gap-2 text-xs font-bold text-slate-400"><Loader2 size={14} className="animate-spin" /> Đang tải vai trò…</p>
      )}
      {state === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          Không tải được vai trò đặc biệt của người này.
          <button type="button" onClick={retry} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-black">
            <RefreshCw size={12} /> Thử lại
          </button>
        </div>
      )}

      {state === 'ready' && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
          {rows.map(role => {
            const current = held.find(item => item.roleCode === role.code);
            const change = specialRoleChangeFor(held, role.code);
            const editing = draft?.change.role === role.code ? draft : null;
            return (
              <li key={role.code} className="p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-slate-800">{role.label}</span>
                      {current ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                          <CheckCircle2 size={11} /> Đang giữ{current.expiresAt ? ` · đến ${formatDate(current.expiresAt)}` : ''}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Chưa có</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-500">Dành cho: {role.forWho}</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">{role.meaning}</p>
                  </div>
                  {canManage && change && !editing && (
                    <button
                      type="button"
                      disabled={Boolean(draft?.busy)}
                      onClick={() => setDraft({ change, until: '', reason: '', selfAccepted: false, busy: false, error: '', needsSelfAccept: false })}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-black disabled:opacity-40 ${change.kind === 'revoke'
                        ? 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                        : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
                    >
                      {change.kind === 'revoke' ? 'Thu hồi' : change.kind === 'switch' ? 'Đổi sang vai trò này' : 'Gán'}
                    </button>
                  )}
                </div>

                {editing && (
                  <div className="mt-3 space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black text-indigo-900">{specialRoleChangeLabel(editing.change)}</p>
                      <button type="button" aria-label="Đóng" disabled={editing.busy} onClick={() => setDraft(null)} className="rounded p-1 text-slate-400 hover:text-slate-700">
                        <X size={14} />
                      </button>
                    </div>
                    {editing.change.kind === 'revoke' && (
                      <p className="text-[11px] text-slate-600">Người này mất ngay các quyền của vai trò. Quyền riêng ở phần trên không bị ảnh hưởng.</p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                      {editing.change.kind !== 'revoke' && (
                        <label className="text-[11px] font-bold text-slate-600">
                          Đến ngày (không bắt buộc)
                          <input type="date" value={editing.until} disabled={editing.busy}
                            onChange={event => patchDraft({ until: event.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                        </label>
                      )}
                      <label className={`text-[11px] font-bold text-slate-600 ${editing.change.kind === 'revoke' ? 'sm:col-span-2' : ''}`}>
                        Lý do
                        <input value={editing.reason} disabled={editing.busy}
                          onChange={event => patchDraft({ reason: event.target.value, error: '' })}
                          placeholder="Ví dụ: Nhận vị trí chuyên viên nhân sự từ 01/10"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                      </label>
                    </div>
                    {editing.needsSelfAccept && (
                      <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-semibold text-amber-900">
                        <input type="checkbox" checked={editing.selfAccepted} onChange={event => patchDraft({ selfAccepted: event.target.checked })} className="mt-0.5" />
                        Tôi xác nhận đang tự mở quyền xem và quản lý dữ liệu nhân sự nhạy cảm cho chính mình.
                      </label>
                    )}
                    {editing.error && (
                      <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-bold text-rose-700">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {editing.error}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button type="button" disabled={editing.busy} onClick={() => setDraft(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600">Hủy</button>
                      <button
                        type="button"
                        disabled={editing.busy || editing.reason.trim().length < 10 || (editing.needsSelfAccept && !editing.selfAccepted)}
                        onClick={() => void apply()}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-40 ${editing.change.kind === 'revoke' ? 'bg-rose-600' : 'bg-indigo-600'}`}
                      >
                        {editing.busy && <Loader2 size={12} className="animate-spin" />}
                        {editing.change.kind === 'revoke' ? 'Xác nhận thu hồi' : 'Xác nhận gán'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {unknown.map(role => (
            <li key={role.assignmentId} className="p-3">
              <span className="text-sm font-black text-slate-800">{role.roleName}</span>
              <span className="ml-2 text-[11px] text-slate-500">{role.expiresAt ? `Đến ${formatDate(role.expiresAt)}` : 'Không giới hạn thời gian'} · quản lý ở Cài đặt → Vai trò đặc biệt</span>
            </li>
          ))}
        </ul>
      )}
      {state === 'ready' && !canManage && (
        <p className="text-[11px] font-semibold text-slate-400">Chỉ Quản trị viên được gán hoặc thu hồi vai trò đặc biệt.</p>
      )}
    </section>
  );
};

export default SpecialRolesEditor;
