import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { GripVertical, Moon, PanelsTopLeft, Search, Settings, Sun, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import NotificationCenter from '../NotificationCenter';
import { navigationModulesFor, useModuleNavigation, type ModuleNavItem } from '../Sidebar';
import UiModeSwitch from './UiModeSwitch';
import { canAccessRoute } from '../../lib/routeAccess';
import { CENTER_ROUTE } from '../../lib/center/centerPermissions';
import { useMineWorkItems } from '../../lib/center/workItemsStore';
import { DEFAULT_AVATAR_URL } from '../../lib/defaultAvatar';
import { openGlobalSearch, searchShortcutLabel } from '../../lib/search/openGlobalSearch';
import './center.css';

// Rail trái của giao diện Trung tâm điều hành (máy tính): cột hẹp, mỗi app = biểu tượng gradient như ở Home + tên
// đầy đủ bên dưới; Trung tâm điều hành đứng đầu kèm số việc chờ; công tắc giao diện ở góc dưới bên trái.
// Bấm một app → bung bảng chức năng bên trong app (cùng danh sách với thanh bên cũ); kéo thả để đổi thứ tự app
// (lưu chung với thanh bên cũ). Điện thoại vẫn dùng thanh bên kéo ra (Sidebar) như cũ.

const ORDER_KEY = 'sidebar_module_order';

/** "Tiến Thịnh" → "TT". */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'V';

const firstSegment = (path: string) => `/${path.split('?')[0].split('/').filter(Boolean)[0] || ''}`;

export interface RailModule { key: string; route: string; label: string; icon: LucideIcon; gradient: string; shadow: string }

const IconTile: React.FC<{ icon: LucideIcon; gradient: string; shadow: string; badge?: string | null }> = ({ icon: Icon, gradient, shadow, badge }) => (
  <span className={`vcc-rail-icon bg-gradient-to-br ${gradient} shadow-md ${shadow}`}>
    <Icon size={18} />
    {badge && <span className="vcc-rail-badge" aria-label={`${badge} việc chờ`}>{badge}</span>}
  </span>
);

/** Bảng chức năng của một app, bung từ đúng vị trí nút app (transform + opacity, hữu hạn). */
const AppFlyout: React.FC<{ module: RailModule; items: ModuleNavItem[]; top: number; pathname: string; onClose: () => void }> = ({ module, items, top, pathname, onClose }) => {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    panel.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const maxTop = typeof window !== 'undefined' ? Math.max(8, window.innerHeight - 64 - items.length * 44) : top;
  return (
    <>
      <div className="vcc-flyout-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className="vcc-flyout"
        data-open={open || undefined}
        role="dialog"
        aria-label={module.label}
        tabIndex={-1}
        style={{ top: Math.min(top, maxTop) }}
      >
        <div className="vcc-flyout-head">
          <IconTile icon={module.icon} gradient={module.gradient} shadow={module.shadow} />
          <span className="vcc-flyout-title">{module.label}</span>
          <button type="button" className="vcc-flyout-x" onClick={onClose} aria-label="Đóng"><X size={14} /></button>
        </div>
        <nav className="vcc-flyout-list" aria-label={`Chức năng ${module.label}`}>
          {items.map(item => {
            const ItemIcon = item.icon;
            const active = pathname === item.to;
            return (
              <NavLink key={item.to} to={item.to} end onClick={onClose} className="vcc-flyout-item" data-active={active || undefined}>
                {ItemIcon && <ItemIcon size={16} />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge ? <span className="vcc-flyout-badge">{item.badge}</span> : null}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </>
  );
};

/** Phần hiển thị của rail (bản thử dùng trực tiếp; app dùng CenterRail bên dưới để nối dữ liệu thật). */
export const CenterRailView: React.FC<{
  pathname: string;
  company: { name: string; logo?: string | null };
  modules: RailModule[];
  /** Chức năng bên trong từng app (đã lọc theo quyền). */
  navFor: (key: string) => ModuleNavItem[];
  onReorder: (keys: string[]) => void;
  badge: string | null;
  avatar: string;
  userName: string;
  isDark: boolean;
  notifications?: React.ReactNode;
  onNavigate: (to: string) => void;
  onToggleTheme: () => void;
  onProfile: () => void;
  onSettings?: () => void;
  onExitCenter: () => void;
}> = ({ pathname, company, modules, navFor, onReorder, badge, avatar, userName, isDark, notifications, onNavigate, onToggleTheme, onProfile, onSettings, onExitCenter }) => {
  const here = firstSegment(pathname);
  const [flyout, setFlyout] = useState<{ key: string; top: number } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const closeFlyout = useCallback(() => setFlyout(null), []);
  useEffect(() => { setFlyout(null); }, [pathname]);

  const segmentsOf = (module: RailModule) => new Set([firstSegment(module.route), ...navFor(module.key).map(item => firstSegment(item.to))]);
  const openApp = (module: RailModule, button: HTMLElement) => {
    const items = navFor(module.key);
    if (items.length <= 1) { setFlyout(null); onNavigate(items[0]?.to || module.route); return; }
    setFlyout(current => (current?.key === module.key ? null : { key: module.key, top: button.getBoundingClientRect().top - 6 }));
  };
  const drop = (target: string) => {
    if (!dragKey || dragKey === target) return;
    const keys = modules.map(module => module.key).filter(key => key !== dragKey);
    keys.splice(keys.indexOf(target), 0, dragKey);
    onReorder(keys);
  };
  const flyoutModule = flyout ? modules.find(module => module.key === flyout.key) : null;

  return (
    <nav className="vcc-rail hidden lg:flex" aria-label="Ứng dụng">
      <NavLink to={CENTER_ROUTE} className="vcc-rail-logo" title="Về Trung tâm điều hành" aria-label={`${company.name} — về Trung tâm điều hành`}>
        {company.logo ? <img src={company.logo} alt="" /> : <span>{initials(company.name)}</span>}
      </NavLink>
      <div className="vcc-rail-scroll">
        <NavLink to={CENTER_ROUTE} className="vcc-rail-item" data-active={here === CENTER_ROUTE || undefined} title="Trung tâm điều hành"
          aria-current={here === CENTER_ROUTE ? 'page' : undefined}>
          <IconTile icon={PanelsTopLeft} gradient="from-teal-500 to-cyan-600" shadow="shadow-teal-500/25" badge={badge} />
          <span className="vcc-rail-label">Trung tâm</span>
        </NavLink>
        <div className="vcc-rail-sep" />
        {modules.map(module => {
          const active = segmentsOf(module).has(here);
          return (
            <button
              key={module.key}
              type="button"
              className="vcc-rail-item"
              data-active={active || undefined}
              data-open={flyout?.key === module.key || undefined}
              data-dragging={dragKey === module.key || undefined}
              data-over={overKey === module.key && dragKey !== module.key ? true : undefined}
              title={`${module.label} — bấm để mở chức năng, kéo để đổi chỗ`}
              aria-haspopup="dialog"
              aria-expanded={flyout?.key === module.key}
              draggable
              onDragStart={event => { setDragKey(module.key); setFlyout(null); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', module.key); }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOverKey(module.key); }}
              onDragLeave={() => setOverKey(current => (current === module.key ? null : current))}
              onDrop={event => { event.preventDefault(); drop(module.key); setDragKey(null); setOverKey(null); }}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              onClick={event => openApp(module, event.currentTarget)}
            >
              <IconTile icon={module.icon} gradient={module.gradient} shadow={module.shadow} />
              <span className="vcc-rail-label">{module.label}</span>
              <GripVertical size={11} className="vcc-rail-grip" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="vcc-rail-foot">
        <button type="button" className="vcc-rail-tool" onClick={() => openGlobalSearch()} title={`Tìm kiếm (${searchShortcutLabel()})`} aria-label="Tìm kiếm">
          <Search size={16} />
        </button>
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
      {flyout && flyoutModule && (
        <AppFlyout module={flyoutModule} items={navFor(flyoutModule.key)} top={flyout.top} pathname={pathname} onClose={closeFlyout} />
      )}
    </nav>
  );
};

const readOrder = (): string[] => {
  try { const value = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
};

const CenterRail: React.FC<{ onExitCenter: () => void }> = ({ onExitCenter }) => {
  const { user, appSettings } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navFor = useModuleNavigation();
  const [order, setOrder] = useState<string[]>(readOrder);
  const modules = useMemo(() => {
    const allowed = navigationModulesFor(user);
    if (order.length === 0) return allowed;
    const rank = (key: string) => { const index = order.indexOf(key); return index < 0 ? order.length : index; };
    return [...allowed].sort((a, b) => rank(a.key) - rank(b.key));
  }, [user, order]);
  const reorder = useCallback((keys: string[]) => {
    setOrder(keys);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch { /* chỉ giữ trong phiên */ }
  }, []);
  const mine = useMineWorkItems(true);
  const badge = mine && mine.total > 0 ? (mine.total > 99 ? '99+' : String(mine.total)) : null;
  return (
    <CenterRailView
      pathname={pathname}
      company={{ name: appSettings.name, logo: appSettings.logo }}
      modules={modules}
      navFor={key => navFor(key as Parameters<typeof navFor>[0])}
      onReorder={reorder}
      badge={badge}
      avatar={user.avatar || DEFAULT_AVATAR_URL}
      userName={user.name}
      isDark={isDark}
      notifications={<NotificationCenter userId={user?.id} mode="desktop" />}
      onNavigate={to => navigate(to)}
      onToggleTheme={toggleTheme}
      onProfile={() => navigate('/my-profile')}
      onSettings={canAccessRoute(user, '/settings') ? () => navigate('/settings') : undefined}
      onExitCenter={onExitCenter}
    />
  );
};

export default CenterRail;
