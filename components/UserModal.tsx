import React, { useEffect, useMemo, useState } from 'react';
import { Building, Loader2, Mail, Phone, Save, Shield, User as UserIcon, X } from 'lucide-react';
import { Role, type User, type UserPermissionGrant, type Warehouse } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import PermissionChangeSummary from './permissions/PermissionChangeSummary';
import PermissionScopePicker from './permissions/PermissionScopePicker';
import SodWarningPanel from './permissions/SodWarningPanel';
import UnifiedPermissionMatrix from './permissions/UnifiedPermissionMatrix';
import {
  applyUserPermissionChange,
  listUserPermissionGrants,
  previewUserPermissionChange,
} from '../lib/permissions/permissionAdminService';
import { getAllPermissionActions } from '../lib/permissions/permissionRegistry';
import { authorizationGovernanceService } from '../lib/permissions/authorizationGovernanceService';
import type {
  AuthorizationPrincipal,
  EffectivePermissionSource,
  SodWarningAcceptanceInput,
  UnifiedPermissionPreview,
} from '../lib/permissions/authorizationGovernanceTypes';
import { validateDirectGrantDrafts, validateSodWarningAcceptances } from '../lib/permissions/authorizationGovernanceViewModel';
import { isIdentityBoundPermission } from '../lib/permissions/permissionRisk';
import type { LegacyPermissionState, PermissionScope } from '../lib/permissions/permissionTypes';
import {
  permissionScopeLookupService,
  type PermissionScopeLookupOptionsByType,
} from '../lib/permissions/permissionScopeLookupService';
import { buildUnifiedPermissionDraftKey } from '../lib/permissions/unifiedPermissionViewModel';
import { buildCreateUserFunctionPayload, readFunctionInvokeErrorMessage } from '../lib/userAccountCreation';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void | Promise<void>;
  onPermissionsSaved?: (userId: string) => Promise<User>;
  userToEdit?: User | null;
  warehouses: Warehouse[];
  users?: User[];
  currentUserId?: string;
  canManageDirectGrants?: boolean;
}

const EMPTY_LEGACY_STATE: LegacyPermissionState = {
  allowedModules: [],
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
};

const EMPTY_SCOPE_LOOKUP_OPTIONS: PermissionScopeLookupOptionsByType = {};

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

const toLocalDateTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const toIsoDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onPermissionsSaved,
  userToEdit,
  warehouses,
  users = [],
  currentUserId,
  canManageDirectGrants = false,
}) => {
  const toast = useToast();
  const [formData, setFormData] = useState<Partial<User>>({
    name: '', email: '', username: '', password: '', phone: '', role: Role.EMPLOYEE, assignedWarehouseId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [permissionGrants, setPermissionGrants] = useState<UserPermissionGrant[]>([]);
  const [originalPermissionGrants, setOriginalPermissionGrants] = useState<UserPermissionGrant[]>([]);
  const [effectiveSources, setEffectiveSources] = useState<EffectivePermissionSource[]>([]);
  const [persistedLegacyState, setPersistedLegacyState] = useState<LegacyPermissionState>(cloneLegacyState(EMPTY_LEGACY_STATE));
  const [legacyDraft, setLegacyDraft] = useState<LegacyPermissionState>(cloneLegacyState(EMPTY_LEGACY_STATE));
  const [permissionChangeReason, setPermissionChangeReason] = useState('');
  const [unifiedPreview, setUnifiedPreview] = useState<UnifiedPermissionPreview | null>(null);
  const [warningAcceptances, setWarningAcceptances] = useState<SodWarningAcceptanceInput[]>([]);
  const [previewedDraftKey, setPreviewedDraftKey] = useState<string | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [previewingPermissions, setPreviewingPermissions] = useState(false);
  const [permissionSourceLoadFailed, setPermissionSourceLoadFailed] = useState(false);
  const [permissionScope, setPermissionScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
  const [scopeLookupOptions, setScopeLookupOptions] = useState<PermissionScopeLookupOptionsByType>(EMPTY_SCOPE_LOOKUP_OPTIONS);

  const configurablePermissionActions = useMemo(
    () => getAllPermissionActions().filter(action => !isIdentityBoundPermission(action.permissionCode)),
    [],
  );
  const riskByPermissionCode = useMemo(
    () => new Map(configurablePermissionActions.map(action => [action.permissionCode, action.riskLevel || 'normal'] as const)),
    [configurablePermissionActions],
  );
  const controlOwners = useMemo<AuthorizationPrincipal[]>(() => users.map(candidate => ({
    userId: candidate.id,
    name: candidate.name,
    email: candidate.email,
    accountStatus: candidate.accountStatus === 'DISABLED' || candidate.isActive === false ? 'DISABLED' : 'ACTIVE',
  })), [users]);

  useEffect(() => {
    let cancelled = false;
    const seedLegacy = toLegacyState(userToEdit);
    const seedGrants = userToEdit?.permissionGrants || [];
    setPersistedLegacyState(seedLegacy);
    setLegacyDraft(cloneLegacyState(seedLegacy));
    setPermissionGrants(seedGrants);
    setOriginalPermissionGrants(seedGrants);
    setEffectiveSources(userToEdit?.effectivePermissions || []);
    setPermissionChangeReason('');
    setUnifiedPreview(null);
    setWarningAcceptances([]);
    setPreviewedDraftKey(null);
    setSavingPermissions(false);
    setPreviewingPermissions(false);
    setPermissionSourceLoadFailed(false);
    setPermissionScope({ scopeType: 'global', scopeId: '*' });
    setScopeLookupOptions(EMPTY_SCOPE_LOOKUP_OPTIONS);
    setFormData(userToEdit
      ? { ...userToEdit, password: '' }
      : { name: '', email: '', username: '', password: '', phone: '', role: Role.EMPLOYEE, assignedWarehouseId: '' });
    setErrors({});

    if (canManageDirectGrants && isOpen && isSupabaseConfigured) {
      permissionScopeLookupService.listLookupOptions().then(options => {
        if (!cancelled) setScopeLookupOptions(options);
      }).catch(error => {
        if (!cancelled) logApiError('userModal.loadScopeLookupOptions', error);
      });
    }

    if (canManageDirectGrants && isOpen && userToEdit?.id && isSupabaseConfigured) {
      Promise.all([
        listUserPermissionGrants(userToEdit.id),
        authorizationGovernanceService.listEffectivePermissionSources(userToEdit.id),
      ]).then(([grants, sources]) => {
        if (cancelled) return;
        setPermissionGrants(grants);
        setOriginalPermissionGrants(grants);
        setEffectiveSources(sources);
      }).catch(error => {
        if (cancelled) return;
        setPermissionSourceLoadFailed(true);
        logApiError('userModal.loadAuthorizationSources', error);
        toast.error('Không tải được nguồn quyền', getApiErrorMessage(error, 'Chức năng lưu phân quyền đã bị khóa để tránh dùng dữ liệu không đầy đủ.'));
      });
    }
    return () => { cancelled = true; };
  }, [canManageDirectGrants, isOpen, toast, userToEdit]);

  const hasWmsAccess = formData.role === Role.ADMIN
    || formData.role === Role.WAREHOUSE_KEEPER
    || legacyDraft.allowedModules.includes('WMS');
  const currentDraftKey = userToEdit?.id
    ? buildUnifiedPermissionDraftKey(userToEdit.id, legacyDraft, permissionGrants)
    : null;
  const previewMatches = Boolean(unifiedPreview && previewedDraftKey === currentDraftKey);
  const sensitiveDirectGrants = permissionGrants.filter(grant =>
    grant.isActive !== false && riskByPermissionCode.get(grant.permissionCode) === 'sensitive'
  );
  const warningAcceptanceErrors = unifiedPreview && previewMatches
    ? validateSodWarningAcceptances(unifiedPreview.decision, warningAcceptances, new Date())
    : [];

  const invalidatePreview = () => {
    setUnifiedPreview(null);
    setWarningAcceptances([]);
    setPreviewedDraftKey(null);
  };

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

  const handlePreviewPermissions = async () => {
    if (!userToEdit?.id || permissionSourceLoadFailed) {
      toast.warning('Chưa thể preview phân quyền', userToEdit?.id
        ? 'Nguồn quyền hiệu lực chưa được tải đầy đủ.'
        : 'Hãy tạo tài khoản trước, sau đó cấp quyền.');
      return;
    }
    setPreviewingPermissions(true);
    try {
      const preview = await previewUserPermissionChange(userToEdit.id, legacyDraft, permissionGrants);
      setUnifiedPreview(preview);
      setLegacyDraft(cloneLegacyState(preview.legacyAfter));
      setWarningAcceptances([]);
      setPreviewedDraftKey(buildUnifiedPermissionDraftKey(userToEdit.id, preview.legacyAfter, permissionGrants));
    } catch (error) {
      logApiError('userModal.previewPermissions', error);
      toast.error('Không thể preview phân quyền', getApiErrorMessage(error, 'Backend đã từ chối preview thay đổi phân quyền.'));
    } finally {
      setPreviewingPermissions(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!userToEdit?.id || !unifiedPreview || !previewMatches) {
      toast.warning('Chưa thể lưu phân quyền', userToEdit?.id
        ? 'Draft đã thay đổi; hãy preview lại toàn bộ phân quyền.'
        : 'Hãy tạo tài khoản trước, sau đó cấp quyền.');
      return;
    }
    const validationErrors = validateDirectGrantDrafts(
      originalPermissionGrants, permissionGrants, riskByPermissionCode, new Date(), permissionChangeReason,
    );
    if (validationErrors.length > 0) {
      toast.warning('Chưa thể lưu phân quyền', validationErrors[0]);
      return;
    }
    if (unifiedPreview.decision.hardDenies.length > 0) {
      toast.warning('Thay đổi bị từ chối', 'Thay đổi vi phạm quy tắc SoD bắt buộc.');
      return;
    }
    if (warningAcceptanceErrors.length > 0) {
      toast.warning('Thiếu kiểm soát SoD', warningAcceptanceErrors[0]);
      return;
    }

    setSavingPermissions(true);
    try {
      const result = await applyUserPermissionChange(
        userToEdit.id,
        unifiedPreview.beforeFingerprint,
        legacyDraft,
        permissionGrants,
        { reason: permissionChangeReason, warningAcceptances },
      );
      const refreshedUser = onPermissionsSaved ? await onPermissionsSaved(userToEdit.id) : null;
      const sources = await authorizationGovernanceService.listEffectivePermissionSources(userToEdit.id);
      const nextLegacy = refreshedUser ? toLegacyState(refreshedUser) : result.legacyAfter;
      setPersistedLegacyState(cloneLegacyState(nextLegacy));
      setLegacyDraft(cloneLegacyState(nextLegacy));
      setPermissionGrants(result.directAfter);
      setOriginalPermissionGrants(result.directAfter);
      setEffectiveSources(sources);
      setPermissionChangeReason('');
      invalidatePreview();
      toast.success('Đã lưu phân quyền', 'Nguồn quyền hiệu lực đã được tải lại từ backend.');
    } catch (error) {
      logApiError('userModal.savePermissions', error);
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      toast.error('Không thể lưu phân quyền', code === '40001'
        ? 'Dữ liệu quyền đã thay đổi; hãy tải lại và preview lại trước khi lưu.'
        : getApiErrorMessage(error, 'Backend đã từ chối thay đổi phân quyền.'));
    } finally {
      setSavingPermissions(false);
    }
  };

  if (!isOpen) return null;
  const permissionDisabled = !userToEdit || permissionSourceLoadFailed || savingPermissions;

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

          {canManageDirectGrants && (
            <section className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/30 p-4 dark:border-blue-900 dark:bg-blue-950/20">
              <div><h4 className="text-xs font-black uppercase text-blue-700 dark:text-blue-300">Ma trận phân quyền hợp nhất</h4><p className="mt-1 text-[10px] font-semibold text-slate-500">View là quyền vào khu vực; các tác vụ được cấp riêng. Badge cho biết Direct, Business Role hoặc Legacy.</p></div>
              {!userToEdit && <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">Hãy tạo tài khoản trước, sau đó cấp quyền.</div>}
              {permissionSourceLoadFailed && <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">Nguồn quyền hiệu lực chưa tải đủ; chức năng lưu đã bị khóa.</div>}
              {userToEdit?.id === currentUserId && <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">Bạn đang sửa quyền của chính mình. Backend sẽ từ chối self-grant làm tăng quyền.</div>}
              <PermissionScopePicker value={permissionScope} onChange={value => { setPermissionScope(value); invalidatePreview(); }} disabled={permissionDisabled} lookupOptions={scopeLookupOptions} />
              <UnifiedPermissionMatrix
                grants={permissionGrants}
                effectiveSources={effectiveSources}
                targetUserId={userToEdit?.id || ''}
                scope={permissionScope}
                legacyState={legacyDraft}
                disabled={permissionDisabled}
                onGrantsChange={next => { setPermissionGrants(next); invalidatePreview(); }}
                onLegacyStateChange={next => { setLegacyDraft(next); invalidatePreview(); }}
              />
              {sensitiveDirectGrants.length > 0 && <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50/60 p-3"><div className="text-[10px] font-black uppercase text-rose-700">Hạn bắt buộc cho quyền nhạy cảm</div>{sensitiveDirectGrants.map(grant => <label key={`${grant.permissionCode}-${grant.scopeType}-${grant.scopeId}`} className="grid items-center gap-2 text-[10px] font-bold text-slate-600 sm:grid-cols-[1fr_220px]"><span>{grant.permissionCode} · {grant.scopeType}/{grant.scopeId}</span><input type="datetime-local" value={toLocalDateTime(grant.expiresAt)} disabled={permissionDisabled} onChange={event => { setPermissionGrants(permissionGrants.map(candidate => candidate === grant ? { ...candidate, expiresAt: toIsoDateTime(event.target.value) } : candidate)); invalidatePreview(); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold" /></label>)}</div>}
              <textarea value={permissionChangeReason} onChange={event => setPermissionChangeReason(event.target.value)} disabled={permissionDisabled} rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" placeholder="Lý do thay đổi phân quyền (ít nhất 10 ký tự)" />
              {unifiedPreview && <PermissionChangeSummary beforeGrants={originalPermissionGrants} afterGrants={permissionGrants} beforeLegacy={unifiedPreview.legacyBefore} afterLegacy={legacyDraft} effectiveSources={effectiveSources} />}
              {unifiedPreview && previewMatches && unifiedPreview.decision.hardDenies.length > 0 && <div className="space-y-1 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">{unifiedPreview.decision.hardDenies.map(finding => <div key={`${finding.ruleCode}-${finding.scopeType}-${finding.scopeId}`}>{finding.message}</div>)}</div>}
              {unifiedPreview && previewMatches && <SodWarningPanel warnings={unifiedPreview.decision.warnings} acceptances={warningAcceptances} controlOwners={controlOwners} currentUserId={currentUserId} affectedPrincipalId={userToEdit?.id} disabled={permissionDisabled} onChange={setWarningAcceptances} />}
              <div className="flex justify-end gap-2"><button type="button" onClick={handlePreviewPermissions} disabled={permissionDisabled || previewingPermissions} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-xs font-black text-blue-700 disabled:opacity-50">{previewingPermissions ? 'Đang preview...' : 'Preview phân quyền'}</button><button type="button" onClick={handleSavePermissions} disabled={permissionDisabled || !previewMatches || Boolean(unifiedPreview?.decision.hardDenies.length) || warningAcceptanceErrors.length > 0} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{savingPermissions ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu phân quyền</button></div>
            </section>
          )}

          <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"><button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-slate-200 py-2.5 font-bold text-slate-600">Hủy</button><button type="submit" form="user-profile-form" disabled={saving} className="flex flex-1 items-center justify-center rounded-xl bg-blue-600 py-2.5 font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Save size={18} className="mr-2" />} Lưu thông tin</button></div>
        </div>
      </div>
    </div>
  );
};

export default UserModal;
