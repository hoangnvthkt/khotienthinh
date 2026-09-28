import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import type { User } from '../types';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  ADMIN_PASSWORD_REASON_MIN_LENGTH,
  setUserPasswordByAdmin,
} from '../lib/userAccountLifecycleService';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';

// Admin sets a new password for someone who forgot theirs. The password is
// never stored here; the change is audited on the server.
const AdminSetPasswordForm: React.FC<{ targetUser: User }> = ({ targetUser }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reason, setReason] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setOpen(false);
    setPassword('');
    setConfirmPassword('');
    setReason('');
    setError('');
  }, [targetUser.id]);

  const disabled = targetUser.accountStatus === 'DISABLED' || targetUser.isActive === false;
  const tooShort = password.length > 0 && password.length < ADMIN_PASSWORD_MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const ready = password.length >= ADMIN_PASSWORD_MIN_LENGTH && password === confirmPassword
    && reason.trim().length >= ADMIN_PASSWORD_REASON_MIN_LENGTH;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      await setUserPasswordByAdmin({ targetUserId: targetUser.id, newPassword: password, reason });
      toast.success('Đã đặt mật khẩu mới', `Gửi mật khẩu cho ${targetUser.name} qua kênh riêng và nhắc họ đổi lại sau khi đăng nhập.`);
      setOpen(false);
      setPassword('');
      setConfirmPassword('');
      setReason('');
    } catch (err) {
      logApiError('settings.users.setPassword', err);
      setError(getApiErrorMessage(err, 'Không đặt được mật khẩu mới.'));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50';

  return (
    <div className="rounded-2xl border border-slate-100 p-4 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <KeyRound className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-slate-700">Mật khẩu</p>
            <p className="text-slate-500">
              {disabled
                ? 'Tài khoản đang bị vô hiệu hoá: dùng "Khôi phục tài khoản" để mở lại kèm mật khẩu mới.'
                : 'Người dùng tự đổi ở Cài đặt → Tài khoản. Khi họ quên, Admin đặt mật khẩu mới tại đây.'}
            </p>
          </div>
        </div>
        {!disabled && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50"
          >
            Đặt mật khẩu mới
          </button>
        )}
      </div>

      {open && !disabled && (
        <form onSubmit={submit} className="mt-3 space-y-2.5">
          <label className="block space-y-1">
            <span className="font-bold text-slate-600">Mật khẩu mới</span>
            <span className="relative block">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={saving}
                className={`${fieldClass} pr-9`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
            {tooShort && <span className="block text-[11px] font-bold text-rose-600">Ít nhất {ADMIN_PASSWORD_MIN_LENGTH} ký tự.</span>}
          </label>
          <label className="block space-y-1">
            <span className="font-bold text-slate-600">Nhập lại mật khẩu</span>
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              disabled={saving}
              className={fieldClass}
            />
            {mismatch && <span className="block text-[11px] font-bold text-rose-600">Hai mật khẩu chưa khớp.</span>}
          </label>
          <label className="block space-y-1">
            <span className="font-bold text-slate-600">Lý do</span>
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              disabled={saving}
              placeholder="Ví dụ: nhân viên quên mật khẩu, gọi điện xác nhận"
              className={fieldClass}
            />
            <span className="block text-[11px] text-slate-400">Ghi vào nhật ký hệ thống (không lưu mật khẩu). Ít nhất {ADMIN_PASSWORD_REASON_MIN_LENGTH} ký tự.</span>
          </label>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 font-bold text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-600 hover:bg-slate-50">
              Huỷ
            </button>
            <button type="submit" disabled={!ready || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-bold text-white hover:bg-slate-800 disabled:opacity-40">
              {saving && <Loader2 size={13} className="animate-spin" />} Đặt mật khẩu
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default AdminSetPasswordForm;
