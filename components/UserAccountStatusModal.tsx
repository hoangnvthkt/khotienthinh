import React, { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, RotateCcw, UserX, X } from 'lucide-react';
import type {
  User,
  UserAccountLifecycleAction,
  UserAccountLifecyclePreview,
} from '../types';
import { getUserAccountLifecyclePreview } from '../lib/userAccountLifecycleService';

interface UserAccountStatusModalProps {
  isOpen: boolean;
  action: UserAccountLifecycleAction;
  targetUser: User | null;
  isSaving?: boolean;
  onClose: () => void;
  onConfirm: (input: { reason: string; newPassword?: string }) => void | Promise<void>;
}

const UserAccountStatusModal: React.FC<UserAccountStatusModalProps> = ({
  isOpen,
  action,
  targetUser,
  isSaving = false,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [preview, setPreview] = useState<UserAccountLifecyclePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const isDisable = action === 'DISABLE';
  const isRetry = targetUser?.accountOperationStatus === 'AUTH_RETRY'
    && targetUser.accountOperationAction === action;
  const canSubmit = reason.trim().length >= 5
    && (isDisable || newPassword.length >= 8)
    && Boolean(preview)
    && !previewError
    && (isDisable || preview?.hasAuthIdentity === true)
    && !isSaving;

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setNewPassword('');
    setPreview(null);
    setPreviewError('');
    if (!targetUser) return;

    let cancelled = false;
    setIsPreviewLoading(true);
    void getUserAccountLifecyclePreview(targetUser)
      .then(value => {
        if (!cancelled) setPreview(value);
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Không tải được thông tin quyền và trách nhiệm hiện hành.');
      })
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [action, isOpen, targetUser?.id]);

  if (!isOpen || !targetUser) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isDisable ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
              {isDisable ? <UserX size={21} /> : <RotateCcw size={21} />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                {isRetry
                  ? 'Thử lại đồng bộ đăng nhập'
                  : isDisable
                    ? 'Vô hiệu hóa tài khoản'
                    : 'Khôi phục tài khoản'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">{targetUser.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Đóng">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <form
          className="space-y-4 p-5"
          onSubmit={event => {
            event.preventDefault();
            if (!canSubmit) return;
            void onConfirm({
              reason: reason.trim(),
              ...(isDisable ? {} : { newPassword }),
            });
          }}
        >
          <p className="text-sm leading-6 text-slate-600">
            {isDisable
              ? 'Tài khoản sẽ ngừng đăng nhập và toàn bộ quyền hiện hành bị thu hồi. Hồ sơ HRM và lịch sử nghiệp vụ vẫn được giữ.'
              : 'Tài khoản được mở lại với quyền nghiệp vụ bằng 0. Quyền cũ sẽ không được khôi phục.'}
          </p>

          {isRetry && (
            <div className="flex gap-2 border-y border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>Cần thử lại đồng bộ đăng nhập. Backend vẫn đang khóa tài khoản an toàn.</span>
            </div>
          )}

          <div className="border-y border-slate-100 py-3 text-xs text-slate-600">
            {isPreviewLoading && <span>Đang tải quyền và trách nhiệm hiện hành...</span>}
            {previewError && <span className="text-red-600">{previewError}</span>}
            {preview && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt>Direct grant</dt><dd className="font-bold text-slate-800">{preview.directGrants}</dd></div>
                <div><dt>Legacy module</dt><dd className="font-bold text-slate-800">{preview.legacyModules}</dd></div>
                <div><dt>Phân công dự án</dt><dd className="font-bold text-slate-800">{preview.projectStaffAssignments}</dd></div>
                <div><dt>Trách nhiệm cần phân công lại</dt><dd className="font-bold text-amber-700">{preview.needsReassignment}</dd></div>
              </dl>
            )}
          </div>

          {!isDisable && preview && !preview.hasAuthIdentity && (
            <p className="text-sm text-red-600">Tài khoản chưa liên kết Supabase Auth nên chưa thể khôi phục.</p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-700">Lý do</span>
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              required
            />
          </label>

          {!isDisable && (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <KeyRound size={14} /> Mật khẩu mới
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                required
              />
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`flex flex-1 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45 ${isDisable ? 'bg-red-600' : 'bg-emerald-600'}`}
            >
              {isSaving
                ? <Loader2 size={18} className="animate-spin" />
                : isDisable
                  ? <><UserX size={17} className="mr-2" /> {isRetry ? 'Thử lại' : 'Vô hiệu hóa'}</>
                  : <><RotateCcw size={17} className="mr-2" /> {isRetry ? 'Thử lại' : 'Khôi phục'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserAccountStatusModal;
