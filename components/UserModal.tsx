
import React, { useState, useEffect } from 'react';
import { X, User as UserIcon, Mail, Phone, Shield, Building, Save, Package, Briefcase, GitBranch, BarChart3, Landmark, Loader2, CheckCircle2, XCircle, Crown, Inbox } from 'lucide-react';
import { Role, User, Warehouse } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  userToEdit?: User | null;
  warehouses: Warehouse[];
}

const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, userToEdit, warehouses }) => {
  const ALL_MODULES = [
    { key: 'WMS', label: 'KHO - Vật tư', icon: Package, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700' },
    { key: 'HRM', label: 'NS - Nhân sự', icon: Briefcase, color: 'text-teal-600 bg-teal-50 border-teal-200 dark:bg-teal-900/30 dark:border-teal-700' },
    { key: 'WF', label: 'QT - Quy trình', icon: GitBranch, color: 'text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-900/30 dark:border-violet-700' },
    { key: 'DA', label: 'DA - Dự án', icon: BarChart3, color: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-700' },
    { key: 'TS', label: 'TS - Tài sản', icon: Landmark, color: 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-900/30 dark:border-rose-700' },
    { key: 'RQ', label: 'RQ - Yêu cầu', icon: Inbox, color: 'text-cyan-600 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/30 dark:border-cyan-700' },
    { key: 'EX', label: 'CP - Chi phí', icon: BarChart3, color: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-700' },
  ];

  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    email: '',
    username: '',
    password: '',
    phone: '',
    role: Role.EMPLOYEE,
    assignedWarehouseId: '',
    allowedModules: ALL_MODULES.map(m => m.key),
    adminModules: [],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (userToEdit) {
      setFormData({ ...userToEdit, password: '', allowedModules: userToEdit.allowedModules || ALL_MODULES.map(m => m.key), adminModules: userToEdit.adminModules || [] });
    } else {
      setFormData({
        name: '',
        email: '',
        username: '',
        password: '',
        phone: '',
        role: Role.EMPLOYEE,
        assignedWarehouseId: '',
        allowedModules: ALL_MODULES.map(m => m.key),
        adminModules: [],
      });
    }
    setErrors({});
    setToast(null);
  }, [userToEdit, isOpen]);

  // Auto-hide toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (!isOpen) return null;

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) newErrors.name = 'Vui lòng nhập họ tên';
    if (!formData.email?.trim()) newErrors.email = 'Vui lòng nhập email';
    if (!formData.username?.trim()) newErrors.username = 'Vui lòng nhập tên đăng nhập';
    if (!userToEdit && !formData.password?.trim()) newErrors.password = 'Vui lòng nhập mật khẩu';
    if (formData.password && formData.password.length > 0 && formData.password.length < 6) {
      newErrors.password = 'Mật khẩu phải có ít nhất 6 ký tự';
    }
    if (!formData.role) newErrors.role = 'Vui lòng chọn chức vụ';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    setToast(null);

    try {
      const hasPasswordChange = formData.password && formData.password.trim().length > 0;

      // If editing user and password is being changed, update Supabase Auth first
      if (userToEdit && hasPasswordChange && isSupabaseConfigured) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');

          const response = await supabase.functions.invoke('reset-password', {
            body: {
              email: formData.email,
              newPassword: formData.password,
            },
          });

          if (response.error) {
            throw new Error(response.error.message || 'Lỗi gọi Edge Function');
          }

          const result = response.data;
          if (result.error) {
            throw new Error(result.error);
          }

          setToast({ type: 'success', message: `✅ Đổi mật khẩu Supabase Auth thành công cho ${formData.name}` });
        } catch (pwErr: any) {
          setSaving(false);
          setToast({ type: 'error', message: `❌ Đổi mật khẩu thất bại: ${pwErr.message}` });
          return; // Don't save user if password change failed
        }
      }

      const finalUser: User = {
        id: userToEdit?.id || crypto.randomUUID(),
        name: formData.name || '',
        email: formData.email || '',
        username: formData.username || '',
        password: formData.password || userToEdit?.password || '',
        phone: formData.phone || '',
        role: formData.role as Role,
        avatar: formData.avatar || `https://i.pravatar.cc/150?u=${formData.email}`,
        assignedWarehouseId: formData.assignedWarehouseId || undefined,
        allowedModules: formData.role === Role.ADMIN ? ALL_MODULES.map(m => m.key) : (formData.allowedModules || []),
        adminModules: formData.role === Role.ADMIN ? [] : (formData.adminModules || []),
      };

      onSave(finalUser);
      setSaving(false);

      if (hasPasswordChange && userToEdit) {
        // Password was changed — show success toast and keep modal open for 3 seconds
        setToast({ type: 'success', message: `✅ Đổi mật khẩu thành công cho ${formData.name}! Mật khẩu mới đã cập nhật trên Supabase Auth.` });
        setTimeout(() => onClose(), 3000);
      } else {
        // No password change — close after brief toast
        setToast({ type: 'success', message: userToEdit ? '✅ Cập nhật thông tin thành công!' : '✅ Thêm nhân sự thành công!' });
        setTimeout(() => onClose(), 1500);
      }
    } catch (err: any) {
      setToast({ type: 'error', message: `❌ Lỗi: ${err.message || 'Có lỗi xảy ra'}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-300 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <h3 className="font-bold text-lg text-slate-800">
            {userToEdit ? 'Cập nhật nhân sự' : 'Thêm nhân sự mới'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Toast notification */}
        {toast && (
          <div className={`mx-6 mt-4 p-3 rounded-xl flex items-center gap-2 text-sm font-bold animate-in slide-in-from-top-2 duration-300 ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
            {toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span className="text-xs">{toast.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Họ tên */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
              <UserIcon size={12} className="mr-1" /> Họ và tên
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className={`w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-accent ${errors.name ? 'border-red-500' : 'border-slate-200'}`}
              placeholder="Nguyễn Văn A"
            />
            {errors.name && <p className="text-[10px] text-red-500 font-bold">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Email */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Mail size={12} className="mr-1" /> Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className={`w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-accent ${errors.email ? 'border-red-500' : 'border-slate-200'}`}
                placeholder="example@khoviet.com"
              />
              {errors.email && <p className="text-[10px] text-red-500 font-bold">{errors.email}</p>}
            </div>

            {/* SĐT */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Phone size={12} className="mr-1" /> Số điện thoại
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-accent"
                placeholder="09xx xxx xxx"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Username */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <UserIcon size={12} className="mr-1" /> Tên đăng nhập
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
                className={`w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-accent ${errors.username ? 'border-red-500' : 'border-slate-200'}`}
                placeholder="username"
              />
              {errors.username && <p className="text-[10px] text-red-500 font-bold">{errors.username}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Shield size={12} className="mr-1" /> {userToEdit ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'}
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className={`w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-accent ${errors.password ? 'border-red-500' : 'border-slate-200'}`}
                placeholder="••••••••"
              />
              {errors.password && <p className="text-[10px] text-red-500 font-bold">{errors.password}</p>}
              {userToEdit && (
                <p className="text-[9px] text-amber-600 italic">⚠️ Mật khẩu tối thiểu 6 ký tự. Đổi mật khẩu sẽ cập nhật cả Supabase Auth.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Chức vụ */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Shield size={12} className="mr-1" /> Chức vụ
              </label>
              <select
                value={formData.role}
                onChange={e => setFormData({ ...formData, role: e.target.value as Role })}
                className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-accent bg-white"
              >
                <option value={Role.ADMIN}>Quản trị viên (Toàn quyền)</option>
                <option value={Role.EMPLOYEE}>Nhân viên</option>
              </select>
            </div>

            {/* Công trình/Kho */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Building size={12} className="mr-1" /> Làm việc tại
              </label>
              <select
                value={formData.assignedWarehouseId || ''}
                onChange={e => setFormData({ ...formData, assignedWarehouseId: e.target.value })}
                className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-accent bg-white"
              >
                <option value="">Toàn hệ thống (Admin/General)</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 italic">
            (*) Admin có quyền xem/sửa toàn hệ thống. Nhân viên được phân quyền theo module và kho làm việc.
          </p>

          {/* Module Permissions */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
              <Shield size={12} className="mr-1" /> Phân quyền module
            </label>
            {formData.role === Role.ADMIN ? (
              <p className="text-[10px] text-emerald-600 font-bold bg-emerald-50 p-2 rounded-lg border border-emerald-100">✅ Admin được phép truy cập tất cả module</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {ALL_MODULES.map(mod => {
                  const ModIcon = mod.icon;
                  const isChecked = (formData.allowedModules || []).includes(mod.key);
                  return (
                    <label
                      key={mod.key}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${isChecked ? mod.color + ' shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const modules = formData.allowedModules || [];
                          if (e.target.checked) {
                            setFormData({ ...formData, allowedModules: [...modules, mod.key] });
                          } else {
                            setFormData({ ...formData, allowedModules: modules.filter(m => m !== mod.key) });
                          }
                        }}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                      <ModIcon size={14} />
                      <span className="text-xs font-bold">{mod.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* App Admin Permissions — only for non-ADMIN users */}
          {formData.role !== Role.ADMIN && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-amber-600 uppercase flex items-center">
                <Crown size={12} className="mr-1" /> Quản trị viên ứng dụng
              </label>
              <p className="text-[9px] text-slate-400 italic -mt-1">QTV ứng dụng có quyền chỉnh sửa toàn bộ dữ liệu trong module được chỉ định.</p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_MODULES.map(mod => {
                  const ModIcon = mod.icon;
                  const isChecked = (formData.adminModules || []).includes(mod.key);
                  const isModuleAllowed = (formData.allowedModules || []).includes(mod.key);
                  return (
                    <label
                      key={mod.key}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        !isModuleAllowed ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200' :
                        isChecked ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!isModuleAllowed}
                        onChange={(e) => {
                          const modules = formData.adminModules || [];
                          if (e.target.checked) {
                            setFormData({ ...formData, adminModules: [...modules, mod.key] });
                          } else {
                            setFormData({ ...formData, adminModules: modules.filter(m => m !== mod.key) });
                          }
                        }}
                        className="w-4 h-4 rounded accent-amber-600"
                      />
                      <Crown size={12} />
                      <ModIcon size={14} />
                      <span className="text-xs font-bold">QTV {mod.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-accent text-white rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center shadow-lg shadow-blue-500/30 disabled:opacity-50"
            >
              {saving ? (
                <><Loader2 size={18} className="mr-2 animate-spin" /> Đang lưu...</>
              ) : (
                <><Save size={18} className="mr-2" /> Lưu thông tin</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserModal;
