
import React, { useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, ArrowLeftRight, ClipboardCheck,
  History, Settings, LogOut, FileText, Sun, Moon,
  Users, Briefcase, FileSpreadsheet, GitBranch, Workflow, BarChart3, MessageCircle,
  Landmark, Repeat, Wrench, ChevronsLeft, ChevronsRight, AppWindow, ArrowLeft, Inbox, Layers, HardDrive,
  Calendar, CalendarOff, DollarSign, FileSignature, MapPin, Bot, FolderOpen
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { useChat } from '../context/ChatContext';
import { Role, TransactionStatus, RequestStatus } from '../types';

interface SidebarProps {
  isOpen: boolean;
  toggle: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const MODULE_CONFIG = [
  { key: 'WMS' as const, icon: Package, label: 'Vật tư', shortLabel: 'KHO', gradient: 'from-emerald-500 to-emerald-600', shadow: 'shadow-emerald-500/30', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-700', route: '/dashboard' },
  { key: 'HRM' as const, icon: Briefcase, label: 'Nhân sự', shortLabel: 'NS', gradient: 'from-teal-500 to-cyan-600', shadow: 'shadow-teal-500/30', color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-900/30', border: 'border-teal-200 dark:border-teal-700', route: '/hrm/employees' },
  { key: 'WF' as const, icon: GitBranch, label: 'Quy trình', shortLabel: 'QT', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/30', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/30', border: 'border-violet-200 dark:border-violet-700', route: '/wf' },
  { key: 'DA' as const, icon: BarChart3, label: 'Dự án', shortLabel: 'DA', gradient: 'from-orange-500 to-amber-500', shadow: 'shadow-orange-500/30', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30', border: 'border-orange-200 dark:border-orange-700', route: '/da' },
  { key: 'TS' as const, icon: Landmark, label: 'Tài sản', shortLabel: 'TS', gradient: 'from-rose-500 to-pink-600', shadow: 'shadow-rose-500/30', color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/30', border: 'border-rose-200 dark:border-rose-700', route: '/ts/dashboard' },
  { key: 'RQ' as const, icon: Inbox, label: 'Yêu cầu', shortLabel: 'RQ', gradient: 'from-cyan-500 to-blue-600', shadow: 'shadow-cyan-500/30', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-900/30', border: 'border-cyan-200 dark:border-cyan-700', route: '/rq' },
  { key: 'EX' as const, icon: BarChart3, label: 'Chi phí', shortLabel: 'CP', gradient: 'from-indigo-500 to-blue-600', shadow: 'shadow-indigo-500/30', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/30', border: 'border-indigo-200 dark:border-indigo-700', route: '/expense' },
] as const;

type AppKey = typeof MODULE_CONFIG[number]['key'];

// Sidebar states: 'home' | 'apps' | AppKey
type SidebarView = 'home' | 'apps' | AppKey;

const Sidebar: React.FC<SidebarProps> = ({ isOpen, toggle, collapsed, setCollapsed }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, warehouses, transactions, requests, appSettings, items } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const { totalUnread } = useChat();

  // Detect if we're inside a module from URL
  const detectAppFromUrl = (): AppKey | null => {
    const p = location.pathname;
    if (p.startsWith('/hrm')) return 'HRM';
    if (p.startsWith('/wf')) return 'WF';
    if (p.startsWith('/da')) return 'DA';
    if (p.startsWith('/ts')) return 'TS';
    if (p.startsWith('/rq')) return 'RQ';
    if (p.startsWith('/expense')) return 'EX';
    if (['/dashboard', '/inventory', '/operations', '/audit', '/reports', '/requests', '/misa-export'].includes(p)) return 'WMS';
    if (p.startsWith('/storage')) return null;
    return null;
  };

  const initialView = (): SidebarView => {
    const app = detectAppFromUrl();
    return app || 'home';
  };

  const [view, setView] = useState<SidebarView>(initialView());

  // Filter modules by user permissions
  const userModules = useMemo(() => {
    if (user.role === Role.ADMIN || !user.allowedModules || user.allowedModules.length === 0) {
      return [...MODULE_CONFIG];
    }
    return MODULE_CONFIG.filter(m => user.allowedModules!.includes(m.key));
  }, [user.role, user.allowedModules]);

  // Validate the current view
  const isModuleView = view !== 'home' && view !== 'apps';
  const activeModule = isModuleView ? MODULE_CONFIG.find(m => m.key === view) : null;
  const isModuleAllowed = activeModule ? userModules.some(m => m.key === activeModule.key) : false;

  const pendingTxCount = useMemo(() => {
    if (user.role === Role.ADMIN) return transactions.filter(t => t.status === TransactionStatus.PENDING).length;
    if (user.assignedWarehouseId) {
      return transactions.filter(t => t.requesterId === user.id && t.status === TransactionStatus.PENDING).length
        + transactions.filter(t => t.targetWarehouseId === user.assignedWarehouseId && t.status === TransactionStatus.APPROVED).length;
    }
    return 0;
  }, [transactions, user]);

  const pendingReqCount = useMemo(() => {
    if (user.role === Role.ADMIN) return requests.filter(r => r.status === RequestStatus.PENDING).length;
    if (user.assignedWarehouseId) {
      return requests.filter(r => r.requesterId === user.id && r.status === RequestStatus.PENDING).length
        + requests.filter(r =>
          (r.status === RequestStatus.APPROVED && r.sourceWarehouseId === user.assignedWarehouseId) ||
          (r.status === RequestStatus.IN_TRANSIT && r.siteWarehouseId === user.assignedWarehouseId)
        ).length;
    }
    return 0;
  }, [requests, user]);

  const lowStockCount = useMemo(() => {
    return items.filter(item => {
      const totalStock = Object.values(item.stockByWarehouse).reduce((a: number, b) => a + (b as number), 0);
      return totalStock <= item.minStock;
    }).length;
  }, [items]);

  // Nav items per module
  const moduleNavMap: Record<AppKey, any[]> = {
    WMS: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/requests', icon: FileText, label: 'Đề xuất vật tư', badge: pendingReqCount > 0 ? pendingReqCount : null },
      { to: '/inventory', icon: Package, label: 'Kho & Vật tư', badge: lowStockCount > 0 ? lowStockCount : null, badgeColor: 'bg-amber-500' },
      { to: '/operations', icon: ArrowLeftRight, label: 'Nhập / Xuất', badge: pendingTxCount > 0 ? pendingTxCount : null },
      { to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' },
      { to: '/reports', icon: History, label: 'Báo cáo WMS' },
      { to: '/misa-export', icon: FileSpreadsheet, label: 'Đồng bộ MISA', roles: [Role.ADMIN] },
    ],
    HRM: [
      { to: '/hrm/dashboard', icon: LayoutDashboard, label: 'Dashboard NS' },
      { to: '/hrm/checkin', icon: MapPin, label: 'Check-in' },
      { to: '/hrm/employees', icon: Users, label: 'Hồ sơ nhân sự' },
      { to: '/hrm/attendance', icon: Calendar, label: 'Chấm công' },
      { to: '/hrm/leave', icon: CalendarOff, label: 'Nghỉ phép' },
      { to: '/hrm/payroll', icon: DollarSign, label: 'Bảng lương' },
      { to: '/hrm/contracts', icon: FileSignature, label: 'Hợp đồng LĐ' },
      { to: '/hrm/documents', icon: FolderOpen, label: 'Hồ sơ & Công văn' },
      { to: '/hrm/reports', icon: BarChart3, label: 'Báo cáo NS' },
    ],
    WF: [
      { to: '/wf/dashboard', icon: LayoutDashboard, label: 'Dashboard QT' },
      { to: '/wf', icon: GitBranch, label: 'Quy trình' },
      { to: '/wf/templates', icon: Workflow, label: 'Mẫu quy trình', roles: [Role.ADMIN] },
    ],
    DA: [
      { to: '/da', icon: BarChart3, label: 'Tổng quan DA' },
      { to: '/da/portfolio', icon: Layers, label: 'Đa dự án' },
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
      { to: '/rq/categories', icon: Settings, label: 'Danh mục yêu cầu', roles: [Role.ADMIN] },
    ],
    EX: [
      { to: '/expense', icon: BarChart3, label: 'Kế hoạch chi phí' },
    ],
  };

  const currentNavItems = (isModuleView && isModuleAllowed && activeModule) ? moduleNavMap[activeModule.key] || [] : [];
  const filteredNavItems = currentNavItems.filter((item: any) => !item.roles || item.roles.includes(user.role));
  const assignedWh = warehouses.find(w => w.id === user.assignedWarehouseId);

  const sidebarBg = isDark ? 'glass-panel border-r border-white/10' : 'glass-panel border-r border-white/20';
  const sidebarWidth = collapsed ? 'w-[72px]' : 'w-64';

  const handleModuleClick = (mod: typeof MODULE_CONFIG[number]) => {
    setView(mod.key);
    navigate(mod.route);
  };

  const goBackToHome = () => {
    setView('home');
    navigate('/');
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm" onClick={toggle} />}
      <aside className={`fixed top-0 left-0 z-30 h-screen ${sidebarWidth} text-slate-800 dark:text-white transition-all duration-300 lg:translate-x-0 lg:static ${sidebarBg} ${isOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>

        {/* Logo */}
        <div className={`flex items-center h-16 px-4 border-b border-white/20 dark:border-white/5 shrink-0 ${collapsed ? 'justify-center' : 'space-x-3'}`}>
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-black text-xs uppercase shadow-lg shadow-blue-500/40 shrink-0">
            {appSettings.name.slice(0, 2)}
          </div>
          {!collapsed && <span className="text-lg font-black tracking-tight truncate">{appSettings.name}</span>}
        </div>

        {/* User Info */}
        {!collapsed ? (
          <div className="px-4 py-3 border-b border-white/20 dark:border-white/5 shrink-0">
            <div className="flex items-center space-x-3 mb-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { setView('home'); navigate('/'); }} title="Xem hồ sơ cá nhân">
              <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=2563eb&color=fff`}
                className="w-9 h-9 rounded-full border-2 border-accent shadow" alt={user.name} />
              <div className="min-w-0">
                <p className="font-black text-sm truncate">{user.name}</p>
                <p className="text-[10px] text-accent font-black uppercase tracking-wider">{user.role}</p>
              </div>
            </div>
            {assignedWh && (
              <div className="p-2 rounded-lg text-[10px] border mb-1 bg-white/40 border-white/60 dark:bg-slate-800/50 dark:border-slate-700/50 text-slate-600 dark:text-slate-400">
                <span className="font-black text-slate-300 block mb-0.5 uppercase tracking-tighter">Kho quản lý:</span>
                <span className="truncate block font-bold text-white">{assignedWh.name}</span>
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={toggleTheme}
                className={`flex-none flex items-center justify-center w-9 h-9 rounded-lg border transition-all ${isDark ? 'bg-slate-800/50 border-white/10 text-yellow-400 hover:bg-slate-700/50' : 'bg-white/50 border-white/60 text-slate-600 hover:bg-white hover:text-slate-900'}`}
                title={isDark ? 'Chuyển Light Mode' : 'Chuyển Dark Mode'}
              >
                {isDark ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-red-500 hover:text-white hover:border-red-500 transition-all whitespace-nowrap"
              >
                <LogOut size={13} /> Đăng xuất
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-3 border-b border-white/20 dark:border-white/5 shrink-0 gap-2">
            <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=2563eb&color=fff`}
              className="w-9 h-9 rounded-full border-2 border-accent shadow cursor-pointer hover:opacity-80 transition-opacity" alt={user.name} title="Xem hồ sơ cá nhân" onClick={() => { setView('home'); navigate('/'); }} />
            <button onClick={toggleTheme}
              className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-all ${isDark ? 'bg-slate-800/50 border-white/10 text-yellow-400' : 'bg-white/50 border-white/60 text-slate-600'}`}
              title={isDark ? 'Light Mode' : 'Dark Mode'}>
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={() => { logout(); navigate('/login'); }}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all" title="Đăng xuất">
              <LogOut size={14} />
            </button>
          </div>
        )}

        {/* ==================== NAVIGATION ==================== */}
        <nav className="px-2 py-2 flex-1 overflow-y-auto space-y-0.5">

          {/* ====== MOBILE FLAT VIEW — show everything at once ====== */}
          <div className="lg:hidden">
            {view === 'home' || view === 'apps' ? (
              <>
                {/* Module Grid on mobile */}
                <div className="px-2 pb-2">
                  <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">Ứng dụng</p>
                  <div className="grid grid-cols-4 gap-2">
                    {userModules.map(mod => {
                      const ModIcon = mod.icon;
                      const isActiveModule = detectAppFromUrl() === mod.key;
                      return (
                        <button
                          key={mod.key}
                          onClick={() => { handleModuleClick(mod); toggle(); }}
                          className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl transition-all ${isActiveModule ? `bg-gradient-to-br ${mod.gradient} text-white shadow-lg ${mod.shadow}` : `${mod.bg} border ${mod.border} hover:shadow-md`}`}
                        >
                          <ModIcon size={20} className={isActiveModule ? '' : mod.color.split(' ')[0]} />
                          <span className={`text-[9px] font-bold leading-tight text-center ${isActiveModule ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>{mod.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-white/10 dark:border-slate-700/50 pt-2 mt-1 space-y-0.5">
                  <NavLink to="/settings" onClick={toggle}
                    className={({ isActive }) => `flex items-center px-4 py-2.5 rounded-xl transition-all group ${isActive
                      ? 'bg-accent/90 text-white shadow-lg shadow-blue-500/20 border border-white/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                    <Settings className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" />
                    <span className="font-bold text-sm">Cài đặt</span>
                  </NavLink>

                  <NavLink to="/chat" onClick={toggle}
                    className={({ isActive }) => `flex items-center justify-between px-4 py-2.5 rounded-xl transition-all group ${isActive
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20 border border-white/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                    <div className="flex items-center">
                      <MessageCircle className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" />
                      <span className="font-bold text-sm">Tin nhắn</span>
                    </div>
                    {totalUnread > 0 && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 bg-red-500 ring-slate-900 animate-pulse">
                        {totalUnread > 9 ? '9+' : totalUnread}
                      </span>
                    )}
                  </NavLink>
                </div>
              </>
            ) : isModuleView && activeModule && isModuleAllowed ? (
              <>
                <button
                  onClick={() => setView('home')}
                  className="w-full flex items-center px-4 py-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white/40 dark:hover:bg-slate-800/50 transition-all group mb-1"
                >
                  <ArrowLeft size={14} className="mr-2 group-hover:-translate-x-0.5 transition-transform" />
                  <span className="text-xs font-bold">Quay lại</span>
                </button>
                <div className={`mx-1 mb-2 px-3 py-2 rounded-xl flex items-center gap-2.5 bg-gradient-to-r ${activeModule.gradient} text-white shadow-lg ${activeModule.shadow}`}>
                  <activeModule.icon size={18} />
                  <span className="text-sm font-black">{activeModule.label}</span>
                </div>
                {filteredNavItems.map((item: any) => (
                  <NavLink key={item.to} to={item.to} end onClick={toggle}
                    className={({ isActive }) => `flex items-center justify-between px-4 py-2.5 rounded-xl transition-all group ${isActive
                      ? 'bg-accent/90 text-white shadow-lg shadow-emerald-500/20 backdrop-blur-md border border-white/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                    <div className="flex items-center">
                      <item.icon className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" />
                      <span className="font-bold text-sm">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 ${item.badgeColor || 'bg-red-500'} ring-slate-900`}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                ))}
                <div className="mt-3 pt-2 border-t border-white/10 dark:border-slate-700/50 space-y-0.5">
                  <NavLink to="/settings" onClick={toggle}
                    className={({ isActive }) => `flex items-center px-4 py-2.5 rounded-xl transition-all group ${isActive
                      ? 'bg-accent/90 text-white shadow-lg shadow-blue-500/20 border border-white/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                    <Settings className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" />
                    <span className="font-bold text-sm">Cài đặt</span>
                  </NavLink>
                  <NavLink to="/chat" onClick={toggle}
                    className={({ isActive }) => `flex items-center justify-between px-4 py-2.5 rounded-xl transition-all group ${isActive
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20 border border-white/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                    <div className="flex items-center">
                      <MessageCircle className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" />
                      <span className="font-bold text-sm">Tin nhắn</span>
                    </div>
                    {totalUnread > 0 && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 bg-red-500 ring-slate-900 animate-pulse">
                        {totalUnread > 9 ? '9+' : totalUnread}
                      </span>
                    )}
                  </NavLink>
                </div>
              </>
            ) : null}
          </div>

          {/* ====== DESKTOP VIEW — existing drill-down behavior ====== */}
          <div className="hidden lg:block space-y-0.5">

          {/* ====== VIEW: HOME (default) ====== */}
          {view === 'home' && (
            <>
              {/* Ứng dụng — folder entry */}
              <button
                onClick={() => setView('apps')}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50`}
                title={collapsed ? 'Ứng dụng' : undefined}
              >
                <div className="flex items-center">
                  <AppWindow className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                  {!collapsed && <span className="font-bold text-sm">Ứng dụng</span>}
                </div>
                {!collapsed && (
                  <span className="text-[9px] font-black bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-md">{userModules.length}</span>
                )}
              </button>

              {/* Cài đặt */}
              <NavLink to="/settings" title={collapsed ? 'Cài đặt' : undefined}
                className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : ''} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                  ? 'bg-accent/90 text-white shadow-lg shadow-blue-500/20 border border-white/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                <Settings className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                {!collapsed && <span className="font-bold text-sm">Cài đặt</span>}
              </NavLink>

              {/* Trợ lý AI */}
              <NavLink to="/ai" title={collapsed ? 'Trợ lý AI' : undefined}
                className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : ''} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                  ? 'bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20 border border-white/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                <Bot className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                {!collapsed && <span className="font-bold text-sm">Trợ lý AI</span>}
              </NavLink>

              {/* Kho dữ liệu */}
              <NavLink to="/storage" title={collapsed ? 'Kho dữ liệu' : undefined}
                className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : ''} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                  ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/20 border border-white/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                <HardDrive className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                {!collapsed && <span className="font-bold text-sm">Kho dữ liệu</span>}
              </NavLink>

              {/* Tin nhắn */}
              <NavLink to="/chat" title={collapsed ? 'Tin nhắn' : undefined}
                className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20 border border-white/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                <div className="flex items-center relative">
                  <MessageCircle className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                  {!collapsed && <span className="font-bold text-sm">Tin nhắn</span>}
                  {collapsed && totalUnread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center ring-1 ring-white/20 animate-pulse">
                      {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                  )}
                </div>
                {!collapsed && totalUnread > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 bg-red-500 ring-slate-900 animate-pulse">
                    {totalUnread > 9 ? '9+' : totalUnread}
                  </span>
                )}
              </NavLink>
            </>
          )}

          {/* ====== VIEW: APPS (inside Ứng dụng folder) ====== */}
          {view === 'apps' && (
            <>
              {/* Back button */}
              <button
                onClick={goBackToHome}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : ''} ${collapsed ? 'px-2' : 'px-4'} py-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white/40 dark:hover:bg-slate-800/50 transition-all group mb-1`}
              >
                <ArrowLeft size={14} className={`${collapsed ? '' : 'mr-2'} group-hover:-translate-x-0.5 transition-transform`} />
                {!collapsed && <span className="text-xs font-bold">Quay lại</span>}
              </button>

              {!collapsed && (
                <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                  <AppWindow size={11} /> Ứng dụng ({userModules.length})
                </div>
              )}

              {/* Module list */}
              {userModules.length === 0 ? (
                <div className="text-center py-6 text-[10px] text-slate-400 italic px-4">
                  Chưa được phân quyền module nào. Liên hệ Admin.
                </div>
              ) : (
                <div className="space-y-1 mt-1">
                  {userModules.map(mod => {
                    const ModIcon = mod.icon;
                    return (
                      <button
                        key={mod.key}
                        onClick={() => handleModuleClick(mod)}
                        title={collapsed ? mod.label : undefined}
                        className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-2' : 'px-4'} py-3 rounded-xl transition-all group hover:shadow-md ${mod.bg} border ${mod.border} hover:scale-[1.01]`}
                      >
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${mod.gradient} flex items-center justify-center text-white shadow-sm ${mod.shadow} shrink-0`}>
                          <ModIcon size={16} />
                        </div>
                        {!collapsed && (
                          <div className="text-left min-w-0">
                            <span className={`text-sm font-bold ${mod.color} block truncate`}>{mod.label}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ====== VIEW: MODULE (inside a specific module) ====== */}
          {isModuleView && activeModule && isModuleAllowed && (
            <>
              {/* Back to Ứng dụng */}
              <button
                onClick={() => setView('apps')}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : ''} ${collapsed ? 'px-2' : 'px-4'} py-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white/40 dark:hover:bg-slate-800/50 transition-all group mb-1`}
              >
                <ArrowLeft size={14} className={`${collapsed ? '' : 'mr-2'} group-hover:-translate-x-0.5 transition-transform`} />
                {!collapsed && <span className="text-xs font-bold">Ứng dụng</span>}
              </button>

              {/* Active module header */}
              {!collapsed && (
                <div className={`mx-1 mb-2 px-3 py-2 rounded-xl flex items-center gap-2.5 bg-gradient-to-r ${activeModule.gradient} text-white shadow-lg ${activeModule.shadow}`}>
                  <activeModule.icon size={18} />
                  <span className="text-sm font-black">{activeModule.label}</span>
                </div>
              )}

              {/* Module nav items */}
              {filteredNavItems.map((item: any) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                    ? 'bg-accent/90 text-white shadow-lg shadow-emerald-500/20 backdrop-blur-md border border-white/20'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'
                    }`}
                >
                  <div className="flex items-center">
                    <item.icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                    {!collapsed && <span className="font-bold text-sm">{item.label}</span>}
                  </div>
                  {!collapsed && item.badge && (
                    <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 ${item.badgeColor || 'bg-red-500'} ${isDark ? 'ring-slate-900' : 'ring-primary'}`}>
                      {item.badge}
                    </span>
                  )}
                  {collapsed && item.badge && (
                    <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </NavLink>
              ))}

              {/* Separator + base items inside module */}
              <div className="mt-3 pt-2 border-t border-white/10 dark:border-slate-700/50 space-y-0.5">
                <NavLink to="/settings" title={collapsed ? 'Cài đặt' : undefined}
                  className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : ''} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                    ? 'bg-accent/90 text-white shadow-lg shadow-blue-500/20 border border-white/20'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                  <Settings className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                  {!collapsed && <span className="font-bold text-sm">Cài đặt</span>}
                </NavLink>
                <NavLink to="/chat" title={collapsed ? 'Tin nhắn' : undefined}
                  className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20 border border-white/20'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'}`}>
                  <div className="flex items-center relative">
                    <MessageCircle className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                    {!collapsed && <span className="font-bold text-sm">Tin nhắn</span>}
                    {collapsed && totalUnread > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center ring-1 ring-white/20 animate-pulse">
                        {totalUnread > 9 ? '9+' : totalUnread}
                      </span>
                    )}
                  </div>
                  {!collapsed && totalUnread > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 bg-red-500 ring-slate-900 animate-pulse">
                      {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                  )}
                </NavLink>
              </div>
            </>
          )}
          </div>
        </nav>

        {/* Collapse Toggle */}
        <div className="hidden lg:flex px-2 py-2 border-t border-white/10 dark:border-white/5 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 py-2.5 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white/40 dark:hover:bg-slate-800/50 transition-all group`}
            title={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
          >
            {!collapsed && <span className="text-[10px] font-bold uppercase tracking-wider">Thu gọn</span>}
            {collapsed ? <ChevronsRight size={16} className="group-hover:translate-x-0.5 transition-transform" /> : <ChevronsLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />}
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
