
import React, { useState, useEffect, useMemo } from 'react';
import { X, User as UserIcon, Mail, Phone, Shield, Building, Save, Package, Briefcase, GitBranch, BarChart3, Landmark, Loader2, Crown, Inbox, LayoutDashboard, MapPin, Users, Calendar, Clock, CalendarOff, DollarSign, FileSignature, FolderOpen, History, ArrowLeftRight, ClipboardCheck, FileSpreadsheet, FileText, Workflow, Layers, Repeat, Wrench, IdCard, CreditCard, Calculator, Bot, BrainCircuit, Copy, ClipboardPaste, Settings as SettingsIcon } from 'lucide-react';
import { Role, User, Warehouse } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { PROJECT_MATERIAL_TAB_PERMISSIONS, PROJECT_TAB_PERMISSIONS } from '../lib/projectTabPermissions';
import type { ProjectMaterialTabKey, ProjectOverviewTabKey } from '../lib/projectTabPermissions';
import { getSettingsFeatureToken, SETTINGS_FEATURES, SETTINGS_MODULE_KEY } from '../lib/settingsPermissions';

const PROJECT_TAB_PERMISSION_ICONS: Record<ProjectOverviewTabKey, any> = {
  executive: LayoutDashboard,
  org: Users,
  budget: DollarSign,
  cashflow: Repeat,
  contract: FileSignature,
  gantt: GitBranch,
  weekly_progress: Calendar,
  dailylog: ClipboardCheck,
  payment: CreditCard,
  quality: ClipboardCheck,
  safety: Shield,
  subcontract: Briefcase,
  material: Package,
  documents: FolderOpen,
  report: BarChart3,
};

const PROJECT_MATERIAL_TAB_PERMISSION_ICONS: Record<ProjectMaterialTabKey, any> = {
  summary: BarChart3,
  boq: FileSpreadsheet,
  planning: Clock,
  request: Package,
  po: FileSignature,
  waste: History,
  dashboard: LayoutDashboard,
};

const PROJECT_MATERIAL_TAB_SUB_MODULES = PROJECT_MATERIAL_TAB_PERMISSIONS.map(tab => ({
  to: tab.route,
  icon: PROJECT_MATERIAL_TAB_PERMISSION_ICONS[tab.key],
  label: `Vật tư: ${tab.label}`,
}));

const PROJECT_TAB_SUB_MODULES = PROJECT_TAB_PERMISSIONS.flatMap(tab => {
  const tabPermission = {
    to: tab.route,
    icon: PROJECT_TAB_PERMISSION_ICONS[tab.key],
    label: `Tab: ${tab.label}`,
  };
  return tab.key === 'material'
    ? [tabPermission, ...PROJECT_MATERIAL_TAB_SUB_MODULES]
    : [tabPermission];
});

const SETTINGS_FEATURE_ICONS: Record<(typeof SETTINGS_FEATURES)[number]['id'], any> = {
  general: SettingsIcon,
  warehouses: Building,
  'master-data': FileSpreadsheet,
  'g8-cost-norms': Calculator,
  'project-master-data': FolderOpen,
  'inspection-templates': ClipboardCheck,
  'work-groups': Users,
  'org-chart': GitBranch,
  'loss-norms': BarChart3,
  'hrm-master-data': Briefcase,
  users: Users,
  'chibi-bot': Bot,
  'ai-learning': BrainCircuit,
  maintenance: Wrench,
};

const SETTINGS_SUB_MODULES = SETTINGS_FEATURES.map(feature => ({
  to: getSettingsFeatureToken(feature.id),
  icon: SETTINGS_FEATURE_ICONS[feature.id],
  label: feature.label,
}));

// Sub-app definitions per module (matches Sidebar's moduleNavMap)
const SUB_MODULE_CONFIG: Record<string, { to: string; label: string; icon: any }[]> = {
  WMS: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/requests', icon: FileText, label: 'Đề xuất vật tư' },
    { to: '/material-code-requests', icon: ClipboardCheck, label: 'Đề xuất cấp mã' },
    { to: '/inventory', icon: Package, label: 'Kho & Vật tư' },
    { to: '/operations', icon: ArrowLeftRight, label: 'Nhập / Xuất' },
    { to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' },
    { to: '/reports', icon: History, label: 'Báo cáo WMS' },
    { to: '/misa-export', icon: FileSpreadsheet, label: 'Đồng bộ MISA' },
  ],
  HRM: [
    { to: '/hrm/dashboard', icon: LayoutDashboard, label: 'Dashboard NS' },
    { to: '/hrm/checkin', icon: MapPin, label: 'Check-in' },
    { to: '/hrm/employees', icon: Users, label: 'Hồ sơ nhân sự' },
    { to: '/hrm/attendance', icon: Calendar, label: 'Chấm công' },
    { to: '/hrm/shifts', icon: Clock, label: 'Ca làm việc' },
    { to: '/hrm/leave', icon: CalendarOff, label: 'Nghỉ phép' },
    { to: '/hrm/payroll', icon: DollarSign, label: 'Bảng lương' },
    { to: '/hrm/contracts', icon: FileSignature, label: 'Hợp đồng LĐ' },
    { to: '/hrm/documents', icon: FolderOpen, label: 'Hồ sơ & Công văn' },
    { to: '/hrm/reports', icon: BarChart3, label: 'Báo cáo NS' },
  ],
  WF: [
    { to: '/wf/dashboard', icon: LayoutDashboard, label: 'Dashboard QT' },
    { to: '/wf', icon: GitBranch, label: 'Quy trình' },
    { to: '/wf/templates', icon: Workflow, label: 'Mẫu quy trình' },
  ],
  DA: [
    { to: '/da', icon: BarChart3, label: 'Tổng quan DA' },
    { to: '/da/portfolio', icon: Layers, label: 'Đa dự án' },
    ...PROJECT_TAB_SUB_MODULES,
  ],
  TS: [
    { to: '/ts/dashboard', icon: LayoutDashboard, label: 'Dashboard TS' },
    { to: '/ts/catalog', icon: Landmark, label: 'Danh mục tài sản' },
    { to: '/ts/assignment', icon: Repeat, label: 'Cấp phát / Thu hồi' },
    { to: '/ts/maintenance', icon: Wrench, label: 'Bảo trì / Sửa chữa' },
    { to: '/ts/audit', icon: ClipboardCheck, label: 'Kiểm kê TS' },
    { to: '/ts/reports', icon: History, label: 'Báo cáo TS' },
  ],
  RQ: [
    { to: '/rq/dashboard', icon: BarChart3, label: 'Dashboard RQ' },
    { to: '/rq', icon: Inbox, label: 'Phiếu yêu cầu' },
    { to: '/rq/categories', icon: Shield, label: 'Danh mục yêu cầu' },
  ],
  EX: [
    { to: '/expense', icon: BarChart3, label: 'Kế hoạch chi phí' },
  ],
  EP: [
    { to: '/ep', icon: IdCard, label: 'Tra cứu nhân viên' },
  ],
  HD: [
    { to: '/hd/overview', icon: FileSignature, label: 'Tổng quan HĐ' },
    { to: '/hd/partners', icon: Users, label: 'Đối tác' },
    { to: '/hd/contract-types', icon: Shield, label: 'Loại HĐ & Mẫu' },
    { to: '/hd/catalogs', icon: FileSpreadsheet, label: 'Danh mục HĐ' },
    { to: '/hd/supplier', icon: FileSignature, label: 'HĐ Nhà cung cấp' },
    { to: '/hd/customer', icon: Users, label: 'HĐ Khách hàng' },
    { to: '/hd/subcontractor', icon: FileSignature, label: 'HĐ Thầu phụ' },
  ],
  TENDER_AI: [
    { to: '/tender-ai/boq', icon: FileSpreadsheet, label: 'AI BOQ CĐT' },
    { to: '/tender-ai/cost-library', icon: Calculator, label: 'Dự toán nội bộ' },
  ],
  [SETTINGS_MODULE_KEY]: SETTINGS_SUB_MODULES,
};

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void | Promise<void>;
  userToEdit?: User | null;
  warehouses: Warehouse[];
  users?: User[];
}

type UserPermissionClipboard = {
  version: 1;
  sourceUserId?: string;
  sourceUserName?: string;
  copiedAt: string;
  role: Role;
  assignedWarehouseId?: string;
  allowedModules: string[];
  allowedSubModules: Record<string, string[]>;
  adminModules: string[];
  adminSubModules: Record<string, string[]>;
};

const USER_PERMISSION_CLIPBOARD_KEY = 'vioo:user-permission-clipboard';

const cloneStringArray = (value?: string[]) => [...new Set((value || []).filter(Boolean))];

const cloneRouteMap = (value?: Record<string, string[]>) =>
  Object.entries(value || {}).reduce<Record<string, string[]>>((acc, [moduleKey, routes]) => {
    acc[moduleKey] = cloneStringArray(routes);
    return acc;
  }, {});

const readPermissionClipboard = (): UserPermissionClipboard | null => {
  try {
    const raw = window.localStorage.getItem(USER_PERMISSION_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserPermissionClipboard;
    if (parsed?.version !== 1 || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
};

const countRoutePermissions = (value?: Record<string, string[]>) =>
  Object.values(value || {}).reduce((sum, routes) => sum + routes.length, 0);

const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, userToEdit, warehouses, users = [] }) => {
  const toast = useToast();
  const ALL_MODULES = [
    { key: 'WMS', label: 'KHO - Vật tư', icon: Package, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700' },
    { key: 'HRM', label: 'NS - Nhân sự', icon: Briefcase, color: 'text-teal-600 bg-teal-50 border-teal-200 dark:bg-teal-900/30 dark:border-teal-700' },
    { key: 'WF', label: 'QT - Quy trình', icon: GitBranch, color: 'text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-900/30 dark:border-violet-700' },
    { key: 'DA', label: 'DA - Dự án', icon: BarChart3, color: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-700' },
    { key: 'TS', label: 'TS - Tài sản', icon: Landmark, color: 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-900/30 dark:border-rose-700' },
    { key: 'RQ', label: 'RQ - Yêu cầu', icon: Inbox, color: 'text-cyan-600 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/30 dark:border-cyan-700' },
    { key: 'EX', label: 'CP - Chi phí', icon: BarChart3, color: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-700' },
    { key: 'EP', label: 'EP - Hồ sơ NV', icon: IdCard, color: 'text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-900/30 dark:border-sky-700' },
    { key: 'HD', label: 'HĐ - Hợp đồng', icon: FileSignature, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-700' },
    { key: 'TENDER_AI', label: 'Tender AI', icon: Bot, color: 'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200 dark:bg-fuchsia-900/30 dark:border-fuchsia-700' },
    { key: SETTINGS_MODULE_KEY, label: 'CĐ - Cài đặt', icon: SettingsIcon, color: 'text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-800/50 dark:border-slate-700' },
    { key: 'CHIBIBOT', label: 'Trợ lý ChibiBot', icon: Bot, color: 'text-pink-600 bg-pink-50 border-pink-200 dark:bg-pink-900/30 dark:border-pink-700' },
  ];
  const DEFAULT_ALLOWED_MODULES = ALL_MODULES
    .filter(mod => mod.key !== SETTINGS_MODULE_KEY)
    .map(mod => mod.key);
  const getLegacyAllowedModules = (profile?: Partial<User> | null) =>
    profile?.role === Role.ADMIN ? ALL_MODULES.map(m => m.key) : DEFAULT_ALLOWED_MODULES;

  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    email: '',
    username: '',
    password: '',
    phone: '',
    role: Role.EMPLOYEE,
    assignedWarehouseId: '',
    allowedModules: [],
    allowedSubModules: {},
    adminModules: [],
    adminSubModules: {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [permissionClipboard, setPermissionClipboard] = useState<UserPermissionClipboard | null>(null);
  const [selectedPermissionSourceUserId, setSelectedPermissionSourceUserId] = useState('');

  useEffect(() => {
    if (userToEdit) {
      setFormData({ ...userToEdit, password: '', allowedModules: userToEdit.allowedModules || getLegacyAllowedModules(userToEdit), allowedSubModules: userToEdit.allowedSubModules || {}, adminModules: userToEdit.adminModules || [], adminSubModules: userToEdit.adminSubModules || {} });
    } else {
      setFormData({
        name: '',
        email: '',
        username: '',
        password: '',
        phone: '',
        role: Role.EMPLOYEE,
        assignedWarehouseId: '',
        allowedModules: [],
        allowedSubModules: {},
        adminModules: [],
        adminSubModules: {},
      });
    }
    setErrors({});
    setPermissionClipboard(readPermissionClipboard());
    setSelectedPermissionSourceUserId('');
  }, [userToEdit, isOpen]);

  const hasWmsAccess = formData.role === Role.ADMIN || formData.role === Role.WAREHOUSE_KEEPER || (formData.allowedModules || []).includes('WMS');
  const permissionSourceUsers = useMemo(
    () => [...users].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'vi')),
    [users]
  );
  const selectedPermissionSourceUser = permissionSourceUsers.find(u => u.id === selectedPermissionSourceUserId);
  const permissionClipboardSummary = permissionClipboard
    ? permissionClipboard.role === Role.ADMIN
      ? 'Admin toàn quyền'
      : `${permissionClipboard.allowedModules.length} module sử dụng, ${permissionClipboard.adminModules.length + countRoutePermissions(permissionClipboard.adminSubModules)} quyền quản trị`
    : '';

  const buildPermissionClipboard = (source: Partial<User>, sourceName?: string, sourceId?: string): UserPermissionClipboard => ({
    version: 1,
    sourceUserId: sourceId,
    sourceUserName: sourceName,
    copiedAt: new Date().toISOString(),
    role: (source.role || Role.EMPLOYEE) as Role,
    assignedWarehouseId: source.assignedWarehouseId || undefined,
    allowedModules: cloneStringArray(source.allowedModules),
    allowedSubModules: cloneRouteMap(source.allowedSubModules),
    adminModules: cloneStringArray(source.adminModules),
    adminSubModules: cloneRouteMap(source.adminSubModules),
  });

  const savePermissionClipboard = (payload: UserPermissionClipboard) => {
    try {
      window.localStorage.setItem(USER_PERMISSION_CLIPBOARD_KEY, JSON.stringify(payload));
    } catch {
      toast.error('Không thể sao chép quyền', 'Trình duyệt đang chặn bộ nhớ cục bộ. Vui lòng thử lại hoặc kiểm tra cài đặt trình duyệt.');
      return;
    }
    setPermissionClipboard(payload);
    if (payload.role === Role.ADMIN) {
      toast.warning('Đã sao chép bộ quyền Admin', 'Khi dán bộ quyền này, tài khoản đích sẽ trở thành Admin toàn quyền.');
    } else {
      toast.success('Đã sao chép quyền', `Nguồn: ${payload.sourceUserName || 'Tài khoản đang mở'}.`);
    }
  };

  const copyCurrentPermissions = () => {
    const payload = buildPermissionClipboard(formData, formData.name || userToEdit?.name || 'Tài khoản đang mở', userToEdit?.id);
    savePermissionClipboard(payload);
  };

  const copySelectedSourcePermissions = () => {
    if (!selectedPermissionSourceUser) {
      toast.warning('Chưa chọn tài khoản mẫu', 'Vui lòng chọn tài khoản nguồn để sao chép quyền.');
      return;
    }
    const sourceWithLegacyDefaults: Partial<User> = {
      ...selectedPermissionSourceUser,
      allowedModules: selectedPermissionSourceUser.role === Role.ADMIN
        ? ALL_MODULES.map(m => m.key)
        : selectedPermissionSourceUser.allowedModules || getLegacyAllowedModules(selectedPermissionSourceUser),
      allowedSubModules: selectedPermissionSourceUser.allowedSubModules || {},
      adminModules: selectedPermissionSourceUser.adminModules || [],
      adminSubModules: selectedPermissionSourceUser.adminSubModules || {},
    };
    savePermissionClipboard(buildPermissionClipboard(sourceWithLegacyDefaults, selectedPermissionSourceUser.name || selectedPermissionSourceUser.email, selectedPermissionSourceUser.id));
  };

  const pastePermissionClipboard = () => {
    const payload = permissionClipboard || readPermissionClipboard();
    if (!payload) {
      toast.warning('Chưa có quyền đã sao chép', 'Hãy sao chép quyền từ tài khoản mẫu trước khi dán.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      role: payload.role,
      assignedWarehouseId: payload.assignedWarehouseId || '',
      allowedModules: payload.role === Role.ADMIN ? ALL_MODULES.map(m => m.key) : cloneStringArray(payload.allowedModules),
      allowedSubModules: payload.role === Role.ADMIN ? {} : cloneRouteMap(payload.allowedSubModules),
      adminModules: payload.role === Role.ADMIN ? [] : cloneStringArray(payload.adminModules),
      adminSubModules: payload.role === Role.ADMIN ? {} : cloneRouteMap(payload.adminSubModules),
    }));
    setPermissionClipboard(payload);
    if (payload.role === Role.ADMIN) {
      toast.warning('Đã dán bộ quyền Admin', 'Tài khoản này sẽ được lưu với quyền Admin toàn quyền.');
    } else {
      toast.success('Đã dán quyền', `Đã áp dụng quyền từ ${payload.sourceUserName || 'clipboard quyền'}.`);
    }
  };

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

    try {
      const hasPasswordChange = formData.password && formData.password.trim().length > 0;
      const hasEmailChange = Boolean(userToEdit && formData.email && formData.email !== userToEdit.email);
      let createdAuthUserId: string | undefined;

      // === NEW USER: Create Supabase Auth account first ===
      if (!userToEdit && isSupabaseConfigured && hasPasswordChange) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');

          const response = await supabase.functions.invoke('create-user', {
            body: {
              email: formData.email,
              password: formData.password,
            },
          });

          if (response.error) {
            throw new Error(response.error.message || 'Lỗi gọi Edge Function create-user');
          }

          const result = response.data;
          if (result.error) {
            throw new Error(result.error);
          }
          createdAuthUserId = result.userId || result.user?.id || result.id;
        } catch (authErr: any) {
          setSaving(false);
          logApiError('userModal.createAuthUser', authErr);
          toast.error('Tạo tài khoản đăng nhập thất bại', getApiErrorMessage(authErr, 'Không thể tạo tài khoản Auth trên Supabase.'));
          return; // Don't save user if Auth creation failed
        }
      }

      // === EDIT USER: Update Auth email/password when profile credentials change ===
      if (userToEdit && (hasPasswordChange || hasEmailChange) && isSupabaseConfigured) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');

          const response = await supabase.functions.invoke('reset-password', {
            body: {
              email: userToEdit.email,
              newEmail: hasEmailChange ? formData.email : undefined,
              newPassword: hasPasswordChange ? formData.password : undefined,
              userId: userToEdit.id,
              authId: userToEdit.authId,
            },
          });

          if (response.error) {
            throw new Error(response.error.message || 'Lỗi gọi Edge Function');
          }

          const result = response.data;
          if (result.error) {
            throw new Error(result.error);
          }
        } catch (pwErr: any) {
          setSaving(false);
          logApiError('userModal.resetPassword', pwErr);
          toast.error('Không thể cập nhật thông tin đăng nhập', getApiErrorMessage(pwErr, 'Không thể đổi email hoặc mật khẩu trên Supabase Auth.'));
          return; // Don't save user if password change failed
        }
      }

      const finalUser: User = {
        id: userToEdit?.id || createdAuthUserId || crypto.randomUUID(),
        authId: userToEdit?.authId || createdAuthUserId,
        name: formData.name || '',
        email: formData.email || '',
        username: formData.username || '',
        password: formData.password || userToEdit?.password || '',
        phone: formData.phone || '',
        role: formData.role as Role,
        avatar: formData.avatar || `https://i.pravatar.cc/150?u=${formData.email}`,
        assignedWarehouseId: hasWmsAccess ? formData.assignedWarehouseId || undefined : undefined,
        allowedModules: formData.role === Role.ADMIN ? ALL_MODULES.map(m => m.key) : (formData.allowedModules || []),
        allowedSubModules: formData.role === Role.ADMIN ? {} : (formData.allowedSubModules || {}),
        adminModules: formData.role === Role.ADMIN ? [] : (formData.adminModules || []),
        adminSubModules: formData.role === Role.ADMIN ? {} : (formData.adminSubModules || {}),
      };

      await onSave(finalUser);

      if (!userToEdit) {
        toast.success('Đã thêm tài khoản hệ thống', 'Tài khoản đăng nhập đã được tạo tự động.');
      } else if (hasPasswordChange) {
        toast.success('Đã cập nhật tài khoản', 'Mật khẩu mới đã cập nhật trên Supabase Auth.');
      } else {
        toast.success('Đã cập nhật tài khoản hệ thống');
      }
      onClose();
    } catch (err: any) {
      logApiError('userModal.saveUser', err);
      toast.error('Không thể lưu tài khoản', getApiErrorMessage(err, 'Không thể lưu tài khoản hệ thống.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-300 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <h3 className="font-bold text-lg text-slate-800">
            {userToEdit ? 'Cập nhật tài khoản hệ thống' : 'Thêm tài khoản hệ thống'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>
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
                placeholder="example@vioo.vn"
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
            {/* System / warehouse role */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Shield size={12} className="mr-1" /> Vai trò hệ thống / kho
              </label>
              <select
                value={formData.role}
                onChange={e => {
                  const nextRole = e.target.value as Role;
                  const nextModules = new Set(formData.allowedModules || []);
                  if (nextRole === Role.WAREHOUSE_KEEPER) nextModules.add('WMS');
                  setFormData({
                    ...formData,
                    role: nextRole,
                    allowedModules: Array.from(nextModules),
                    assignedWarehouseId: nextRole === Role.WAREHOUSE_KEEPER ? formData.assignedWarehouseId : formData.assignedWarehouseId,
                  });
                }}
                className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-accent bg-white"
              >
                <option value={Role.ADMIN}>Quản trị viên (Toàn quyền)</option>
                <option value={Role.WAREHOUSE_KEEPER}>Tài khoản kho - Thủ kho / Phòng vật tư</option>
                <option value={Role.EMPLOYEE}>Tài khoản thường</option>
              </select>
            </div>

            {/* Optional warehouse scope */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                <Building size={12} className="mr-1" /> Kho phụ trách (nếu có)
              </label>
              <select
                value={formData.assignedWarehouseId || ''}
                onChange={e => setFormData({ ...formData, assignedWarehouseId: e.target.value })}
                disabled={!hasWmsAccess}
                className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-accent bg-white"
              >
                <option value="">Phòng vật tư - toàn bộ kho</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {!hasWmsAccess && <p className="text-[10px] text-slate-400 font-medium">Chỉ gán kho khi tài khoản được cấp module WMS.</p>}
              {hasWmsAccess && formData.role === Role.WAREHOUSE_KEEPER && !formData.assignedWarehouseId && (
                <p className="text-[10px] text-emerald-600 font-bold">Tài khoản này là phòng vật tư/thủ kho tổng, được xử lý phiếu và kho trên toàn hệ thống WMS.</p>
              )}
              {errors.assignedWarehouseId && <p className="text-[10px] text-red-500 font-bold">{errors.assignedWarehouseId}</p>}
            </div>
          </div>

          <p className="text-[10px] text-slate-400 italic">
            (*) Tài khoản hệ thống dùng để đăng nhập phần mềm. Hồ sơ HRM được tạo riêng trong module Nhân sự và có thể liên kết với tài khoản này.
          </p>

          {/* Permission copy / paste */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3 space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-blue-700">
                  <ClipboardPaste size={13} /> Sao chép / dán quyền
                </div>
                <p className="mt-1 text-[10px] font-medium leading-relaxed text-slate-500">
                  Sao chép vai trò, kho phụ trách, quyền sử dụng module/sub-module và quyền quản trị. Không sao chép họ tên, email, mật khẩu, chữ ký.
                </p>
              </div>
              {permissionClipboard && (
                <div className="shrink-0 rounded-xl border border-blue-100 bg-white px-3 py-2 text-right">
                  <div className="text-[9px] font-black uppercase text-slate-400">Đã chép</div>
                  <div className="max-w-[180px] truncate text-[11px] font-black text-slate-700">
                    {permissionClipboard.sourceUserName || 'Tài khoản đang mở'}
                  </div>
                  <div className="text-[9px] font-bold text-blue-600">{permissionClipboardSummary}</div>
                </div>
              )}
            </div>

            {permissionSourceUsers.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={selectedPermissionSourceUserId}
                  onChange={e => setSelectedPermissionSourceUserId(e.target.value)}
                  className="w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">Chọn tài khoản mẫu để sao chép quyền...</option>
                  {permissionSourceUsers.map(sourceUser => (
                    <option key={sourceUser.id} value={sourceUser.id}>
                      {sourceUser.name || sourceUser.email} - {sourceUser.email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={copySelectedSourcePermissions}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"
                >
                  <Copy size={14} /> Sao chép quyền
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={copyCurrentPermissions}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50"
              >
                <Copy size={14} /> Chép quyền đang khai báo
              </button>
              <button
                type="button"
                onClick={pastePermissionClipboard}
                disabled={!permissionClipboard}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ClipboardPaste size={14} /> Dán quyền đã chép
              </button>
            </div>
          </div>

          {/* Module Permissions */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
              <Shield size={12} className="mr-1" /> Phân quyền module
            </label>
            {formData.role === Role.ADMIN ? (
              <p className="text-[10px] text-emerald-600 font-bold bg-emerald-50 p-2 rounded-lg border border-emerald-100">✅ Admin được phép truy cập tất cả module</p>
            ) : (
              <div className="space-y-2">
                {ALL_MODULES.map(mod => {
                  const ModIcon = mod.icon;
                  const isChecked = (formData.allowedModules || []).includes(mod.key);
                  const subApps = SUB_MODULE_CONFIG[mod.key] || [];
                  const hasSubModuleRestriction = Object.prototype.hasOwnProperty.call(formData.allowedSubModules || {}, mod.key);
                  const currentSubModules = hasSubModuleRestriction ? (formData.allowedSubModules?.[mod.key] || []) : [];
                  const allSubRoutes = subApps.map(s => s.to);
                  const isAllSubSelected = !hasSubModuleRestriction || currentSubModules.length === allSubRoutes.length;
                  const hasPartialSub = isChecked && hasSubModuleRestriction && currentSubModules.length > 0 && currentSubModules.length < allSubRoutes.length;
                  return (
                    <div key={mod.key}>
                      <label
                        className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${isChecked ? mod.color + ' shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const modules = formData.allowedModules || [];
                            const subMods = { ...(formData.allowedSubModules || {}) };
                            const adminSubs = { ...(formData.adminSubModules || {}) };
                            const oldAdminModules = formData.adminModules || [];
                            if (e.target.checked) {
                              setFormData({ ...formData, allowedModules: [...modules, mod.key], allowedSubModules: subMods });
                            } else {
                              delete subMods[mod.key];
                              delete adminSubs[mod.key];
                              const nextModules = modules.filter(m => m !== mod.key);
                              setFormData({
                                ...formData,
                                role: mod.key === 'WMS' && formData.role === Role.WAREHOUSE_KEEPER ? Role.EMPLOYEE : formData.role,
                                assignedWarehouseId: mod.key === 'WMS' ? undefined : formData.assignedWarehouseId,
                                allowedModules: nextModules,
                                allowedSubModules: subMods,
                                adminModules: oldAdminModules.filter(m => m !== mod.key),
                                adminSubModules: adminSubs,
                              });
                            }
                          }}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                        <ModIcon size={14} />
                        <span className="text-xs font-bold flex-1">{mod.label}</span>
                        {isChecked && subApps.length > 1 && (
                          <span className="text-[9px] font-bold text-slate-400">
                            {hasPartialSub ? `${currentSubModules.length}/${allSubRoutes.length}` : isAllSubSelected ? 'Tất cả' : 'Không'}
                          </span>
                        )}
                      </label>
                      {/* Sub-app checkboxes */}
                      {isChecked && subApps.length > 1 && (
                        <div className="ml-6 mt-1 mb-1 space-y-0.5 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
                          {/* Select All toggle */}
                          <label className="flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                            <input
                              type="checkbox"
                              checked={isAllSubSelected}
                              onChange={(e) => {
                                const subMods = { ...(formData.allowedSubModules || {}) };
                                const adminSubs = { ...(formData.adminSubModules || {}) };
                                const oldAdminModules = formData.adminModules || [];
                                if (e.target.checked) {
                                  delete subMods[mod.key]; // empty = all allowed
                                } else {
                                  subMods[mod.key] = []; // empty array = none selected
                                  delete adminSubs[mod.key];
                                }
                                setFormData({
                                  ...formData,
                                  allowedSubModules: subMods,
                                  adminModules: oldAdminModules.filter(m => m !== mod.key),
                                  adminSubModules: adminSubs,
                                });
                              }}
                              className="w-3.5 h-3.5 rounded accent-blue-600"
                            />
                            <span className="text-[10px] font-bold text-slate-500 italic">Chọn tất cả</span>
                          </label>
                          {subApps.map(sub => {
                            const SubIcon = sub.icon;
                            const isSubChecked = !hasSubModuleRestriction || currentSubModules.includes(sub.to);
                            return (
                              <label key={sub.to} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition ${isSubChecked ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
                                <input
                                  type="checkbox"
                                  checked={isSubChecked}
                                  onChange={(e) => {
                                    const subMods = { ...(formData.allowedSubModules || {}) };
                                    const adminSubs = { ...(formData.adminSubModules || {}) };
                                    const oldAdminModules = formData.adminModules || [];
                                    let list = Object.prototype.hasOwnProperty.call(subMods, mod.key) ? [...(subMods[mod.key] || [])] : [...allSubRoutes];
                                    if (e.target.checked) {
                                      if (!list.includes(sub.to)) list.push(sub.to);
                                    } else {
                                      list = list.filter(r => r !== sub.to);
                                      if (oldAdminModules.includes(mod.key)) {
                                        adminSubs[mod.key] = allSubRoutes.filter(r => r !== sub.to);
                                      } else {
                                        const nextAdminList = (adminSubs[mod.key] || []).filter(r => r !== sub.to);
                                        if (nextAdminList.length === 0) delete adminSubs[mod.key];
                                        else adminSubs[mod.key] = nextAdminList;
                                      }
                                    }
                                    // If all selected, remove key (= allow all)
                                    if (list.length === allSubRoutes.length) {
                                      delete subMods[mod.key];
                                    } else {
                                      subMods[mod.key] = list;
                                    }
                                    setFormData({
                                      ...formData,
                                      allowedSubModules: subMods,
                                      adminModules: oldAdminModules.filter(m => m !== mod.key),
                                      adminSubModules: adminSubs,
                                    });
                                  }}
                                  className="w-3.5 h-3.5 rounded accent-blue-600"
                                />
                                <SubIcon size={12} />
                                <span className="text-[10px] font-bold">{sub.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* App Admin Permissions — sub-module level */}
          {formData.role !== Role.ADMIN && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-amber-600 uppercase flex items-center">
                <Crown size={12} className="mr-1" /> Quản trị Sub-module
              </label>
              <p className="text-[9px] text-slate-400 italic -mt-1">Chọn sub-module mà nhân viên có quyền Thêm / Sửa / Xoá dữ liệu. Các sub-module không được chọn → chỉ XEM.</p>
              <div className="space-y-1.5">
                {ALL_MODULES.map(mod => {
                  const ModIcon = mod.icon;
                  const isModuleAllowed = (formData.allowedModules || []).includes(mod.key);
                  if (!isModuleAllowed) return null;
                  const subApps = SUB_MODULE_CONFIG[mod.key] || [];
                  if (subApps.length === 0) return null;
                  const currentAdminSubs = formData.adminSubModules?.[mod.key] || [];
                  const allSubRoutes = subApps.map(s => s.to);
                  const isAllAdminSelected = currentAdminSubs.length === allSubRoutes.length;
                  const hasPartialAdmin = currentAdminSubs.length > 0 && currentAdminSubs.length < allSubRoutes.length;
                  // Also check old adminModules for backward compat display
                  const isOldModuleAdmin = (formData.adminModules || []).includes(mod.key);
                  return (
                    <div key={mod.key} className="rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden">
                      <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20">
                        <Crown size={12} className="text-amber-500" />
                        <ModIcon size={14} className="text-amber-600" />
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-400 flex-1">{mod.label}</span>
                        {/* Select All toggle */}
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <span className="text-[9px] font-bold text-amber-500">
                            {isOldModuleAdmin || isAllAdminSelected ? 'Tất cả' : hasPartialAdmin ? `${currentAdminSubs.length}/${allSubRoutes.length}` : 'Không'}
                          </span>
                          <input
                            type="checkbox"
                            checked={isOldModuleAdmin || isAllAdminSelected}
                            onChange={(e) => {
                              const adminSubs = { ...(formData.adminSubModules || {}) };
                              const oldMods = formData.adminModules || [];
                              if (e.target.checked) {
                                adminSubs[mod.key] = [...allSubRoutes];
                              } else {
                                delete adminSubs[mod.key];
                              }
                              setFormData({ ...formData, adminSubModules: adminSubs, adminModules: oldMods.filter(m => m !== mod.key) });
                            }}
                            className="w-3.5 h-3.5 rounded accent-amber-600"
                          />
                        </label>
                      </div>
                      <div className="p-2 space-y-0.5 bg-white dark:bg-slate-900">
                        {subApps.map(sub => {
                          const SubIcon = sub.icon;
                          const isSubAdmin = isOldModuleAdmin || currentAdminSubs.includes(sub.to);
                          return (
                            <label key={sub.to} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition ${isSubAdmin ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
                              <input
                                type="checkbox"
                                checked={isSubAdmin}
                                onChange={(e) => {
                                  const adminSubs = { ...(formData.adminSubModules || {}) };
                                  // If old module admin, migrate to sub-module admin first
                                  let list = isOldModuleAdmin ? [...allSubRoutes] : [...(adminSubs[mod.key] || [])];
                                  const oldMods = formData.adminModules || [];
                                  if (e.target.checked) {
                                    if (!list.includes(sub.to)) list.push(sub.to);
                                  } else {
                                    list = list.filter(r => r !== sub.to);
                                  }
                                  if (list.length === 0) {
                                    delete adminSubs[mod.key];
                                  } else {
                                    adminSubs[mod.key] = list;
                                  }
                                  setFormData({ ...formData, adminSubModules: adminSubs, adminModules: oldMods.filter(m => m !== mod.key) });
                                }}
                                className="w-3.5 h-3.5 rounded accent-amber-600"
                              />
                              <SubIcon size={12} />
                              <span className="text-[10px] font-bold">{sub.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
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
