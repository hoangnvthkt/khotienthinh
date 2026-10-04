import React, { useEffect, useMemo, useState } from 'react';
import { Building, Briefcase, Loader2, Mail, Phone, Save, Shield, User as UserIcon, Users, X } from 'lucide-react';
import { AuthorizationSnapshot, Role, User, UserPermissionGrant, Warehouse } from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import AuthorizationEditor from './permissions/AuthorizationEditor';
import { changeUserAccountRoleV2, listUserPermissionGrants, loadUserAuthorizationSnapshot, updateUserAuthorizationV2 } from '../lib/permissions/permissionAdminService';
import { mapAuthorizationSnapshot } from '../context/authState';
import { getInheritedPermissionCodes } from '../lib/permissions/permissionService';
import { buildCreateUserFunctionPayload, readFunctionInvokeErrorMessage } from '../lib/userAccountCreation';
import { PermissionAdminCatalog } from '../lib/permissions/permissionTypes';
import { validateAuthorizationUpdate } from '../lib/permissions/authorizationUpdateValidation';
import { saveAuthorizationAndRefresh } from '../lib/permissions/authorizationSaveOutcome';
import { DEFAULT_AVATAR_URL } from '../lib/defaultAvatar';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void | Promise<void>;
  onAuthorizationSaved: (userId: string) => void | Promise<void>;
  userToEdit?: User | null;
  warehouses: Warehouse[];
  users?: User[];
  permissionApplicationCode?: string;
}

// The server records a reason with every change; profile-only edits get this one automatically.
const PROFILE_EDIT_REASON = 'Cập nhật hồ sơ người dùng';

const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, onAuthorizationSaved, userToEdit, warehouses, users = [], permissionApplicationCode }) => {
  const toast = useToast();
  const [formData, setFormData] = useState<Partial<User>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedUserId, setSavedUserId] = useState<string | null>(null);
  const [permissionGrants, setPermissionGrants] = useState<UserPermissionGrant[]>([]);
  const [originalPermissionGrants, setOriginalPermissionGrants] = useState<UserPermissionGrant[]>([]);
  const [authorizationReason, setAuthorizationReason] = useState('');
  const [authorizationCatalog, setAuthorizationCatalog] = useState<PermissionAdminCatalog | null>(null);
  // Permission snapshot of the person being edited (not the signed-in admin).
  const [targetSnapshot, setTargetSnapshot] = useState<AuthorizationSnapshot | null>(null);
  const [snapshotState, setSnapshotState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [snapshotReload, setSnapshotReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTargetSnapshot(null);
    if (!isOpen || !userToEdit?.id || !isSupabaseConfigured) {
      setSnapshotState(userToEdit?.authorizationSnapshot ? 'ready' : 'loading');
      return;
    }
    setSnapshotState('loading');
    loadUserAuthorizationSnapshot(userToEdit.id)
      .then(value => {
        if (cancelled) return;
        setTargetSnapshot(mapAuthorizationSnapshot(value));
        setSnapshotState('ready');
      })
      .catch(error => {
        if (cancelled) return;
        logApiError('userModal.loadAuthorizationSnapshot', error);
        setSnapshotState('error');
      });
    return () => { cancelled = true; };
  }, [isOpen, userToEdit?.id, snapshotReload]);

  useEffect(() => {
    setSavedUserId(null);
  }, [isOpen, userToEdit?.id]);

  useEffect(() => {
    let cancelled = false;
    const seedGrants = userToEdit?.permissionGrants || [];
    setPermissionGrants(seedGrants);
    setOriginalPermissionGrants(seedGrants);
    setAuthorizationReason('');
    setAuthorizationCatalog(null);

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

  const authorizationChanges = useMemo(() => {
    if (!userToEdit) return false;
    const normalizeValue = (value: unknown) => value == null ? '' : String(value).trim();
    const beforeProfile = [
      userToEdit.name,
      userToEdit.phone,
      userToEdit.avatar,
      userToEdit.managerId,
    ].map(normalizeValue);
    const afterProfile = [
      formData.name,
      formData.phone,
      formData.avatar,
      formData.managerId,
    ].map(normalizeValue);
    const grantKeys = (grants: readonly UserPermissionGrant[]) => grants
      .filter(grant => grant.isActive !== false)
      .map(grant => [
        grant.permissionCode,
        grant.scopeType || 'global',
        grant.scopeId || '*',
        grant.expiresAt || '',
      ].join('::'))
      .sort();
    const roleChanged = formData.role !== userToEdit.role;
    const warehouseChanged = formData.role === Role.WAREHOUSE_KEEPER
      && normalizeValue(formData.assignedWarehouseId || '*') !== normalizeValue(userToEdit.assignedWarehouseId || '*');
    const grantsChanged = JSON.stringify(grantKeys(originalPermissionGrants)) !== JSON.stringify(grantKeys(permissionGrants));
    return {
      accountRoleTransitionChanged: roleChanged || warehouseChanged,
      grantsChanged,
      otherAuthorizationChanged: JSON.stringify(beforeProfile) !== JSON.stringify(afterProfile) || grantsChanged,
    };
  }, [formData, originalPermissionGrants, permissionGrants, userToEdit]);
  const authorizationChanged = Boolean(userToEdit && (
    authorizationChanges && (
      authorizationChanges.accountRoleTransitionChanged || authorizationChanges.otherAuthorizationChanged
    )
  ));

  // A reason is needed only when permissions or the account type change, not for profile edits.
  const reasonRequired = Boolean(authorizationChanges
    && (authorizationChanges.accountRoleTransitionChanged || authorizationChanges.grantsChanged));

  const authorizationIssues = useMemo(() => authorizationCatalog && userToEdit
    ? validateAuthorizationUpdate({
      changed: authorizationChanged,
      reasonRequired,
      reason: authorizationReason,
      grants: permissionGrants,
      originalGrants: originalPermissionGrants,
      catalog: authorizationCatalog,
    })
    : [], [authorizationCatalog, authorizationChanged, reasonRequired, authorizationReason, originalPermissionGrants, permissionGrants, userToEdit]);

  if (!isOpen) return null;

  if (savedUserId) return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
      <div role="alert" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">Đã lưu tài khoản — chưa tải lại được quyền</h2>
        <p>Thay đổi đã được ghi nhận. Không cần lưu lại. Tải lại dữ liệu trước khi chỉnh sửa tiếp.</p>
        <div className="flex gap-3">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border px-4 py-2">Đóng</button>
          <button type="button" disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-white" onClick={async () => {
            setSaving(true);
            try {
              await onAuthorizationSaved(savedUserId);
              onClose();
            } catch {
              toast.error('Chưa tải lại được quyền', 'Tài khoản đã lưu. Kiểm tra kết nối rồi thử tải lại, không cần gửi lại thay đổi.');
            } finally {
              setSaving(false);
            }
          }}>{saving ? 'Đang tải...' : 'Tải lại dữ liệu'}</button>
        </div>
      </div>
    </div>
  );

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!formData.name?.trim()) nextErrors.name = 'Vui lòng nhập họ tên';
    if (!userToEdit && !formData.email?.trim()) nextErrors.email = 'Vui lòng nhập email';
    if (!userToEdit && !formData.username?.trim()) nextErrors.username = 'Vui lòng nhập tên đăng nhập';
    if (!userToEdit && !formData.password?.trim()) nextErrors.password = 'Vui lòng nhập mật khẩu';
    if (!userToEdit && formData.password && formData.password.length < 6) nextErrors.password = 'Mật khẩu phải có ít nhất 6 ký tự';
    if (userToEdit && !authorizationCatalog) nextErrors.authorizationCatalog = 'Danh mục phân quyền chưa sẵn sàng';
    const reasonIssue = authorizationIssues.find(issue => issue.field === 'reason');
    if (reasonIssue) nextErrors.authorizationReason = reasonIssue.message;
    const grantIssue = authorizationIssues.find(issue => issue.field !== 'reason');
    if (grantIssue) nextErrors.authorizationGrants = grantIssue.message;
    if (userToEdit && !authorizationChanged) nextErrors.authorizationChanged = 'Chưa có thay đổi để lưu';
    if (userToEdit && authorizationChanges
      && authorizationChanges.accountRoleTransitionChanged
      && authorizationChanges.otherAuthorizationChanged) {
      nextErrors.authorizationChanged = 'Hãy lưu thay đổi hồ sơ/quyền trước, sau đó đổi loại tài khoản trong một lần lưu riêng.';
    }
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
          if (authorizationChanges && authorizationChanges.accountRoleTransitionChanged) {
            const outcome = await saveAuthorizationAndRefresh(() => changeUserAccountRoleV2({
              userId: userToEdit.id,
              role: formData.role || Role.EMPLOYEE,
              warehouseId: formData.role === Role.WAREHOUSE_KEEPER
                ? formData.assignedWarehouseId || '*'
                : null,
              reason: authorizationReason,
              expectedUpdatedAt: userToEdit.updatedAt || '',
            }), async receipt => { await onAuthorizationSaved(receipt.userId); });
            if (outcome.status === 'saved_refresh_pending') {
              setSavedUserId(outcome.receipt.userId);
              return;
            }
            toast.success('Đã chuyển loại tài khoản', 'Vai trò và phạm vi kho đã được đồng bộ trong một giao dịch.');
            onClose();
            return;
          }
          const outcome = await saveAuthorizationAndRefresh(() => updateUserAuthorizationV2({
            userId: userToEdit.id,
            profile: {
              name: formData.name || '',
              phone: formData.phone || null,
              avatar: formData.avatar || null,
              managerId: formData.managerId || null,
              assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || null : null,
            },
            grants: permissionGrants,
            reason: authorizationReason.trim() || PROFILE_EDIT_REASON,
            expectedUpdatedAt: userToEdit.updatedAt || '',
          }), async receipt => { await onAuthorizationSaved(receipt.userId); });
          if (outcome.status === 'saved_refresh_pending') {
            setSavedUserId(outcome.receipt.userId);
            return;
          }
        }
        toast.success('Đã cập nhật tài khoản', 'Hồ sơ và quyền đã được lưu.');
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
                avatar: formData.avatar || DEFAULT_AVATAR_URL,
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
          avatar: formData.avatar || DEFAULT_AVATAR_URL,
          assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
          permissionGrants: [],
        });
        toast.success('Đã thêm tài khoản', 'Mở lại tài khoản để cấp quyền cho người này.');
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
            <p className="text-xs text-slate-500">{userToEdit ? 'Hồ sơ và quyền được lưu cùng lúc.' : 'Tạo tài khoản trước, sau đó mở lại để cấp quyền.'}</p>
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
              <span className="flex items-center text-xs font-bold uppercase text-slate-500"><Briefcase size={12} className="mr-1" /> Loại tài khoản</span>
              <select value={formData.role || Role.EMPLOYEE} onChange={e => setFormData({ ...formData, role: e.target.value as Role })} className={fieldClass}>
                <option value={Role.ADMIN}>Quản trị viên</option>
                {/* V1-2: thủ kho chọn ở Kho vật tư → Phân quyền kho; vai trò "Tài khoản kho" chỉ còn hiện cho tài khoản cũ. */}
                {(formData.role === Role.WAREHOUSE_KEEPER || userToEdit?.role === Role.WAREHOUSE_KEEPER) && <option value={Role.WAREHOUSE_KEEPER}>Tài khoản kho (cũ)</option>}
                <option value={Role.EMPLOYEE}>Tài khoản thường</option>
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
              <span className="block text-[10px] text-slate-400">Thủ kho chọn ở Kho vật tư → Phân quyền kho.</span>
              <select value={formData.role === Role.WAREHOUSE_KEEPER ? formData.assignedWarehouseId || '*' : ''} onChange={e => setFormData({ ...formData, assignedWarehouseId: e.target.value })} disabled={formData.role !== Role.WAREHOUSE_KEEPER} className={fieldClass}>
                <option value="*">Toàn bộ kho (phải chọn rõ)</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>
          </div>

          {userToEdit ? <AuthorizationEditor
            initialApplicationCode={permissionApplicationCode}
            targetUser={userToEdit}
            directGrants={permissionGrants}
            originalDirectGrants={originalPermissionGrants}
            inheritedPermissionCodes={inheritedPermissionCodes}
            effectivePermissionSources={(targetSnapshot || userToEdit.authorizationSnapshot)?.sources || userToEdit.effectivePermissionSources}
            roomActions={(targetSnapshot || userToEdit.authorizationSnapshot)?.roomActions}
            snapshotState={snapshotState}
            onRetrySnapshot={() => setSnapshotReload(value => value + 1)}
            reason={authorizationReason}
            reasonRequired={reasonRequired}
            validationIssues={authorizationIssues}
            disabled={saving}
            onCatalogChange={setAuthorizationCatalog}
            onDirectGrantsChange={setPermissionGrants}
            onReasonChange={setAuthorizationReason}
          /> : <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700"><Shield size={14} className="mr-1 inline" /> Quyền được cấp sau khi tạo xong tài khoản: lưu, rồi mở lại người này để cấp quyền.</div>}
          {errors.authorizationReason && <p className="text-[10px] font-bold text-red-500">{errors.authorizationReason}</p>}
          {errors.authorizationCatalog && <p className="text-[10px] font-bold text-red-500">{errors.authorizationCatalog}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-slate-200 py-2.5 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Hủy</button>
            <button type="submit" disabled={saving || Boolean(userToEdit && (!authorizationCatalog || !authorizationChanged || authorizationIssues.length > 0))} className="flex flex-1 items-center justify-center rounded-xl bg-accent py-2.5 font-bold text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 disabled:opacity-50">
              {saving ? <><Loader2 size={18} className="mr-2 animate-spin" /> Đang lưu...</> : <><Save size={18} className="mr-2" /> Lưu thông tin</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserModal;
