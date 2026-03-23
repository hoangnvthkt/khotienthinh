import React from 'react';
import { User } from '../../types';
import { Upload, Save, AlertCircle } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

interface SettingsAccountProps {
  currentUser: User;
  updateUser: (u: User) => void;
  logout: () => void;
  avatarInputRef: React.RefObject<HTMLInputElement>;
  handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const SettingsAccount: React.FC<SettingsAccountProps> = ({
  currentUser, updateUser, logout, avatarInputRef, handleAvatarUpload
}) => {
  const [passwords, setPasswords] = React.useState({ current: '', new: '', confirm: '' });
  const [passError, setPassError] = React.useState('');
  const [passSuccess, setPassSuccess] = React.useState('');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassSuccess('');

    if (passwords.new.length < 6) {
      setPassError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (passwords.new !== passwords.confirm) {
      setPassError('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    if (isSupabaseConfigured) {
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: passwords.current,
        });
        if (signInError) {
          setPassError(`Mật khẩu hiện tại không chính xác. (Chi tiết: ${signInError.message})`);
          return;
        }
        const response = await supabase.functions.invoke('reset-password', {
          body: { email: currentUser.email, newPassword: passwords.new },
        });
        if (response.error) {
          setPassError(`Lỗi khi gọi chức năng đổi mật khẩu: ${response.error.message}`);
          return;
        }
        const result = response.data;
        if (result?.error) {
          setPassError(`Đổi mật khẩu thất bại: ${result.error}`);
          return;
        }
        updateUser({ ...currentUser, password: passwords.new });
        setPassSuccess('✅ Đã đổi mật khẩu thành công! Mật khẩu mới đã được cập nhật trên Supabase Auth.');
        setPasswords({ current: '', new: '', confirm: '' });
      } catch (err: any) {
        setPassError(`Có lỗi xảy ra: ${err.message || 'Không xác định'}`);
      }
    } else {
      if (passwords.current !== currentUser.password) {
        setPassError('Mật khẩu hiện tại không chính xác.');
        return;
      }
      updateUser({ ...currentUser, password: passwords.new });
      setPassSuccess('✅ Đã đổi mật khẩu thành công!');
      setPasswords({ current: '', new: '', confirm: '' });
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
              <button onClick={() => avatarInputRef.current?.click()} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm flex items-center">
                <Upload size={14} className="mr-2" /> Tải ảnh lên
              </button>
              <input type="file" ref={avatarInputRef} onChange={handleAvatarUpload} accept="image/*" className="hidden" />
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
          <button type="submit" className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition shadow-lg">
            Cập nhật mật khẩu
          </button>
        </form>

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
