import React, { useEffect, useMemo, useState } from 'react';
import { Building, Briefcase, Loader2, Mail, Phone, Save, Shield, User as UserIcon, Users, X } from 'lucide-react';
import { Role, User, UserPermissionGrant, Warehouse } from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import AuthorizationEditor from './permissions/AuthorizationEditor';
import { listUserPermissionGrants, updateUserAuthorizationV2 } from '../lib/permissions/permissionAdminService';
import { getInheritedPermissionCodes } from '../lib/permissions/permissionService';
import { buildCreateUserFunctionPayload, readFunctionInvokeErrorMessage } from '../lib/userAccountCreation';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void | Promise<void>;
  onAuthorizationSaved: (userId: string) => void | Promise<void>;
  userToEdit?: User | null;
  warehouses: Warehouse[];
  users?: User[];
}

const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, onAuthorizationSaved, userToEdit, warehouses, users = [] }) => {
  const toast = useToast();
  const [formData, setFormData] = useState<Partial<User>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [permissionGrants, setPermissionGrants] = useState<UserPermissionGrant[]>([]);
  const [originalPermissionGrants, setOriginalPermissionGrants] = useState<UserPermissionGrant[]>([]);
  const [authorizationReason, setAuthorizationReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    const seedGrants = userToEdit?.permissionGrants || [];
    setPermissionGrants(seedGrants);
    setOriginalPermissionGrants(seedGrants);
    setAuthorizationReason('');

    if (isOpen && userToEdit?.id && isSupabaseConfigured) {
      listUserPermissionGrants(userToEdit.id)
        .then(grants => {
          if (cancelled) return;
          setPermissionGrants(grants);
          setOriginalPermissionGrants(grants);
        })
        .catch(error => console.warn('Unable to load direct permission grants:', error?.message || error));
    }

    setFormData(userToEdit ? {
      ...userToEdit,
      password: '',
      managerId: userToEdit.managerId || '',
      assignedWarehouseId: userToEdit.assignedWarehouseId || '',
    } : {
      name: '', email: '', username: '', password: '', phone: '', position: '',
      managerId: '', birthDate: '', role: Role.EMPLOYEE, assignedWarehouseId: '',
    });
    setErrors({});
    return () => { cancelled = true; };
  }, [isOpen, userToEdit]);

  const inheritedPermissionCodes = useMemo(
    () => getInheritedPermissionCodes(userToEdit || ({ role: Role.EMPLOYEE } as User)),
    [userToEdit],
  );
  const hasWmsAccess = formData.role === Role.ADMIN
    || formData.role === Role.WAREHOUSE_KEEPER
    || permissionGrants.some(grant => grant.isActive !== false && grant.permissionCode.startsWith('wms.'));

  if (!isOpen) return null;

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!formData.name?.trim()) nextErrors.name = 'Vui lòng nhập họ tên';
    if (!userToEdit && !formData.email?.trim()) nextErrors.email = 'Vui lòng nhập email';
    if (!userToEdit && !formData.username?.trim()) nextErrors.username = 'Vui lòng nhập tên đăng nhập';
    if (!userToEdit && !formData.password?.trim()) nextErrors.password = 'Vui lòng nhập mật khẩu';
    if (!userToEdit && formData.password && formData.password.length < 6) nextErrors.password = 'Mật khẩu phải có ít nhất 6 ký tự';
    if (userToEdit && !authorizationReason.trim()) nextErrors.authorizationReason = 'Vui lòng nhập lý do thay đổi';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);

    try {
      if (userToEdit) {
        if (!isSupabaseConfigured) {
          await onSave({
            ...userToEdit,
            name: formData.name || '',
            phone: formData.phone || '',
            avatar: formData.avatar,
            managerId: formData.managerId || undefined,
            assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
            permissionGrants,
          });
        } else {
          await updateUserAuthorizationV2({
            userId: userToEdit.id,
            profile: {
              name: formData.name || '',
              phone: formData.phone || null,
              avatar: formData.avatar || null,
              managerId: formData.managerId || null,
              assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || null : null,
            },
            grants: permissionGrants,
            reason: authorizationReason,
            expectedUpdatedAt: userToEdit.updatedAt || '',
          });
          await onAuthorizationSaved(userToEdit.id);
        }
        toast.success('Đã cập nhật tài khoản', 'Hồ sơ và direct grants đã được lưu trong một giao dịch.');
      } else {
        let createdAuthUserId: string | undefined;
        if (isSupabaseConfigured) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
          const response = await supabase.functions.invoke('create-user', {
            body: buildCreateUserFunctionPayload({
              email: formData.email || '',
              password: formData.password || '',
              profile: {
                name: formData.name || '',
                username: formData.username || '',
                phone: formData.phone || '',
                role: (formData.role || Role.EMPLOYEE) as Role,
                avatar: formData.avatar || `https://i.pravatar.cc/150?u=${formData.email}`,
                assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
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

        await onSave({
          id: createdAuthUserId || crypto.randomUUID(),
          authId: createdAuthUserId,
          name: formData.name || '',
          email: formData.email || '',
          username: formData.username || '',
          password: formData.password || '',
          phone: formData.phone || '',
          position: formData.position || undefined,
          managerId: formData.managerId || undefined,
          birthDate: formData.birthDate || undefined,
          role: (formData.role || Role.EMPLOYEE) as Role,
          avatar: formData.avatar || `https://i.pravatar.cc/150?u=${formData.email}`,
          assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
          permissionGrants: [],
        });
        toast.success('Đã thêm tài khoản hệ thống', 'Mở lại tài khoản để cấp direct grants theo phạm vi.');
      }
      onClose();
    } catch (error: any) {
      logApiError('userModal.saveUser', error);
      toast.error('Không thể lưu tài khoản', getApiErrorMessage(error, 'Không thể lưu tài khoản hệ thống.'));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-accent disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-800">{userToEdit ? 'Cập nhật người dùng & phân quyền' : 'Thêm tài khoản hệ thống'}</h2>
            <p className="text-xs text-slate-500">{userToEdit ? 'Một lần lưu cho hồ sơ và direct grants.' : 'Tạo danh tính trước, sau đó cấp quyền theo phạm vi.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20} /></button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><UserIcon size={12} className="mr-1" /> Họ tên</span>
              <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className={fieldClass} />
              {errors.name && <span className="text-[10px] font-bold text-red-500">{errors.name}</span>}
            </label>
            <label className="space-y-1">
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><Phone size={12} className="mr-1" /> Điện thoại</span>
              <input value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} className={fieldClass} />
            </label>
            <label className="space-y-1">
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><Mail size={12} className="mr-1" /> Email</span>
              <input type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={Boolean(userToEdit)} className={fieldClass} />
              {errors.email && <span className="text-[10px] font-bold text-red-500">{errors.email}</span>}
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold uppercase text-slate-500">Tên đăng nhập</span>
              <input value={formData.username || ''} onChange={e => setFormData({ ...formData, username: e.target.value })} disabled={Boolean(userToEdit)} className={fieldClass} />
              {errors.username && <span className="text-[10px] font-bold text-red-500">{errors.username}</span>}
            </label>
            {!userToEdit && <label className="space-y-1">
              <span className="text-xs font-bold uppercase text-slate-500">Mật khẩu ban đầu</span>
              <input type="password" value={formData.password || ''} onChange={e => setFormData({ ...formData, password: e.target.value })} className={fieldClass} />
              {errors.password && <span className="text-[10px] font-bold text-red-500">{errors.password}</span>}
            </label>}
            <label className="space-y-1">
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><Briefcase size={12} className="mr-1" /> Vai trò hệ thống</span>
              <select value={formData.role || Role.EMPLOYEE} onChange={e => setFormData({ ...formData, role: e.target.value as Role })} disabled={Boolean(userToEdit)} className={fieldClass}>
                <option value={Role.ADMIN}>Quản trị viên</option><option value={Role.WAREHOUSE_KEEPER}>Tài khoản kho</option><option value={Role.EMPLOYEE}>Tài khoản thường</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><Users size={12} className="mr-1" /> Quản lý trực tiếp</span>
              <select value={formData.managerId || ''} onChange={e => setFormData({ ...formData, managerId: e.target.value })} className={fieldClass}>
                <option value="">-- Chưa chỉ định --</option>
                {users.filter(candidate => candidate.id !== userToEdit?.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><Building size={12} className="mr-1" /> Kho phụ trách</span>
              <select value={formData.assignedWarehouseId || ''} onChange={e => setFormData({ ...formData, assignedWarehouseId: e.target.value })} disabled={!hasWmsAccess} className={fieldClass}>
                <option value="">Phòng vật tư — toàn bộ kho</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>
          </div>

          {userToEdit ? <AuthorizationEditor
            targetUser={userToEdit}
            directGrants={permissionGrants}
            originalDirectGrants={originalPermissionGrants}
            inheritedPermissionCodes={inheritedPermissionCodes}
            effectivePermissionSources={userToEdit.authorizationSnapshot?.sources || userToEdit.effectivePermissionSources}
            roomActions={userToEdit.authorizationSnapshot?.roomActions}
            reason={authorizationReason}
            disabled={saving}
            onDirectGrantsChange={setPermissionGrants}
            onReasonChange={setAuthorizationReason}
          /> : <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700"><Shield size={14} className="mr-1 inline" /> Direct grants được cấp sau khi tài khoản và hồ sơ Auth đã tạo thành công.</div>}
          {errors.authorizationReason && <p className="text-[10px] font-bold text-red-500">{errors.authorizationReason}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-slate-200 py-2.5 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Hủy</button>
            <button type="submit" disabled={saving} className="flex flex-1 items-center justify-center rounded-xl bg-accent py-2.5 font-bold text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 disabled:opacity-50">
              {saving ? <><Loader2 size={18} className="mr-2 animate-spin" /> Đang lưu...</> : <><Save size={18} className="mr-2" /> Lưu thông tin</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserModal;
