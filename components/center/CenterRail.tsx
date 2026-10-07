import React, { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Moon, PanelsTopLeft, Settings, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import NotificationCenter from '../NotificationCenter';
import { navigationModulesFor } from '../Sidebar';
import UiModeSwitch from './UiModeSwitch';
import { canAccessRoute } from '../../lib/routeAccess';
import { CENTER_ROUTE } from '../../lib/center/centerPermissions';
import { useMineWorkItems } from '../../lib/center/workItemsStore';
import { DEFAULT_AVATAR_URL } from '../../lib/defaultAvatar';
import './center.css';

// Rail trái của giao diện Trung tâm điều hành (máy tính): cột hẹp, mỗi app = biểu tượng gradient như ở Home + tên
// đầy đủ bên dưới; Trung tâm điều hành đứng đầu kèm số việc chờ; công tắc giao diện ở góc dưới bên trái.
// Điện thoại vẫn dùng thanh bên kéo ra (Sidebar) như cũ.

/** "Tiến Thịnh" → "TT". */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'V';

const firstSegment = (path: string) => `/${path.split('?')[0].split('/').filter(Boolean)[0] || ''}`;

const RailItem: React.FC<{ to: string; label: string; icon: LucideIcon; gradient: string; shadow: string; active: boolean; badge?: string | null }> = ({ to, label, icon: Icon, gradient, shadow, active, badge }) => (
  <NavLink to={to} className="vcc-rail-item" data-active={active || undefined} title={label} aria-current={active ? 'page' : undefined}>
    <span className={`vcc-rail-icon bg-gradient-to-br ${gradient} shadow-md ${shadow}`}>
      <Icon size={18} />
      {badge && <span className="vcc-rail-badge" aria-label={`${badge} việc chờ`}>{badge}</span>}
    </span>
    <span className="vcc-rail-label">{label}</span>
  </NavLink>
);

export interface RailModule { key: string; route: string; label: string; icon: LucideIcon; gradient: string; shadow: string }

/** Phần hiển thị của rail (bản thử dùng trực tiếp; app dùng CenterRail bên dưới để nối dữ liệu thật). */
export const CenterRailView: React.FC<{
  pathname: string;
  company: { name: string; logo?: string | null };
  modules: RailModule[];
  badge: string | null;
  avatar: string;
  userName: string;
  isDark: boolean;
  notifications?: React.ReactNode;
  onToggleTheme: () => void;
  onProfile: () => void;
  onSettings?: () => void;
  onExitCenter: () => void;
}> = ({ pathname, company, modules, badge, avatar, userName, isDark, notifications, onToggleTheme, onProfile, onSettings, onExitCenter }) => {
  const here = firstSegment(pathname);
  return (
    <nav className="vcc-rail hidden lg:flex" aria-label="Ứng dụng">
      <NavLink to={CENTER_ROUTE} className="vcc-rail-logo" title="Về Trung tâm điều hành" aria-label={`${company.name} — về Trung tâm điều hành`}>
        {company.logo ? <img src={company.logo} alt="" /> : <span>{initials(company.name)}</span>}
      </NavLink>
      <div className="vcc-rail-scroll">
        <RailItem to={CENTER_ROUTE} label="Trung tâm" icon={PanelsTopLeft} gradient="from-teal-500 to-cyan-600" shadow="shadow-teal-500/25"
          active={here === CENTER_ROUTE} badge={badge} />
        <div className="vcc-rail-sep" />
        {modules.map(module => (
          <RailItem key={module.key} to={module.route} label={module.label} icon={module.icon} gradient={module.gradient} shadow={module.shadow}
            active={here === firstSegment(module.route)} />
        ))}
      </div>
      <div className="vcc-rail-foot">
        {onSettings && (
          <button type="button" className="vcc-rail-tool" onClick={onSettings} title="Cài đặt" aria-label="Cài đặt"><Settings size={16} /></button>
        )}
        {notifications && <div className="vcc-rail-tool">{notifications}</div>}
        <button type="button" className="vcc-rail-tool" onClick={onToggleTheme} title={isDark ? 'Nền sáng' : 'Nền tối'} aria-label={isDark ? 'Chuyển nền sáng' : 'Chuyển nền tối'}>
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" className="vcc-rail-avatar" onClick={onProfile} title={`${userName} — hồ sơ của tôi`} aria-label="Hồ sơ của tôi">
          <img src={avatar} alt="" />
        </button>
        <UiModeSwitch variant="rail" active onChange={next => { if (!next) onExitCenter(); }} />
      </div>
    </nav>
  );
};

const CenterRail: React.FC<{ onExitCenter: () => void }> = ({ onExitCenter }) => {
  const { user, appSettings } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const modules = useMemo(() => navigationModulesFor(user), [user]);
  const mine = useMineWorkItems(true);
  const badge = mine && mine.total > 0 ? (mine.total > 99 ? '99+' : String(mine.total)) : null;
  return (
    <CenterRailView
      pathname={pathname}
      company={{ name: appSettings.name, logo: appSettings.logo }}
      modules={modules}
      badge={badge}
      avatar={user.avatar || DEFAULT_AVATAR_URL}
      userName={user.name}
      isDark={isDark}
      notifications={<NotificationCenter userId={user?.id} mode="desktop" />}
      onToggleTheme={toggleTheme}
      onProfile={() => navigate('/my-profile')}
      onSettings={canAccessRoute(user, '/settings') ? () => navigate('/settings') : undefined}
      onExitCenter={onExitCenter}
    />
  );
};

export default CenterRail;
