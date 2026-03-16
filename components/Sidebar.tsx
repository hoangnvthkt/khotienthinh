
import React, { useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, ArrowLeftRight, ClipboardCheck,
  History, Settings, LogOut, FileText, Sun, Moon, Bell,
  Users, Briefcase, FileSpreadsheet, GitBranch, Workflow, BarChart3, MessageCircle,
  Landmark, Repeat, Wrench, ChevronsLeft, ChevronsRight
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
  { key: 'WMS' as const, icon: Package, label: 'KHO', gradient: 'from-emerald-500 to-emerald-600', shadow: 'shadow-emerald-500/30', hover: 'hover:text-emerald-600 dark:hover:text-emerald-400', route: '/' },
  { key: 'HRM' as const, icon: Briefcase, label: 'NS', gradient: 'from-teal-500 to-cyan-600', shadow: 'shadow-teal-500/30', hover: 'hover:text-teal-600 dark:hover:text-teal-400', route: '/hrm/employees' },
  { key: 'WF' as const, icon: GitBranch, label: 'QT', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/30', hover: 'hover:text-violet-600 dark:hover:text-violet-400', route: '/wf' },
  { key: 'DA' as const, icon: BarChart3, label: 'DA', gradient: 'from-orange-500 to-amber-500', shadow: 'shadow-orange-500/30', hover: 'hover:text-orange-600 dark:hover:text-orange-400', route: '/da' },
  { key: 'TS' as const, icon: Landmark, label: 'TS', gradient: 'from-rose-500 to-pink-600', shadow: 'shadow-rose-500/30', hover: 'hover:text-rose-600 dark:hover:text-rose-400', route: '/ts/catalog' },
] as const;

type AppKey = typeof MODULE_CONFIG[number]['key'];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, toggle, collapsed, setCollapsed }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, warehouses, transactions, requests, appSettings, items } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const { totalUnread } = useChat();

  // Auto-detect current app context based on URL
  const [currentApp, setCurrentApp] = useState<AppKey>(
    location.pathname.startsWith('/hrm') ? 'HRM' : location.pathname.startsWith('/wf') ? 'WF' : location.pathname.startsWith('/da') ? 'DA' : location.pathname.startsWith('/ts') ? 'TS' : 'WMS'
  );

  // Filter modules based on user permissions
  const userModules = useMemo(() => {
    if (user.role === Role.ADMIN || !user.allowedModules || user.allowedModules.length === 0) {
      // Admin gets all; users without specific config get all (backward compat)
      return [...MODULE_CONFIG];
    }
    return MODULE_CONFIG.filter(m => user.allowedModules!.includes(m.key));
  }, [user.role, user.allowedModules]);

  const pendingTxCount = useMemo(() => {
    if (user.role === Role.ADMIN) {
      return transactions.filter(t => t.status === TransactionStatus.PENDING).length;
    }
    if (user.role === Role.KEEPER) {
      const mySent = transactions.filter(t => t.requesterId === user.id && t.status === TransactionStatus.PENDING).length;
      const incoming = transactions.filter(t => t.targetWarehouseId === user.assignedWarehouseId && t.status === TransactionStatus.APPROVED).length;
      return mySent + incoming;
    }
    return 0;
  }, [transactions, user]);

  const pendingReqCount = useMemo(() => {
    if (user.role === Role.ADMIN || user.role === Role.ACCOUNTANT) {
      return requests.filter(r => r.status === RequestStatus.PENDING).length;
    }
    if (user.role === Role.KEEPER) {
      const myReq = requests.filter(r => r.requesterId === user.id && r.status === RequestStatus.PENDING).length;
      const needAction = requests.filter(r =>
        (r.status === RequestStatus.APPROVED && r.sourceWarehouseId === user.assignedWarehouseId) ||
        (r.status === RequestStatus.IN_TRANSIT && r.siteWarehouseId === user.assignedWarehouseId)
      ).length;
      return myReq + needAction;
    }
    return 0;
  }, [requests, user]);

  const lowStockCount = useMemo(() => {
    return items.filter(item => {
      const totalStock = Object.values(item.stockByWarehouse).reduce((a: number, b) => a + (b as number), 0);
      return totalStock <= item.minStock;
    }).length;
  }, [items]);

  const wmsNavItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/requests', icon: FileText, label: 'Đề xuất vật tư', badge: pendingReqCount > 0 ? pendingReqCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/inventory', icon: Package, label: 'Kho & Vật tư', badge: lowStockCount > 0 ? lowStockCount : null, badgeColor: 'bg-amber-500' },
    { to: '/operations', icon: ArrowLeftRight, label: 'Nhập / Xuất', badge: pendingTxCount > 0 ? pendingTxCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' },
    { to: '/reports', icon: History, label: 'Báo cáo WMS' },
    { to: '/misa-export', icon: FileSpreadsheet, label: 'Đồng bộ MISA', roles: [Role.ADMIN, Role.ACCOUNTANT], accentColor: 'bg-green-600' },
    { to: '/settings', icon: Settings, label: 'Cài đặt' },
  ];

  const wfNavItems = [
    { to: '/wf', icon: GitBranch, label: 'Quy trình' },
    { to: '/wf/templates', icon: Workflow, label: 'Mẫu quy trình', roles: [Role.ADMIN] },
    { to: '/settings', icon: Settings, label: 'Cài đặt' },
  ];

  const hrmNavItems: any[] = [
    { to: '/hrm/employees', icon: Users, label: 'Hồ sơ nhân sự' },
  ];

  const daNavItems = [
    { to: '/da', icon: BarChart3, label: 'Tổng quan DA' },
    { to: '/settings', icon: Settings, label: 'Cài đặt' },
  ];

  const tsNavItems = [
    { to: '/ts/catalog', icon: Landmark, label: 'Danh mục tài sản' },
    { to: '/ts/assignment', icon: Repeat, label: 'Cấp phát / Thu hồi' },
    { to: '/settings', icon: Settings, label: 'Cài đặt' },
  ];

  const currentNavItems = currentApp === 'WMS' ? wmsNavItems : currentApp === 'HRM' ? hrmNavItems : currentApp === 'DA' ? daNavItems : currentApp === 'TS' ? tsNavItems : wfNavItems;
  const filteredNavItems = currentNavItems.filter(item => !(item as any).roles || (item as any).roles.includes(user.role));
  const assignedWh = warehouses.find(w => w.id === user.assignedWarehouseId);

  const sidebarBg = isDark ? 'glass-panel border-r border-white/10' : 'glass-panel border-r border-white/20';
  const sidebarWidth = collapsed ? 'w-[72px]' : 'w-64';

  const handleModuleClick = (mod: typeof MODULE_CONFIG[number]) => {
    setCurrentApp(mod.key);
    navigate(mod.route);
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

        {/* Module Switcher */}
        {collapsed ? (
          /* Collapsed: vertical icon-only module list */
          <div className="px-2 py-2 border-b border-white/10 dark:border-white/5 shrink-0 space-y-1">
            {userModules.map(mod => {
              const ModIcon = mod.icon;
              const isActive = currentApp === mod.key;
              return (
                <button
                  key={mod.key}
                  onClick={() => handleModuleClick(mod)}
                  title={mod.label}
                  className={`w-full flex items-center justify-center py-2 rounded-xl transition-all ${isActive
                    ? `bg-gradient-to-r ${mod.gradient} text-white shadow-lg ${mod.shadow}`
                    : `text-slate-400 dark:text-slate-500 ${mod.hover} hover:bg-white/60 dark:hover:bg-slate-700/50`
                    }`}
                >
                  <ModIcon size={16} />
                </button>
              );
            })}
          </div>
        ) : (
          /* Expanded: compact grid 3+2 */
          <div className="mx-3 my-2.5 shrink-0">
            {userModules.length === 0 ? (
              <div className="text-center py-3 text-[10px] text-slate-400 italic">Chưa được phân quyền module</div>
            ) : userModules.length <= 3 ? (
              /* Single row if 3 or fewer */
              <div className={`grid grid-cols-${userModules.length} gap-1 bg-gradient-to-r from-slate-100 to-slate-200 dark:from-slate-800/80 dark:to-slate-700/60 border border-white/40 dark:border-slate-600/40 rounded-xl p-1 shadow-sm`}>
                {userModules.map(mod => {
                  const ModIcon = mod.icon;
                  const isActive = currentApp === mod.key;
                  return (
                    <button
                      key={mod.key}
                      onClick={() => handleModuleClick(mod)}
                      className={`py-2 px-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1 whitespace-nowrap ${isActive
                        ? `bg-gradient-to-r ${mod.gradient} text-white shadow-md ${mod.shadow} scale-[1.02]`
                        : `text-slate-400 dark:text-slate-500 ${mod.hover} hover:bg-white/60 dark:hover:bg-slate-700/50`
                        }`}
                    >
                      <ModIcon size={12} /> {mod.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Two rows for 4+ modules */
              <>
                <div className="grid grid-cols-3 gap-1 bg-gradient-to-r from-slate-100 to-slate-200 dark:from-slate-800/80 dark:to-slate-700/60 border border-white/40 dark:border-slate-600/40 rounded-xl p-1 shadow-sm">
                  {userModules.slice(0, 3).map(mod => {
                    const ModIcon = mod.icon;
                    const isActive = currentApp === mod.key;
                    return (
                      <button
                        key={mod.key}
                        onClick={() => handleModuleClick(mod)}
                        className={`py-2 px-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1 whitespace-nowrap ${isActive
                          ? `bg-gradient-to-r ${mod.gradient} text-white shadow-md ${mod.shadow} scale-[1.02]`
                          : `text-slate-400 dark:text-slate-500 ${mod.hover} hover:bg-white/60 dark:hover:bg-slate-700/50`
                          }`}
                      >
                        <ModIcon size={12} /> {mod.label}
                      </button>
                    );
                  })}
                </div>
                {userModules.length > 3 && (
                  <div className={`grid grid-cols-${userModules.length - 3} gap-1 bg-gradient-to-r from-slate-100 to-slate-200 dark:from-slate-800/80 dark:to-slate-700/60 border border-white/40 dark:border-slate-600/40 rounded-xl p-1 shadow-sm mt-1`}>
                    {userModules.slice(3).map(mod => {
                      const ModIcon = mod.icon;
                      const isActive = currentApp === mod.key;
                      return (
                        <button
                          key={mod.key}
                          onClick={() => handleModuleClick(mod)}
                          className={`py-2 px-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1 whitespace-nowrap ${isActive
                            ? `bg-gradient-to-r ${mod.gradient} text-white shadow-md ${mod.shadow} scale-[1.02]`
                            : `text-slate-400 dark:text-slate-500 ${mod.hover} hover:bg-white/60 dark:hover:bg-slate-700/50`
                            }`}
                        >
                          <ModIcon size={12} /> {mod.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* User Info */}
        {!collapsed ? (
          <div className={`px-4 py-3 border-b border-white/20 dark:border-white/5 shrink-0`}>
            <div className="flex items-center space-x-3 mb-2">
              <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=2563eb&color=fff`}
                className="w-9 h-9 rounded-full border-2 border-accent shadow" alt={user.name} />
              <div className="min-w-0">
                <p className="font-black text-sm truncate">{user.name}</p>
                <p className="text-[10px] text-accent font-black uppercase tracking-wider">{user.role}</p>
              </div>
            </div>
            {assignedWh && (
              <div className={`p-2 rounded-lg text-[10px] border mb-1 bg-white/40 border-white/60 dark:bg-slate-800/50 dark:border-slate-700/50 text-slate-600 dark:text-slate-400`}>
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
          /* Collapsed user area */
          <div className="flex flex-col items-center py-3 border-b border-white/20 dark:border-white/5 shrink-0 gap-2">
            <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=2563eb&color=fff`}
              className="w-9 h-9 rounded-full border-2 border-accent shadow" alt={user.name} title={user.name} />
            <button
              onClick={toggleTheme}
              className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-all ${isDark ? 'bg-slate-800/50 border-white/10 text-yellow-400' : 'bg-white/50 border-white/60 text-slate-600'}`}
              title={isDark ? 'Light Mode' : 'Dark Mode'}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all"
              title="Đăng xuất"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}

        {/* Navigation */}
        <nav className="px-2 py-2 space-y-0.5 flex-1 overflow-y-auto">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              title={collapsed ? item.label : undefined}
              className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                ? 'bg-accent/90 text-white shadow-lg shadow-emerald-500/20 backdrop-blur-md border border-white/20'
                : `text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50`
                }`}
            >
              <div className={`flex items-center ${collapsed ? '' : ''}`}>
                <item.icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform group-hover:scale-110`} />
                {!collapsed && <span className="font-bold text-sm">{item.label}</span>}
              </div>
              {!collapsed && item.badge && (
                <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 ${(item as any).badgeColor || 'bg-red-500'} ${isDark ? 'ring-slate-900' : 'ring-primary'}`}>
                  {item.badge}
                </span>
              )}
              {collapsed && item.badge && (
                <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </NavLink>
          ))}

          {/* Chat Link */}
          <div className="mt-2 pt-2 border-t border-white/10 dark:border-slate-700/50">
            <NavLink
              to="/chat"
              title={collapsed ? 'Tin nhắn' : undefined}
              className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center' : 'justify-between'} ${collapsed ? 'px-2' : 'px-4'} py-2.5 rounded-xl transition-all group ${isActive
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20 border border-white/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/50'
                }`}
            >
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
