
import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, ArrowLeftRight,
  FileText, ClipboardCheck, History, FileSpreadsheet
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role, TransactionStatus, RequestStatus } from '../types';

const BottomNav: React.FC = () => {
  const { user, transactions, requests } = useApp();

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

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Home' },
    { to: '/requests', icon: FileText, label: 'Đề xuất', badge: pendingReqCount > 0 ? pendingReqCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/inventory', icon: Package, label: 'Kho' },
    { to: '/operations', icon: ArrowLeftRight, label: 'Nghiệp vụ', badge: pendingTxCount > 0 ? pendingTxCount : null, roles: [Role.ADMIN, Role.KEEPER] },
    { to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' },
    { to: '/misa-export', icon: FileSpreadsheet, label: 'MISA', roles: [Role.ADMIN, Role.ACCOUNTANT] },
  ];

  const filteredNavItems = navItems.filter(item => !item.roles || item.roles.includes(user.role));

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-2 py-1 flex justify-around items-center z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
      {filteredNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `flex flex-col items-center p-2 min-w-[64px] transition-colors relative ${isActive ? 'text-accent' : 'text-slate-400'}`}
        >
          <item.icon size={20} className="mb-1" />
          <span className="text-[10px] font-bold truncate max-w-full">{item.label}</span>
          {item.badge && (
            <span className="absolute top-1 right-3 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white shadow-sm ring-1 ring-white">
              {item.badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
};

export default BottomNav;
