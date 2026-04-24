import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { FileSignature, Building2, Users, HardHat } from 'lucide-react';

const HD_TABS = [
  { to: '/hd/supplier', label: 'Nhà cung cấp', icon: Building2, color: 'from-blue-500 to-indigo-600' },
  { to: '/hd/customer', label: 'Khách hàng', icon: Users, color: 'from-emerald-500 to-teal-600' },
  { to: '/hd/subcontractor', label: 'Thầu phụ', icon: HardHat, color: 'from-amber-500 to-orange-600' },
];

const ContractLayout: React.FC = () => {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <FileSignature className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 dark:text-white">Quản lý Hợp Đồng</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Theo dõi, lưu trữ và quản lý toàn bộ hợp đồng doanh nghiệp</p>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1.5">
          {HD_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = location.pathname === tab.to || location.pathname.startsWith(tab.to + '/');
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  isActive
                    ? `bg-gradient-to-r ${tab.color} text-white shadow-md`
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <Icon size={15} />
                <span>HĐ {tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
};

export default ContractLayout;
