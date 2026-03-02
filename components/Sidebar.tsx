
import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, Package, ArrowLeftRight, ClipboardCheck, 
  History, Settings, LogOut, Menu, FileText, UserCircle 
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role, TransactionStatus, RequestStatus } from '../types';

interface SidebarProps {
  isOpen: boolean;
  toggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, toggle }) => {
  const { user, logout, warehouses, transactions, requests, appSettings } = useApp();

  const pendingTxCount = useMemo(() => {
    if (user.role === Role.ADMIN) {
      return transactions.filter(t => t.status === TransactionStatus.PENDING).length;
    }
    if (user.role === Role.KEEPER) {
      // 1. Phiếu do mình gửi đang chờ Admin duyệt
      const mySent = transactions.filter(t => t.requesterId === user.id && t.status === TransactionStatus.PENDING).length;
      
      // 2. PHIẾU NHẬP/CHUYỂN VỀ KHO MÌNH: Đã được Admin duyệt (APPROVED) nhưng mình chưa bấm "Xác nhận nhận hàng"
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
      
      // Các đề xuất cần hành động từ kho mình (ví dụ: Admin đã duyệt đề xuất, cần mình xuất kho đi)
      const needAction = requests.filter(r => 
        (r.status === RequestStatus.APPROVED && r.sourceWarehouseId === user.assignedWarehouseId) ||
        (r.status === RequestStatus.IN_TRANSIT && r.siteWarehouseId === user.assignedWarehouseId)
      ).length;
      
      return myReq + needAction;
    }
    return 0;
  }, [requests, user]);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/requests', icon: FileText, label: 'Đề xuất vật tư', badge: pendingReqCount > 0 ? pendingReqCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/inventory', icon: Package, label: 'Kho & Vật tư' },
    { to: '/operations', icon: ArrowLeftRight, label: 'Nhập / Xuất', badge: pendingTxCount > 0 ? pendingTxCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' },
    { to: '/reports', icon: History, label: 'Báo cáo' },
    { to: '/settings', icon: Settings, label: 'Cài đặt' },
  ];

  const filteredNavItems = navItems.filter(item => !item.roles || item.roles.includes(user.role));

  const assignedWh = warehouses.find(w => w.id === user.assignedWarehouseId);

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={toggle} />}
      <aside className={`fixed top-0 left-0 z-30 h-screen w-64 bg-primary text-white transition-transform duration-300 lg:translate-x-0 lg:static ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center space-x-2 h-16 px-6 bg-slate-900 border-b border-slate-700">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-bold text-xs uppercase">
            {appSettings.name.slice(0, 2)}
          </div>
          <span className="text-xl font-bold tracking-tight truncate">{appSettings.name}</span>
        </div>

        <div className="p-4 border-b border-slate-700 mb-2">
           <div className="flex items-center space-x-3 mb-3">
             <img src={user.avatar} className="w-10 h-10 rounded-full border-2 border-accent" />
             <div className="min-w-0">
               <p className="font-bold text-sm truncate">{user.name}</p>
               <p className="text-[10px] text-accent font-bold uppercase">{user.role}</p>
             </div>
           </div>
           {assignedWh && (
             <div className="bg-slate-800 p-2 rounded text-[10px] text-slate-400 border border-slate-700 mb-2">
                <span className="font-black text-slate-300 block mb-0.5 uppercase tracking-tighter">Kho quản lý trực tiếp:</span>
                <span className="truncate block font-bold text-white">{assignedWh.name}</span>
             </div>
           )}
           <button 
             onClick={() => {
               logout();
               window.location.href = '/login';
             }}
             className="w-full mt-4 flex items-center justify-center gap-2 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
           >
             <LogOut size={14} /> Đăng xuất
           </button>
        </div>

        <nav className="px-3 py-2 space-y-1">
          {filteredNavItems.map((item) => (
            <NavLink 
              key={item.to} 
              to={item.to} 
              className={({ isActive }) => `flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${isActive ? 'bg-accent text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              <div className="flex items-center">
                <item.icon className="w-5 h-5 mr-3" />
                <span className="font-bold text-sm">{item.label}</span>
              </div>
              {item.badge && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black text-white shadow-sm ring-2 ring-primary">
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
