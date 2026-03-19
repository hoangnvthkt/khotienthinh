
import React, { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, BarChart3, Landmark, Briefcase,
  GitBranch, Inbox, MoreHorizontal
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';

// Module-based bottom nav — shows app modules like a mobile dock
const MODULE_NAV = [
  { key: 'HOME', to: '/dashboard', icon: LayoutDashboard, label: 'Tổng quan', shortLabel: 'Home', matchPrefix: '/dashboard', color: 'text-indigo-500' },
  { key: 'WMS', to: '/inventory', icon: Package, label: 'Kho', shortLabel: 'Kho', matchPrefix: '/inventory|/operations|/audit|/requests|/misa-export', color: 'text-emerald-500' },
  { key: 'DA', to: '/da', icon: BarChart3, label: 'Dự án', shortLabel: 'DA', matchPrefix: '/da|/portfolio', color: 'text-orange-500' },
  { key: 'TS', to: '/ts/dashboard', icon: Landmark, label: 'Tài sản', shortLabel: 'TS', matchPrefix: '/ts', color: 'text-rose-500' },
  { key: 'MORE', to: '#', icon: MoreHorizontal, label: 'Thêm', shortLabel: '···', matchPrefix: '__none__', color: 'text-slate-400' },
];

const BottomNav: React.FC = () => {
  const { user } = useApp();
  const location = useLocation();

  // Filter modules by user permissions
  const filteredNav = useMemo(() => {
    return MODULE_NAV.filter(item => {
      if (item.key === 'HOME' || item.key === 'MORE') return true;
      if (user.role === Role.ADMIN) return true;
      if (!user.allowedModules || user.allowedModules.length === 0) return true;
      return user.allowedModules.includes(item.key as any);
    });
  }, [user.role, user.allowedModules]);

  // Check active state based on matchPrefix patterns
  const isActive = (pattern: string): boolean => {
    const prefixes = pattern.split('|');
    return prefixes.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
  };

  // Handle "More" button — open sidebar on mobile
  const handleMore = () => {
    const sidebarToggle = document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
    if (sidebarToggle) sidebarToggle.click();
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 btm-nav-safe">
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-100 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="flex justify-around items-center px-1 py-1">
          {filteredNav.map((item) => {
            const active = item.key !== 'MORE' && isActive(item.matchPrefix);

            return item.key === 'MORE' ? (
              <button
                key={item.key}
                onClick={handleMore}
                className="btm-nav-item flex flex-col items-center justify-center py-1.5 px-1 min-w-0 flex-1 text-slate-400 active:scale-90 transition-all"
              >
                <div className="btm-nav-icon w-6 h-6 flex items-center justify-center">
                  <item.icon size={20} />
                </div>
                <span className="btm-nav-label text-[9px] font-bold mt-0.5 truncate max-w-full leading-tight">
                  {item.label}
                </span>
              </button>
            ) : (
              <NavLink
                key={item.key}
                to={item.to}
                className={`btm-nav-item flex flex-col items-center justify-center py-1.5 px-1 min-w-0 flex-1 transition-all active:scale-90 ${
                  active ? item.color : 'text-slate-400'
                }`}
              >
                <div className={`btm-nav-icon w-6 h-6 flex items-center justify-center rounded-lg transition-all ${
                  active ? 'bg-current/10 scale-110' : ''
                }`}>
                  <item.icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                </div>
                <span className={`btm-nav-label text-[9px] mt-0.5 truncate max-w-full leading-tight ${
                  active ? 'font-black' : 'font-bold'
                }`}>
                  {item.label}
                </span>
                {/* Active indicator dot */}
                {active && (
                  <div className="w-1 h-1 rounded-full bg-current mt-0.5 btm-nav-dot" />
                )}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
