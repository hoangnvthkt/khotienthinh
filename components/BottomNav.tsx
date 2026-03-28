
import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, BarChart3, Landmark, Briefcase,
  GitBranch, Inbox, MoreHorizontal, Settings, Plus, X,
  GripVertical, EyeOff, RotateCcw, Users, DollarSign,
  ArrowLeftRight, Calendar, FileText, MessageCircle, Bot,
  CheckCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';

// === Master catalog of all available taskbar items ===
interface NavItem {
  key: string;
  to: string;
  iconName: string;
  label: string;
  shortLabel: string;
  matchPrefix: string;
  color: string;
}

const ICON_MAP: Record<string, React.FC<{ size?: number; strokeWidth?: number }>> = {
  LayoutDashboard, Package, BarChart3, Landmark, Briefcase,
  GitBranch, Inbox, MoreHorizontal, Users, DollarSign,
  ArrowLeftRight, Calendar, FileText, MessageCircle, Bot, Settings,
};

const ALL_NAV_ITEMS: NavItem[] = [
  { key: 'HOME', to: '/dashboard', iconName: 'LayoutDashboard', label: 'Tổng quan', shortLabel: 'Home', matchPrefix: '/dashboard', color: 'text-indigo-500' },
  { key: 'WMS', to: '/inventory', iconName: 'Package', label: 'Vật tư', shortLabel: 'VT', matchPrefix: '/inventory|/operations|/audit|/requests|/misa-export', color: 'text-emerald-500' },
  { key: 'HRM', to: '/hrm/employees', iconName: 'Users', label: 'Nhân sự', shortLabel: 'NS', matchPrefix: '/hrm', color: 'text-teal-500' },
  { key: 'DA', to: '/da', iconName: 'BarChart3', label: 'Dự án', shortLabel: 'DA', matchPrefix: '/da|/portfolio', color: 'text-orange-500' },
  { key: 'TS', to: '/ts/dashboard', iconName: 'Landmark', label: 'Tài sản', shortLabel: 'TS', matchPrefix: '/ts', color: 'text-rose-500' },
  { key: 'WF', to: '/wf', iconName: 'GitBranch', label: 'Quy trình', shortLabel: 'QT', matchPrefix: '/wf', color: 'text-violet-500' },
  { key: 'RQ', to: '/rq', iconName: 'Inbox', label: 'Yêu cầu', shortLabel: 'RQ', matchPrefix: '/rq', color: 'text-cyan-500' },
  { key: 'EX', to: '/expense', iconName: 'DollarSign', label: 'Chi phí', shortLabel: 'CP', matchPrefix: '/expense', color: 'text-blue-500' },
  { key: 'OPS', to: '/operations', iconName: 'ArrowLeftRight', label: 'Phiếu kho', shortLabel: 'PK', matchPrefix: '/operations', color: 'text-sky-500' },
  { key: 'PAY', to: '/hrm/payroll', iconName: 'DollarSign', label: 'Bảng lương', shortLabel: 'BL', matchPrefix: '/hrm/payroll', color: 'text-green-500' },
  { key: 'ATT', to: '/hrm/attendance', iconName: 'Calendar', label: 'Chấm công', shortLabel: 'CC', matchPrefix: '/hrm/attendance', color: 'text-amber-500' },
  { key: 'CHAT', to: '/chat', iconName: 'MessageCircle', label: 'Tin nhắn', shortLabel: 'Chat', matchPrefix: '/chat', color: 'text-pink-500' },
  { key: 'SET', to: '/settings', iconName: 'Settings', label: 'Cài đặt', shortLabel: 'CĐ', matchPrefix: '/settings', color: 'text-slate-500' },
];

const DEFAULT_KEYS = ['HOME', 'WMS', 'HRM', 'DA', 'TS'];
const STORAGE_KEY = 'vioo_btm_nav';
const MAX_ITEMS = 5;

const BottomNav: React.FC = () => {
  const { user } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  // Load persisted order from localStorage
  const [enabledKeys, setEnabledKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_KEYS;
    } catch { return DEFAULT_KEYS; }
  });

  const [showEditor, setShowEditor] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const touchStartX = useRef(0);
  const touchStartIdx = useRef<number | null>(null);
  const navContainerRef = useRef<HTMLDivElement>(null);

  // Persist
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledKeys));
  }, [enabledKeys]);

  // Build visible nav items
  const visibleItems = useMemo(() => {
    return enabledKeys
      .map(key => ALL_NAV_ITEMS.find(n => n.key === key))
      .filter(Boolean) as NavItem[];
  }, [enabledKeys]);

  // Check active state
  const isActive = (pattern: string): boolean => {
    const prefixes = pattern.split('|');
    return prefixes.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
  };

  // Touch drag handlers for reordering in-place on the taskbar
  const handleTouchStart = useCallback((e: React.TouchEvent, idx: number) => {
    // Long press detection — use a timer
    touchStartX.current = e.touches[0].clientX;
    touchStartIdx.current = idx;
  }, []);

  const handleLongPress = useCallback((idx: number) => {
    setDragIdx(idx);
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(30);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragIdx === null || !navContainerRef.current) return;
    const x = e.touches[0].clientX;
    const container = navContainerRef.current;
    const items = container.querySelectorAll('[data-nav-item]');
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) {
        setDragOverIdx(i);
        break;
      }
    }
  }, [dragIdx]);

  const handleTouchEnd = useCallback(() => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setEnabledKeys(prev => {
        const newArr = [...prev];
        const [moved] = newArr.splice(dragIdx, 1);
        newArr.splice(dragOverIdx, 0, moved);
        return newArr;
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, dragOverIdx]);

  // Editor: toggle item
  const toggleItem = (key: string) => {
    setEnabledKeys(prev => {
      if (prev.includes(key)) {
        if (prev.length <= 2) return prev; // minimum 2 items
        return prev.filter(k => k !== key);
      } else {
        if (prev.length >= MAX_ITEMS) return prev; // max items
        return [...prev, key];
      }
    });
  };

  // Editor: move
  const moveItem = (key: string, dir: 'up' | 'down') => {
    setEnabledKeys(prev => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const newArr = [...prev];
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= newArr.length) return prev;
      [newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]];
      return newArr;
    });
  };

  // Reset
  const resetDefaults = () => setEnabledKeys([...DEFAULT_KEYS]);

  // Long press timer ref
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout>>();

  return (
    <>
      {/* Editor Modal */}
      {showEditor && (
        <div className="lg:hidden fixed inset-0 z-[110] flex items-end justify-center" onClick={() => setShowEditor(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl pb-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'slideUp 0.25s ease-out' }}
          >
            {/* Handle */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="px-5 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">Tùy chỉnh thanh điều hướng</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Tối đa {MAX_ITEMS} mục • nhấn giữ để kéo thả</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={resetDefaults} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition" title="Mặc định">
                  <RotateCcw size={14} />
                </button>
                <button onClick={() => setShowEditor(false)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Enabled items */}
            <div className="px-4 pb-3">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1 mb-2">
                Đang hiển thị ({enabledKeys.length}/{MAX_ITEMS})
              </p>
              <div className="space-y-1">
                {enabledKeys.map((key, idx) => {
                  const item = ALL_NAV_ITEMS.find(n => n.key === key);
                  if (!item) return null;
                  const IconComp = ICON_MAP[item.iconName] || LayoutDashboard;
                  return (
                    <div key={key} className="flex items-center gap-2 px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 group">
                      {/* Reorder */}
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveItem(key, 'up')} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20">
                          <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                        </button>
                        <button onClick={() => moveItem(key, 'down')} disabled={idx === enabledKeys.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20">
                          <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                      {/* Icon + Label */}
                      <div className={`w-8 h-8 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center ${item.color} shadow-sm shrink-0`}>
                        <IconComp size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate block">{item.label}</span>
                        <span className="text-[9px] text-slate-400 truncate block">{item.to}</span>
                      </div>
                      {/* Remove */}
                      <button
                        onClick={() => toggleItem(key)}
                        disabled={enabledKeys.length <= 2}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-20 transition"
                      >
                        <EyeOff size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Available items */}
            <div className="px-4 max-h-40 overflow-y-auto">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1 mb-2">
                Có thể thêm
              </p>
              <div className="space-y-1">
                {ALL_NAV_ITEMS.filter(n => !enabledKeys.includes(n.key)).map(item => {
                  const IconComp = ICON_MAP[item.iconName] || LayoutDashboard;
                  const disabled = enabledKeys.length >= MAX_ITEMS;
                  return (
                    <button
                      key={item.key}
                      onClick={() => toggleItem(item.key)}
                      disabled={disabled}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/10 disabled:opacity-30 transition group"
                    >
                      <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 group-hover:text-emerald-500 transition">
                        <IconComp size={16} />
                      </div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-1 text-left truncate">{item.label}</span>
                      <Plus size={13} className="text-slate-300 group-hover:text-emerald-500 transition" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="mx-4 mt-4 p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Xem trước</p>
              <div className="flex justify-around items-center">
                {visibleItems.map(item => {
                  const IconComp = ICON_MAP[item.iconName] || LayoutDashboard;
                  return (
                    <div key={item.key} className={`flex flex-col items-center ${item.color}`}>
                      <IconComp size={18} />
                      <span className="text-[8px] font-bold mt-0.5">{item.shortLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === Actual Bottom Nav === */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 btm-nav-safe">
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-100 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div ref={navContainerRef} className="flex justify-around items-center px-1 py-1">
            {visibleItems.map((item, idx) => {
              const active = isActive(item.matchPrefix);
              const IconComp = ICON_MAP[item.iconName] || LayoutDashboard;
              const isDragging = dragIdx === idx;
              const isDragOver = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;

              return (
                <NavLink
                  key={item.key}
                  to={item.to}
                  data-nav-item
                  onTouchStart={(e) => {
                    handleTouchStart(e, idx);
                    longPressTimerRef.current = setTimeout(() => handleLongPress(idx), 500);
                  }}
                  onTouchMove={(e) => {
                    // Cancel long press if user moves (scrolling)
                    if (dragIdx === null && longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                    }
                    handleTouchMove(e);
                  }}
                  onTouchEnd={() => {
                    clearTimeout(longPressTimerRef.current);
                    handleTouchEnd();
                  }}
                  className={`btm-nav-item flex flex-col items-center justify-center py-1.5 px-1 min-w-0 flex-1 transition-all active:scale-90 ${
                    active ? item.color : 'text-slate-400'
                  } ${isDragging ? 'opacity-40 scale-75' : ''} ${isDragOver ? 'scale-110' : ''}`}
                >
                  <div className={`btm-nav-icon w-6 h-6 flex items-center justify-center rounded-lg transition-all ${
                    active ? 'bg-current/10 scale-110' : ''
                  }`}>
                    <IconComp size={20} strokeWidth={active ? 2.5 : 1.8} />
                  </div>
                  <span className={`btm-nav-label text-[9px] mt-0.5 truncate max-w-full leading-tight ${
                    active ? 'font-black' : 'font-bold'
                  }`}>
                    {item.label}
                  </span>
                  {active && (
                    <div className="w-1 h-1 rounded-full bg-current mt-0.5 btm-nav-dot" />
                  )}
                </NavLink>
              );
            })}

            {/* More / Edit button — always last */}
            <button
              onClick={() => setShowEditor(true)}
              className="btm-nav-item flex flex-col items-center justify-center py-1.5 px-1 min-w-0 flex-1 text-slate-400 active:scale-90 transition-all"
            >
              <div className="btm-nav-icon w-6 h-6 flex items-center justify-center">
                <MoreHorizontal size={20} />
              </div>
              <span className="btm-nav-label text-[9px] font-bold mt-0.5 truncate max-w-full leading-tight">
                Thêm
              </span>
            </button>
          </div>
        </div>
      </nav>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
};

export default BottomNav;
