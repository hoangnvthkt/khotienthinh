import React from 'react';
import { User } from '../../types';
import { Bell, BellOff, CheckCircle2, Loader2, Upload, Save, AlertCircle } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { webPushService } from '../../lib/webPushService';

interface SettingsAccountProps {
  currentUser: User;
  updateUser: (u: User) => void | Promise<void>;
  logout: () => void;
  avatarInputRef: React.RefObject<HTMLInputElement>;
  handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  avatarUploading?: boolean;
}

const SettingsAccount: React.FC<SettingsAccountProps> = ({
  currentUser, updateUser, logout, avatarInputRef, handleAvatarUpload, avatarUploading = false
}) => {
  const toast = useToast();
  const [passwords, setPasswords] = React.useState({ current: '', new: '', confirm: '' });
  const [passError, setPassError] = React.useState('');
  const [passSuccess, setPassSuccess] = React.useState('');
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [pushPermission, setPushPermission] = React.useState<NotificationPermission>(() => webPushService.getNotificationPermission());
  const [pushCapability, setPushCapability] = React.useState(() => webPushService.getCapability());
  const [pushEnabled, setPushEnabled] = React.useState(false);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushMessage, setPushMessage] = React.useState('');
  const isIOS = webPushService.isIOS();
  const isStandalonePWA = webPushService.isStandalonePWA();

  const refreshPushState = React.useCallback(async () => {
    setPushCapability(webPushService.getCapability());
    setPushPermission(webPushService.getNotificationPermission());
    try {
      setPushEnabled(await webPushService.isEnabledForThisDevice(currentUser.id));
    } catch {
      setPushEnabled(false);
    }
  }, [currentUser.id]);

  React.useEffect(() => {
    void refreshPushState();
  }, [refreshPushState]);

  const getPushStatusText = () => {
    if (pushEnabled) return 'Đang bật trên thiết bị này';
    if (pushPermission === 'denied') return 'Đang bị chặn bởi trình duyệt';
    if (!pushCapability.supported) {
      if (pushCapability.reason === 'ios_requires_standalone') return 'iPhone/iPad cần mở từ màn hình chính';
      if (pushCapability.reason === 'missing_vapid_key') return 'Chưa cấu hình VAPID public key';
      if (pushCapability.reason === 'insecure_context') return 'Cần HTTPS hoặc localhost';
      return 'Trình duyệt chưa hỗ trợ Web Push';
    }
    if (pushPermission === 'granted') return 'Sẵn sàng bật';
    return 'Chưa bật';
  };

  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      if (!webPushService.isPushSupported()) {
        await refreshPushState();
        setPushMessage('Thiết bị hoặc trình duyệt hiện tại chưa sẵn sàng nhận Web Push.');
        return;
      }

      const permission = webPushService.getNotificationPermission() === 'granted'
        ? 'granted'
        : await webPushService.requestNotificationPermission();
      setPushPermission(permission);

      if (permission !== 'granted') {
        setPushMessage(permission === 'denied'
          ? 'Trình duyệt đang chặn thông báo. Vui lòng bật lại trong cài đặt site/browser.'
          : 'Anh chưa cấp quyền thông báo cho thiết bị này.');
        return;
      }

      const enabled = await webPushService.subscribeUserToPush(currentUser.id);
      setPushEnabled(enabled);
      setPushMessage(enabled ? 'Đã bật thông báo trên thiết bị này.' : 'Không thể tạo subscription cho thiết bị này.');
      if (enabled) toast.success('Đã bật thông báo thiết bị');
    } catch (err: any) {
      logApiError('settingsAccount.enableWebPush', err);
      const message = getApiErrorMessage(err, 'Không thể bật thông báo trên thiết bị này.');
      setPushMessage(message);
      toast.error('Không thể bật thông báo', message);
    } finally {
      setPushBusy(false);
      void refreshPushState();
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      await webPushService.disablePushForThisDevice(currentUser.id);
      setPushEnabled(false);
      setPushMessage('Đã tắt thông báo trên thiết bị này.');
      toast.success('Đã tắt thông báo thiết bị');
    } catch (err: any) {
      logApiError('settingsAccount.disableWebPush', err);
      const message = getApiErrorMessage(err, 'Không thể tắt thông báo trên thiết bị này.');
      setPushMessage(message);
      toast.error('Không thể tắt thông báo', message);
    } finally {
      setPushBusy(false);
      void refreshPushState();
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassSuccess('');

    if (passwords.new.length < 6) {
      setPassError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      toast.warning('Mật khẩu chưa hợp lệ', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (passwords.new !== passwords.confirm) {
      setPassError('Xác nhận mật khẩu mới không khớp.');
      toast.warning('Mật khẩu chưa khớp', 'Vui lòng nhập lại phần xác nhận mật khẩu.');
      return;
    }

    setSavingPassword(true);
    if (isSupabaseConfigured) {
      try {
        const email = currentUser.email?.trim();
        if (!email) {
          throw new Error('Tài khoản chưa có email đăng nhập để xác thực mật khẩu hiện tại.');
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: passwords.current,
        });
        if (signInError) {
          const message = 'Mật khẩu hiện tại không chính xác.';
          setPassError(message);
          toast.error('Không thể đổi mật khẩu', message);
          return;
        }

        const { error: updatePasswordError } = await supabase.auth.updateUser({
          password: passwords.new,
        });
        if (updatePasswordError) throw updatePasswordError;

        const message = 'Đã đổi mật khẩu thành công.';
        setPassSuccess(message);
        toast.success('Đã cập nhật mật khẩu');
        setPasswords({ current: '', new: '', confirm: '' });
      } catch (err: any) {
        logApiError('settingsAccount.changePassword', err);
        const message = getApiErrorMessage(err, 'Không thể đổi mật khẩu. Vui lòng thử lại.');
        setPassError(message);
        toast.error('Không thể đổi mật khẩu', message);
      } finally {
        setSavingPassword(false);
      }
    } else {
      try {
        if (passwords.current !== currentUser.password) {
          const message = 'Mật khẩu hiện tại không chính xác.';
          setPassError(message);
          toast.error('Không thể đổi mật khẩu', message);
          return;
        }
        await updateUser({ ...currentUser, password: passwords.new });
        const message = 'Đã đổi mật khẩu thành công.';
        setPassSuccess(message);
        toast.success('Đã cập nhật mật khẩu');
        setPasswords({ current: '', new: '', confirm: '' });
      } catch (err: any) {
        logApiError('settingsAccount.changePassword.local', err);
        const message = getApiErrorMessage(err, 'Không thể đổi mật khẩu. Vui lòng thử lại.');
        setPassError(message);
        toast.error('Không thể đổi mật khẩu', message);
      } finally {
        setSavingPassword(false);
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50">
        <h2 className="text-lg font-bold text-slate-800">Tài khoản cá nhân</h2>
        <p className="text-xs text-slate-500 font-medium">Thay đổi thông tin, ảnh đại diện và mật khẩu.</p>
      </div>
      <div className="p-6 space-y-8">
        <div>
          <h3 className="text-sm font-bold text-slate-800 mb-4">Ảnh đại diện</h3>
          <div className="flex items-center gap-6">
            <img src={currentUser.avatar} alt="Avatar" className="w-20 h-20 rounded-full border-4 border-slate-50 shadow-sm object-cover" />
            <div className="space-y-2">
              <button onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm flex items-center disabled:opacity-60">
                {avatarUploading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Upload size={14} className="mr-2" />} {avatarUploading ? 'Đang tải...' : 'Tải ảnh lên'}
              </button>
              <input type="file" ref={avatarInputRef} onChange={handleAvatarUpload} accept="image/*" className="hidden" disabled={avatarUploading} />
              <p className="text-[10px] text-slate-400">Định dạng hỗ trợ: JPG, PNG. Ảnh sẽ được tự động cắt theo hình vuông.</p>
            </div>
          </div>
        </div>

        <h3 className="text-sm font-bold text-slate-800 mb-4">Đổi mật khẩu</h3>
        <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
          {passError && (
            <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center gap-3 text-red-600">
              <AlertCircle size={18} />
              <p className="text-xs font-bold">{passError}</p>
            </div>
          )}
          {passSuccess && (
            <div className="bg-green-50 border border-green-100 p-4 rounded-xl flex items-center gap-3 text-green-600">
              <Save size={18} />
              <p className="text-xs font-bold">{passSuccess}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mật khẩu hiện tại</label>
            <input type="password" required value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mật khẩu mới</label>
            <input type="password" required value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Xác nhận mật khẩu mới</label>
            <input type="password" required value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium" />
          </div>
          <button type="submit" disabled={savingPassword} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition shadow-lg disabled:opacity-60 inline-flex items-center">
            {savingPassword && <Loader2 size={16} className="mr-2 animate-spin" />}
            {savingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
          </button>
        </form>

        <div className="pt-8 border-t border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 mb-2">Thông báo trên thiết bị</h3>
          <p className="text-xs text-slate-500 mb-4">Nhận thông báo quan trọng ngay cả khi không mở ERP trên màn hình.</p>
          <div className="max-w-2xl rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${pushEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-500 border border-slate-200'}`}>
                  {pushEnabled ? <CheckCircle2 size={18} /> : <Bell size={18} />}
                </div>
                <div>
                  <p className="text-sm font-black text-slate-800">{getPushStatusText()}</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-500">
                    {webPushService.getPlatform()} · {webPushService.getDeviceType()} · quyền: {pushPermission}
                  </p>
                  {pushPermission === 'denied' && (
                    <p className="mt-2 text-[11px] font-semibold text-amber-600">Thông báo đang bị chặn. Hãy mở cài đặt trình duyệt/site và cho phép Notifications.</p>
                  )}
                  {isIOS && !isStandalonePWA && (
                    <p className="mt-2 text-[11px] font-semibold text-blue-600">Trên iPhone/iPad, hãy mở app bằng icon ngoài màn hình chính. Nếu chưa có, bấm Share rồi chọn Add to Home Screen.</p>
                  )}
                  {pushMessage && <p className="mt-2 text-[11px] font-semibold text-slate-600">{pushMessage}</p>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={handleEnablePush}
                  disabled={pushBusy || pushEnabled || !pushCapability.supported || pushPermission === 'denied'}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pushBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Bell size={14} className="mr-2" />}
                  Bật thông báo
                </button>
                <button
                  type="button"
                  onClick={handleDisablePush}
                  disabled={pushBusy || !pushEnabled}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <BellOff size={14} className="mr-2" />
                  Tắt thiết bị này
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 mb-2">Đăng xuất</h3>
          <p className="text-xs text-slate-500 mb-4">Kết thúc phiên làm việc hiện tại trên thiết bị này.</p>
          <button
            onClick={() => { logout(); window.location.href = '/login'; }}
            className="px-6 py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold hover:bg-red-600 hover:text-white transition"
          >
            Đăng xuất ngay
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsAccount;
