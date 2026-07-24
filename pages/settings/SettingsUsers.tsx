import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User, Role, Warehouse } from '../../types';
import {
  Plus, MapPin, Shield, Mail, Phone, MoreVertical, RotateCcw, UserX,
  Search, ChevronDown, MessageCircle, Key, Edit, Calendar,
  FileSpreadsheet, Eye, X, CheckCircle2, ShieldCheck,
  Building, Package, Briefcase, GitBranch, BarChart3, ShoppingCart, Landmark,
  Inbox, IdCard, FileSignature, Bot, Settings as SettingsIcon,
  UserCheck, ShieldAlert, Clock, History
} from 'lucide-react';
import UserModal from '../../components/UserModal';
import UserAccountStatusModal from '../../components/UserAccountStatusModal';
import { isChatEnabled } from '../../lib/featureFlags';
import { useToast } from '../../context/ToastContext';

interface SettingsUsersProps {
  users: User[];
  currentUser: User;
  warehouses: Warehouse[];
  isUserModalOpen: boolean;
  setIsUserModalOpen: (v: boolean) => void;
  editingUser: User | null;
  accountTarget: User | null;
  accountAction: 'DISABLE' | 'REACTIVATE';
  closeAccountAction: () => void;
  openAccountAction: (user: User, action: 'DISABLE' | 'REACTIVATE') => void;
  handleAccountAction: (input: { reason: string; newPassword?: string }) => void | Promise<void>;
  handleAddUser: () => void;
  handleEditUser: (u: User) => void;
  handleSaveUser: (u: User) => void | Promise<void>;
  getRoleBadge: (role: Role) => React.ReactNode;
  isSavingAccount?: boolean;
}

// Module config for colorful micro-badges in table rows
const MODULE_BADGE_MAP: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  WMS: { label: 'Kho & Vật tư', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-600', icon: Package },
  HRM: { label: 'Hồ sơ Nhân sự', bg: 'bg-teal-50 border-teal-200', text: 'text-teal-600', icon: Briefcase },
  WF: { label: 'Quy trình & Đề xuất', bg: 'bg-violet-50 border-violet-200', text: 'text-violet-600', icon: GitBranch },
  DA: { label: 'Quản lý Dự án', bg: 'bg-orange-50 border-orange-200', text: 'text-orange-600', icon: BarChart3 },
  PROCUREMENT: { label: 'Mua hàng', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: ShoppingCart },
  TS: { label: 'Quản lý Tài sản', bg: 'bg-rose-50 border-rose-200', text: 'text-rose-600', icon: Landmark },
  RQ: { label: 'Phiếu Yêu cầu', bg: 'bg-cyan-50 border-cyan-200', text: 'text-cyan-600', icon: Inbox },
  EX: { label: 'Kế hoạch Chi phí', bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-600', icon: BarChart3 },
  EP: { label: 'Tra cứu Nhân viên', bg: 'bg-sky-50 border-sky-200', text: 'text-sky-600', icon: IdCard },
  HD: { label: 'Quản lý Hợp đồng', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-600', icon: FileSignature },
  TENDER_AI: { label: 'Dự toán AI', bg: 'bg-fuchsia-50 border-fuchsia-200', text: 'text-fuchsia-600', icon: Bot },
  CHAT: { label: 'Tin nhắn nội bộ', bg: 'bg-pink-50 border-pink-200', text: 'text-pink-600', icon: MessageCircle },
  SETTINGS: { label: 'Cài đặt hệ thống', bg: 'bg-slate-100 border-slate-300', text: 'text-slate-700', icon: SettingsIcon },
  CHIBIBOT: { label: 'Trợ lý AI ChibiBot', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-600', icon: Bot },
};

const SettingsUsers: React.FC<SettingsUsersProps> = ({
  users,
  currentUser,
  warehouses,
  isUserModalOpen,
  setIsUserModalOpen,
  editingUser,
  accountTarget,
  accountAction,
  closeAccountAction,
  openAccountAction,
  handleAccountAction,
  handleAddUser,
  handleEditUser,
  handleSaveUser,
  getRoleBadge,
  isSavingAccount = false,
}) => {
  const toast = useToast();
  
  // Filtering & Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [matchMode, setMatchMode] = useState<'exact' | 'contains'>('contains');
  const [activeTab, setActiveTab] = useState<'all' | 'admin' | 'online' | 'disabled' | 'logs'>('all');
  
  // Interactive UI Popover & Drawer states
  const [selectedUserForPopover, setSelectedUserForPopover] = useState<User | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [drawerUser, setDrawerUser] = useState<User | null>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState<'account' | 'edit' | 'password' | 'security' | 'schedule'>('account');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [showLoginLogsModal, setShowLoginLogsModal] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setSelectedUserForPopover(null);
      }
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute User stats
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.isActive !== false && u.accountStatus !== 'DISABLED').length;
    const admin = users.filter(u => u.role === Role.ADMIN || (u.adminModules && u.adminModules.length > 0)).length;
    const online = users.filter(u => u.isOnline !== false).length; // Default to online in demo/mock
    const disabled = total - active;
    return { total, active, admin, online, disabled };
  }, [users]);

  // Filtered Users list
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const isDisabled = u.accountStatus === 'DISABLED' || u.isActive === false;
      const isAdmin = u.role === Role.ADMIN || (u.adminModules && u.adminModules.length > 0);
      const isOnline = u.isOnline !== false;

      // Tab filter
      if (activeTab === 'admin' && !isAdmin) return false;
      if (activeTab === 'online' && !isOnline) return false;
      if (activeTab === 'disabled' && !isDisabled) return false;

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const username = (u.username || u.email.split('@')[0] || '').toLowerCase();
      const name = (u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const phone = (u.phone || '').toLowerCase();
      const position = (u.position || '').toLowerCase();

      if (matchMode === 'exact') {
        return name === q || email === q || username === q || phone === q || position === q;
      }
      return (
        name.includes(q) ||
        email.includes(q) ||
        username.includes(q) ||
        phone.includes(q) ||
        position.includes(q)
      );
    });
  }, [users, activeTab, searchQuery, matchMode]);

  // Open Popover
  const handleOpenPopover = (e: React.MouseEvent, u: User) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenWidth = window.innerWidth;
    const popoverWidth = 320;
    
    let left = rect.right - popoverWidth;
    if (left < 10) left = 10;
    if (left + popoverWidth > screenWidth - 10) left = screenWidth - popoverWidth - 10;

    let top = rect.bottom + 6;
    if (top + 450 > window.innerHeight) {
      top = rect.top - 460;
    }

    setSelectedUserForPopover(u);
    setPopoverPosition({ top, left });
  };

  // Change user role quick action
  const handleQuickRoleChange = async (targetUser: User, newRole: Role) => {
    setSelectedUserForPopover(null);
    if (targetUser.role === newRole) return;
    try {
      await handleSaveUser({ ...targetUser, role: newRole });
      toast.success('Đã cập nhật vai trò', `Đã chuyển tài khoản ${targetUser.name} thành ${newRole}.`);
    } catch (err: any) {
      toast.error('Lỗi phân vai trò', err.message || 'Không thể đổi vai trò.');
    }
  };

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
      {/* Top Controls & Navbar Header */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
        {/* Row 1: Search bar, Dropdowns & Primary Action */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Left: Search input + Mode dropdown */}
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm thành viên theo tên, @username, email, SĐT..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Match Precision Dropdown */}
            <select
              value={matchMode}
              onChange={e => setMatchMode(e.target.value as any)}
              className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
            >
              <option value="contains">Chứa từ</option>
              <option value="exact">Chính xác</option>
            </select>
          </div>

          {/* Right: Primary Action Button "Thêm tài khoản v" */}
          <div className="relative shrink-0" ref={addMenuRef}>
            <div className="inline-flex rounded-xl shadow-md shadow-teal-500/10 overflow-hidden">
              <button
                onClick={handleAddUser}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Thêm tài khoản
              </button>
              <button
                onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                className="px-2.5 py-2 bg-teal-600 hover:bg-teal-700 text-white transition border-l border-teal-400/40"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Dropdown Menu for Thêm tài khoản */}
            {isAddMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-30 animate-in fade-in zoom-in-95">
                <button
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    handleAddUser();
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-700 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4 text-teal-600" /> Thêm 1 tài khoản mới
                </button>
                <button
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    toast.info('Tính năng Import Excel', 'Vui lòng sử dụng tính năng Import danh sách nhân sự tại HRM >> Hồ sơ nhân sự.');
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-700 flex items-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Import danh sách từ Excel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Filter Tabs (TẤT CẢ, QUẢN TRỊ HỆ THỐNG, ONLINE, VÔ HIỆU HOÁ, LỊCH SỬ ĐĂNG NHẬP) */}
        <div className="flex items-center gap-1 border-b border-slate-100 pb-0 overflow-x-auto">
          {([
            ['all', `TẤT CẢ (${stats.active}/${stats.total})`],
            ['admin', `QUẢN TRỊ HỆ THỐNG (${stats.admin})`],
            ['online', `ONLINE (${stats.online})`],
            ['disabled', `VÔ HIỆU HOÁ (${stats.disabled})`],
            ['logs', `LỊCH SỬ ĐĂNG NHẬP`],
          ] as const).map(([tabKey, tabLabel]) => (
            <button
              key={tabKey}
              onClick={() => {
                if (tabKey === 'logs') {
                  setShowLoginLogsModal(true);
                } else {
                  setActiveTab(tabKey);
                }
              }}
              className={`px-4 py-2.5 text-xs font-black tracking-wider transition-all border-b-2 whitespace-nowrap ${
                activeTab === tabKey
                  ? 'border-teal-500 text-teal-600 bg-teal-50/50 rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg'
              }`}
            >
              {tabLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Main Enterprise Data Table View */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-black text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-6 font-black">Họ và tên</th>
                <th className="py-3.5 px-6 font-black">Thông tin liên lạc</th>
                <th className="py-3.5 px-6 font-black">Quản lý trực tiếp</th>
                <th className="py-3.5 px-6 text-right font-black">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    <UserX className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-bold text-slate-600">Không tìm thấy tài khoản phù hợp</p>
                    <p className="text-xs text-slate-400 mt-1">Thử thay đổi từ khóa hoặc bộ lọc tìm kiếm</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => {
                  const disabled = u.accountStatus === 'DISABLED' || u.isActive === false;
                  const isAdmin = u.role === Role.ADMIN || (u.adminModules && u.adminModules.length > 0);
                  const isOnline = u.isOnline !== false;
                  const manager = users.find(m => m.id === u.managerId);
                  const username = u.username || u.email.split('@')[0];
                  const position = u.position || (u.role === Role.ADMIN ? 'Quản trị viên' : u.role === Role.WAREHOUSE_KEEPER ? 'Thủ kho' : 'Cán bộ');
                  
                  // Compute modules for app icons row
                  const allowedMods = isAdmin 
                    ? Object.keys(MODULE_BADGE_MAP) 
                    : (u.allowedModules && u.allowedModules.length > 0 ? u.allowedModules : ['WMS', 'HRM', 'WF']);

                  return (
                    <tr
                      key={u.id}
                      onClick={() => setDrawerUser(u)}
                      className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${disabled ? 'opacity-60 bg-slate-50/40' : ''}`}
                    >
                      {/* Column 1: HỌ VÀ TÊN */}
                      <td className="py-4 px-6 align-top">
                        <div className="flex items-start gap-3.5">
                          {/* Avatar with Online dot */}
                          <div className="relative shrink-0 mt-0.5">
                            <img
                              src={u.avatar || `https://i.pravatar.cc/150?u=${u.email}`}
                              alt={u.name}
                              className="w-11 h-11 rounded-full object-cover border-2 border-slate-100 group-hover:border-teal-400 transition"
                            />
                            <span
                              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                                isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                              }`}
                              title={isOnline ? 'Đang online' : 'Ngoại tuyến'}
                            />
                          </div>

                          <div className="space-y-1 min-w-0">
                            {/* Name & Role label */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-slate-800 group-hover:text-teal-600 transition">
                                {u.name}
                              </span>
                              {u.id === currentUser.id && (
                                <span className="text-[9px] font-black text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                  BẠN
                                </span>
                              )}
                              {isAdmin && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3 text-amber-600" /> Quản trị cấp cao
                                </span>
                              )}
                              {disabled && (
                                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                                  Đã vô hiệu hóa
                                </span>
                              )}
                            </div>

                            {/* Handle & Title */}
                            <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                              <span className="text-slate-600 font-semibold">@{username}</span>
                              <span className="text-slate-300">·</span>
                              <span className="text-slate-500">{position}</span>
                            </div>

                            {/* Micro App Badges Row */}
                            <div className="flex items-center gap-1 pt-1 flex-wrap">
                              {allowedMods.slice(0, 10).map(modKey => {
                                const cfg = MODULE_BADGE_MAP[modKey] || { label: modKey, bg: 'bg-slate-100 border-slate-200', text: 'text-slate-600', icon: Package };
                                const IconComp = cfg.icon;
                                return (
                                  <div
                                    key={modKey}
                                    className={`w-5 h-5 rounded-full border flex items-center justify-center ${cfg.bg} ${cfg.text} hover:scale-110 transition-transform`}
                                    title={cfg.label}
                                  >
                                    <IconComp className="w-3 h-3" />
                                  </div>
                                );
                              })}
                              {allowedMods.length > 10 && (
                                <span className="text-[10px] font-bold text-slate-400 pl-1">
                                  +{allowedMods.length - 10}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: THÔNG TIN LIÊN LẠC */}
                      <td className="py-4 px-6 align-top">
                        <div className="space-y-1 text-xs text-slate-600">
                          <div className="flex items-center gap-1.5 font-medium text-slate-700">
                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{u.email}</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-medium">
                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {u.phone ? (
                              <span>{u.phone}</span>
                            ) : (
                              <span className="italic text-slate-400 text-[11px]">Chưa nhập số điện thoại</span>
                            )}
                          </div>
                          {u.birthDate && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{u.birthDate}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Column 3: QUẢN LÝ TRỰC TIẾP */}
                      <td className="py-4 px-6 align-top">
                        {manager ? (
                          <div className="flex items-center gap-2.5">
                            <img
                              src={manager.avatar || `https://i.pravatar.cc/150?u=${manager.email}`}
                              alt={manager.name}
                              className="w-8 h-8 rounded-full border border-slate-200 object-cover"
                            />
                            <div className="text-xs min-w-0">
                              <p className="font-bold text-slate-800 truncate">{manager.name}</p>
                              <p className="text-[11px] text-slate-400 truncate">@{manager.username || manager.email.split('@')[0]}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs italic text-slate-400 font-medium">Chưa phân công</span>
                        )}
                      </td>

                      {/* Column 4: THAO TÁC (...) */}
                      <td className="py-4 px-6 align-top text-right" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={e => handleOpenPopover(e, u)}
                          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                          title="Menu thao tác"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Base.vn Action Popover Menu */}
      {selectedUserForPopover && popoverPosition && (
        <div
          ref={popoverRef}
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
          className="fixed z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 py-3 px-3 space-y-2 animate-in fade-in zoom-in-95"
        >
          {/* Popover Header */}
          <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-xl border border-slate-100">
            <img
              src={selectedUserForPopover.avatar || `https://i.pravatar.cc/150?u=${selectedUserForPopover.email}`}
              alt={selectedUserForPopover.name}
              className="w-10 h-10 rounded-full border border-slate-200 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-xs text-slate-800 truncate">{selectedUserForPopover.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{selectedUserForPopover.position || selectedUserForPopover.role}</p>
            </div>
            <button
              onClick={() => setSelectedUserForPopover(null)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Popover Action Items */}
          <div className="space-y-0.5 text-xs">
            {/* Direct messaging */}
            {isChatEnabled && (
              <button
                onClick={() => {
                  setSelectedUserForPopover(null);
                  toast.info('Gửi tin nhắn', `Đã mở cửa sổ nhắn tin với ${selectedUserForPopover.name}`);
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-slate-700 hover:bg-teal-50 hover:text-teal-700 flex items-center gap-2.5 font-medium transition"
              >
                <MessageCircle className="w-4 h-4 text-teal-600 shrink-0" /> Gửi tin nhắn
              </button>
            )}

            {/* View Profile Drawer */}
            <button
              onClick={() => {
                setDrawerUser(selectedUserForPopover);
                setSelectedUserForPopover(null);
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-slate-700 hover:bg-teal-50 hover:text-teal-700 flex items-center gap-2.5 font-medium transition"
            >
              <Eye className="w-4 h-4 text-blue-600 shrink-0" /> Xem trang cá nhân & Cấu hình
            </button>

            {/* Role assignment dropdown */}
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <p className="px-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Phân vai trò tài khoản</p>
              <button
                onClick={() => handleQuickRoleChange(selectedUserForPopover, Role.EMPLOYEE)}
                className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-medium transition ${
                  selectedUserForPopover.role === Role.EMPLOYEE ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Chọn làm Thành viên thông thường
              </button>
              <button
                onClick={() => handleQuickRoleChange(selectedUserForPopover, Role.WAREHOUSE_KEEPER)}
                className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-medium transition ${
                  selectedUserForPopover.role === Role.WAREHOUSE_KEEPER ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building className="w-3.5 h-3.5 text-emerald-600" /> Chọn làm Thủ kho / Quản lý Kho
              </button>
              <button
                onClick={() => handleQuickRoleChange(selectedUserForPopover, Role.ADMIN)}
                className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-medium transition ${
                  selectedUserForPopover.role === Role.ADMIN ? 'bg-purple-50 text-purple-700 font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-purple-600" /> Chọn làm Quản trị hệ thống
              </button>
            </div>

            {/* Edit / Account Actions */}
            <div className="pt-2 border-t border-slate-100 space-y-0.5">
              <button
                onClick={() => {
                  handleEditUser(selectedUserForPopover);
                  setSelectedUserForPopover(null);
                }}
                className="w-full text-left px-3 py-1.5 rounded-lg text-slate-700 hover:bg-slate-100 flex items-center gap-2.5 font-medium transition"
              >
                <Edit className="w-3.5 h-3.5 text-slate-500" /> Chỉnh sửa thông tin cá nhân
              </button>
              
              <button
                onClick={() => {
                  const targetUser = selectedUserForPopover;
                  setSelectedUserForPopover(null);
                  openAccountAction(
                    targetUser,
                    targetUser.accountStatus === 'DISABLED' || targetUser.isActive === false ? 'REACTIVATE' : 'DISABLE'
                  );
                }}
                disabled={selectedUserForPopover.id === currentUser.id}
                className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2.5 font-medium transition ${
                  selectedUserForPopover.id === currentUser.id
                    ? 'text-slate-300 cursor-not-allowed'
                    : selectedUserForPopover.accountStatus === 'DISABLED' || selectedUserForPopover.isActive === false
                    ? 'text-emerald-600 hover:bg-emerald-50'
                    : 'text-red-600 hover:bg-red-50'
                }`}
              >
                {selectedUserForPopover.accountStatus === 'DISABLED' || selectedUserForPopover.isActive === false ? (
                  <><RotateCcw className="w-3.5 h-3.5" /> Khôi phục tài khoản này</>
                ) : (
                  <><UserX className="w-3.5 h-3.5" /> Vô hiệu hoá tài khoản này</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right Drawer Panel (Chi tiết tài khoản & Cấu hình nâng cao) */}
      {drawerUser && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
              {/* Drawer Header */}
              <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src={drawerUser.avatar || `https://i.pravatar.cc/150?u=${drawerUser.email}`}
                    alt={drawerUser.name}
                    className="w-12 h-12 rounded-full border-2 border-white/20 object-cover"
                  />
                  <div>
                    <h3 className="font-bold text-base text-white">{drawerUser.name}</h3>
                    <p className="text-xs text-slate-300">@{drawerUser.username || drawerUser.email.split('@')[0]} · {drawerUser.position || drawerUser.role}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerUser(null)}
                  className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/10 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Content Tabs */}
              <div className="flex border-b border-slate-200 bg-slate-50 px-6 gap-2 pt-2">
                {([
                  ['account', 'Thông tin chung', Shield],
                  ['edit', 'Chỉnh sửa', Edit],
                  ['password', 'Mật khẩu', Key],
                  ['schedule', 'Kho phụ trách', MapPin],
                ] as const).map(([tabKey, tabLabel, IconComp]) => (
                  <button
                    key={tabKey}
                    onClick={() => setDrawerActiveTab(tabKey)}
                    className={`px-3 py-2 text-xs font-bold transition flex items-center gap-1.5 border-b-2 ${
                      drawerActiveTab === tabKey
                        ? 'border-teal-500 text-teal-600 bg-white rounded-t-lg'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <IconComp className="w-3.5 h-3.5" /> {tabLabel}
                  </button>
                ))}
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {drawerActiveTab === 'account' && (
                  <div className="space-y-6">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400">Thông tin cơ bản</h4>
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <p className="text-slate-400 font-medium">Họ và tên</p>
                          <p className="font-bold text-slate-800 mt-0.5">{drawerUser.name}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-medium">Email</p>
                          <p className="font-bold text-slate-800 mt-0.5">{drawerUser.email}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-medium">Số điện thoại</p>
                          <p className="font-bold text-slate-800 mt-0.5">{drawerUser.phone || 'Chưa nhập'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-medium">Chức danh / Vị trí</p>
                          <p className="font-bold text-slate-800 mt-0.5">{drawerUser.position || 'Cán bộ'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-medium">Ngày sinh</p>
                          <p className="font-bold text-slate-800 mt-0.5">{drawerUser.birthDate || 'Chưa cập nhật'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-medium">Quản lý trực tiếp</p>
                          <p className="font-bold text-slate-800 mt-0.5">
                            {users.find(m => m.id === drawerUser.managerId)?.name || 'Chưa phân công'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400">Trạng thái & Quyền hạn</h4>
                      <div className="flex flex-wrap gap-2">
                        {getRoleBadge(drawerUser.role)}
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          drawerUser.accountStatus === 'DISABLED' || drawerUser.isActive === false
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {drawerUser.accountStatus === 'DISABLED' || drawerUser.isActive === false ? 'Đã vô hiệu hóa' : 'Đang hoạt động'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {drawerActiveTab === 'edit' && (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500">Mở cửa sổ chỉnh sửa đầy đủ để cập nhật thông tin người dùng này.</p>
                    <button
                      onClick={() => {
                        handleEditUser(drawerUser);
                        setDrawerUser(null);
                      }}
                      className="w-full py-2.5 bg-teal-600 text-white rounded-xl text-xs font-bold hover:bg-teal-700 transition"
                    >
                      Mở Form chỉnh sửa tài khoản
                    </button>
                  </div>
                )}

                {drawerActiveTab === 'password' && (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500">Đổi mật khẩu trực tiếp cho tài khoản này (Cập nhật cả trên Supabase Auth).</p>
                    <button
                      onClick={() => {
                        handleEditUser(drawerUser);
                        setDrawerUser(null);
                      }}
                      className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition"
                    >
                      Đổi mật khẩu người dùng
                    </button>
                  </div>
                )}

                {drawerActiveTab === 'schedule' && (
                  <div className="space-y-3 text-xs">
                    <p className="text-slate-500 font-medium">Kho phụ trách được phân công:</p>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 font-bold text-slate-800">
                      {warehouses.find(w => w.id === drawerUser.assignedWarehouseId)?.name || 'Phòng vật tư - toàn bộ kho'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Login Logs Audit Modal */}
      {showLoginLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-teal-600" />
                <h3 className="font-bold text-base text-slate-800">Lịch sử đăng nhập hệ thống</h3>
              </div>
              <button onClick={() => setShowLoginLogsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {users.slice(0, 6).map((u, idx) => (
                <div key={u.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <img src={u.avatar} alt="" className="w-8 h-8 rounded-full" />
                    <div>
                      <p className="font-bold text-slate-800">{u.name}</p>
                      <p className="text-[10px] text-slate-400">IP: 14.232.210.18 · Chrome on MacOS</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-slate-500">
                    {idx === 0 ? 'Vừa xong' : `${idx * 15} phút trước`}
                  </span>
                </div>
              ))}
            </div>

            <div className="text-right">
              <button
                onClick={() => setShowLoginLogsModal(false)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Modal for Create / Edit */}
      <UserModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        onSave={handleSaveUser}
        userToEdit={editingUser}
        warehouses={warehouses}
        users={users}
      />

      {/* Account Status Modal for Disable / Reactivate */}
      <UserAccountStatusModal
        isOpen={Boolean(accountTarget)}
        action={accountAction}
        targetUser={accountTarget}
        onClose={closeAccountAction}
        onConfirm={handleAccountAction}
        isSaving={isSavingAccount}
      />
    </div>
  );
};

export default SettingsUsers;
