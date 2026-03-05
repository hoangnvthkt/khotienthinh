
import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, ArrowLeftRight, ClipboardCheck,
  History, Settings, LogOut, FileText, Sun, Moon, Bell
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { Role, TransactionStatus, RequestStatus } from '../types';

interface SidebarProps {
  isOpen: boolean;
  toggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, toggle }) => {
  const { user, logout, warehouses, transactions, requests, appSettings, items } = useApp();
  const { isDark, toggleTheme } = useTheme();

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

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/requests', icon: FileText, label: 'Đề xuất vật tư', badge: pendingReqCount > 0 ? pendingReqCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/inventory', icon: Package, label: 'Kho & Vật tư', badge: lowStockCount > 0 ? lowStockCount : null, badgeColor: 'bg-amber-500' },
    { to: '/operations', icon: ArrowLeftRight, label: 'Nhập / Xuất', badge: pendingTxCount > 0 ? pendingTxCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' },
    { to: '/reports', icon: History, label: 'Báo cáo' },
    { to: '/settings', icon: Settings, label: 'Cài đặt' },
  ];

  const filteredNavItems = navItems.filter(item => !item.roles || item.roles.includes(user.role));
  const assignedWh = warehouses.find(w => w.id === user.assignedWarehouseId);

  const sidebarBg = isDark ? 'bg-slate-900 border-slate-700' : 'bg-primary';

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm" onClick={toggle} />}
      <aside className={`fixed top-0 left-0 z-30 h-screen w-64 text-white transition-transform duration-300 lg:translate-x-0 lg:static ${sidebarBg} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className={`flex items-center space-x-3 h-16 px-6 border-b ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 border-slate-700'}`}>
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-black text-xs uppercase shadow-lg shadow-blue-500/40">
            {appSettings.name.slice(0, 2)}
          </div>
          <span className="text-lg font-black tracking-tight truncate">{appSettings.name}</span>
        </div>

        {/* User Info */}
        <div className={`p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-700'} mb-1`}>
          <div className="flex items-center space-x-3 mb-3">
            <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=2563eb&color=fff`}
              className="w-10 h-10 rounded-full border-2 border-accent shadow" alt={user.name} />
            <div className="min-w-0">
              <p className="font-black text-sm truncate">{user.name}</p>
              <p className="text-[10px] text-accent font-black uppercase tracking-wider">{user.role}</p>
            </div>
          </div>
          {assignedWh && (
            <div className={`p-2 rounded-lg text-[10px] border mb-2 ${isDark ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              <span className="font-black text-slate-300 block mb-0.5 uppercase tracking-tighter">Kho quản lý:</span>
              <span className="truncate block font-bold text-white">{assignedWh.name}</span>
            </div>
          )}

          {/* Theme Toggle & Logout */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={toggleTheme}
              className={`flex-none flex items-center justify-center w-9 h-9 rounded-lg border transition-all ${isDark ? 'bg-slate-800 border-slate-700 text-yellow-400 hover:bg-slate-700' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
              title={isDark ? 'Chuyển Light Mode' : 'Chuyển Dark Mode'}
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={() => { logout(); window.location.href = '/login'; }}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
            >
              <LogOut size={13} /> Đăng xuất
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 py-2 space-y-0.5">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `flex items-center justify-between px-4 py-3 rounded-xl transition-all group ${isActive
                ? 'bg-accent text-white shadow-lg shadow-blue-500/30'
                : `text-slate-400 hover:text-white ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-800'}`
                }`}
            >
              <div className="flex items-center">
                <item.icon className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" />
                <span className="font-bold text-sm">{item.label}</span>
              </div>
              {item.badge && (
                <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white shadow-sm ring-2 ${(item as any).badgeColor || 'bg-red-500'} ${isDark ? 'ring-slate-900' : 'ring-primary'}`}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
