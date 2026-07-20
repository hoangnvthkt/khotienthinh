import React, { useEffect, useState } from 'react';
import { Building, Loader2, Mail, Phone, Save, Shield, User as UserIcon, X } from 'lucide-react';
import { Role, type User, type Warehouse } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import type { LegacyPermissionState } from '../lib/permissions/permissionTypes';
import { buildCreateUserFunctionPayload, readFunctionInvokeErrorMessage } from '../lib/userAccountCreation';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void | Promise<void>;
  userToEdit?: User | null;
  warehouses: Warehouse[];
}

const EMPTY_LEGACY_STATE: LegacyPermissionState = {
  allowedModules: [],
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
};

const cloneLegacyState = (state: LegacyPermissionState): LegacyPermissionState => ({
  allowedModules: [...state.allowedModules],
  allowedSubModules: Object.fromEntries(Object.entries(state.allowedSubModules).map(([key, routes]) => [key, [...routes]])),
  adminModules: [...state.adminModules],
  adminSubModules: Object.fromEntries(Object.entries(state.adminSubModules).map(([key, routes]) => [key, [...routes]])),
});

const toLegacyState = (profile?: Partial<User> | null): LegacyPermissionState => ({
  allowedModules: [...(profile?.allowedModules || [])],
  allowedSubModules: Object.fromEntries(Object.entries(profile?.allowedSubModules || {}).map(([key, routes]) => [key, [...routes]])),
  adminModules: [...(profile?.adminModules || [])],
  adminSubModules: Object.fromEntries(Object.entries(profile?.adminSubModules || {}).map(([key, routes]) => [key, [...routes]])),
});

const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  onSave,
  userToEdit,
  warehouses,
}) => {
  const toast = useToast();
  const [formData, setFormData] = useState<Partial<User>>({
    name: '', email: '', username: '', password: '', phone: '', role: Role.EMPLOYEE, assignedWarehouseId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [persistedLegacyState, setPersistedLegacyState] = useState<LegacyPermissionState>(cloneLegacyState(EMPTY_LEGACY_STATE));

  useEffect(() => {
    const seedLegacy = toLegacyState(userToEdit);
    setPersistedLegacyState(seedLegacy);
    setFormData(userToEdit
      ? { ...userToEdit, password: '' }
      : { name: '', email: '', username: '', password: '', phone: '', role: Role.EMPLOYEE, assignedWarehouseId: '' });
    setErrors({});
  }, [userToEdit]);

  const hasWmsAccess = formData.role === Role.ADMIN
    || formData.role === Role.WAREHOUSE_KEEPER
    || persistedLegacyState.allowedModules.includes('WMS');

  const validate = () => {
    const next: Record<string, string> = {};
    if (!formData.name?.trim()) next.name = 'Vui lòng nhập họ tên';
    if (!formData.email?.trim()) next.email = 'Vui lòng nhập email';
    if (!formData.username?.trim()) next.username = 'Vui lòng nhập tên đăng nhập';
    if (!userToEdit && !formData.password?.trim()) next.password = 'Vui lòng nhập mật khẩu';
    if (formData.password && formData.password.length < 6) next.password = 'Mật khẩu phải có ít nhất 6 ký tự';
    if (!formData.role) next.role = 'Vui lòng chọn chức vụ';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const hasPasswordChange = Boolean(formData.password?.trim());
      const hasEmailChange = Boolean(userToEdit && formData.email && formData.email !== userToEdit.email);
      let createdAuthUserId: string | undefined;

      if (!userToEdit && isSupabaseConfigured && hasPasswordChange) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
        const response = await supabase.functions.invoke('create-user', {
          body: buildCreateUserFunctionPayload({
            email: formData.email,
            password: formData.password,
            profile: {
              name: formData.name || '', username: formData.username || '', phone: formData.phone || '',
              role: formData.role as Role,
              avatar: formData.avatar || `https://i.pravatar.cc/150?u=${formData.email}`,
              assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
              ...EMPTY_LEGACY_STATE,
              isActive: true,
            },
          }),
        });
        if (response.error) {
          const message = await readFunctionInvokeErrorMessage(response.error);
          throw new Error(message || response.error.message || 'Lỗi gọi Edge Function create-user');
        }
        if (response.data?.error) throw new Error(response.data.error);
        createdAuthUserId = response.data?.profileId || response.data?.userId || response.data?.user?.id || response.data?.id;
      }

      if (userToEdit && (hasPasswordChange || hasEmailChange) && isSupabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
        const response = await supabase.functions.invoke('reset-password', { body: {
          email: userToEdit.email,
          newEmail: hasEmailChange ? formData.email : undefined,
          newPassword: hasPasswordChange ? formData.password : undefined,
          userId: userToEdit.id,
          authId: userToEdit.authId,
        } });
        if (response.error) throw new Error(response.error.message || 'Lỗi gọi Edge Function');
        if (response.data?.error) throw new Error(response.data.error);
      }

      const profileLegacy = userToEdit ? persistedLegacyState : EMPTY_LEGACY_STATE;
      const baseUser: User = {
        ...(userToEdit || {}),
        id: userToEdit?.id || createdAuthUserId || crypto.randomUUID(),
        authId: userToEdit?.authId || createdAuthUserId,
        name: formData.name || '', email: formData.email || '', username: formData.username || '',
        password: formData.password || userToEdit?.password || '', phone: formData.phone || '',
        role: formData.role as Role,
        avatar: formData.avatar || `https://i.pravatar.cc/150?u=${formData.email}`,
        assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
        ...cloneLegacyState(profileLegacy),
      };
      await onSave(baseUser);
      toast.success(userToEdit ? 'Đã cập nhật tài khoản hệ thống' : 'Đã thêm tài khoản hệ thống');
      onClose();
    } catch (error) {
      logApiError('userModal.saveUser', error);
      toast.error('Không thể lưu tài khoản', getApiErrorMessage(error, 'Không thể lưu tài khoản hệ thống.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-950">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{userToEdit ? 'Cập nhật tài khoản hệ thống' : 'Thêm tài khoản hệ thống'}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <form id="user-profile-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="flex items-center text-xs font-bold uppercase text-slate-500"><UserIcon size={12} className="mr-1" /> Họ và tên</label>
              <input value={formData.name || ''} onChange={event => setFormData({ ...formData, name: event.target.value })} className={`w-full rounded-lg border p-2.5 dark:bg-slate-900 dark:text-slate-100 ${errors.name ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'}`} />
              {errors.name && <p className="text-[10px] font-bold text-red-500">{errors.name}</p>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-xs font-bold uppercase text-slate-500"><span className="flex items-center"><Mail size={12} className="mr-1" /> Email</span><input type="email" value={formData.email || ''} onChange={event => setFormData({ ...formData, email: event.target.value })} className="w-full rounded-lg border border-slate-200 p-2.5 font-medium normal-case dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />{errors.email && <span className="block text-[10px] text-red-500">{errors.email}</span>}</label>
              <label className="space-y-1 text-xs font-bold uppercase text-slate-500"><span className="flex items-center"><Phone size={12} className="mr-1" /> Số điện thoại</span><input value={formData.phone || ''} onChange={event => setFormData({ ...formData, phone: event.target.value })} className="w-full rounded-lg border border-slate-200 p-2.5 font-medium normal-case dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /></label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-xs font-bold uppercase text-slate-500"><span className="flex items-center"><UserIcon size={12} className="mr-1" /> Tên đăng nhập</span><input value={formData.username || ''} onChange={event => setFormData({ ...formData, username: event.target.value })} className="w-full rounded-lg border border-slate-200 p-2.5 font-medium normal-case dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />{errors.username && <span className="block text-[10px] text-red-500">{errors.username}</span>}</label>
              <label className="space-y-1 text-xs font-bold uppercase text-slate-500"><span className="flex items-center"><Shield size={12} className="mr-1" /> {userToEdit ? 'Mật khẩu mới' : 'Mật khẩu'}</span><input type="password" value={formData.password || ''} onChange={event => setFormData({ ...formData, password: event.target.value })} className="w-full rounded-lg border border-slate-200 p-2.5 font-medium normal-case dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />{errors.password && <span className="block text-[10px] text-red-500">{errors.password}</span>}</label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-xs font-bold uppercase text-slate-500"><span>Vai trò hệ thống / kho</span><select value={formData.role} onChange={event => setFormData({ ...formData, role: event.target.value as Role })} className="w-full rounded-lg border border-slate-200 bg-white p-2.5 font-medium normal-case dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value={Role.ADMIN}>Quản trị viên</option><option value={Role.WAREHOUSE_KEEPER}>Tài khoản kho</option><option value={Role.EMPLOYEE}>Tài khoản thường</option></select></label>
              <label className="space-y-1 text-xs font-bold uppercase text-slate-500"><span className="flex items-center"><Building size={12} className="mr-1" /> Kho phụ trách</span><select value={formData.assignedWarehouseId || ''} disabled={!hasWmsAccess} onChange={event => setFormData({ ...formData, assignedWarehouseId: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white p-2.5 font-medium normal-case disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="">Phòng vật tư - toàn bộ kho</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
            </div>
          </form>

          <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"><button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-slate-200 py-2.5 font-bold text-slate-600">Hủy</button><button type="submit" form="user-profile-form" disabled={saving} className="flex flex-1 items-center justify-center rounded-xl bg-blue-600 py-2.5 font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Save size={18} className="mr-2" />} Lưu thông tin</button></div>
        </div>
      </div>
    </div>
  );
};

export default UserModal;
