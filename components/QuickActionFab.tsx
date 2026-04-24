import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, Package, Users, ArrowLeftRight, ClipboardCheck,
  Search, Briefcase, DollarSign, Settings, GripVertical,
  Eye, EyeOff, RotateCcw, BarChart3, Calendar, Landmark,
  FileText, Inbox, GitBranch, CalendarOff, MapPin, HardDrive,
  CheckCircle
} from 'lucide-react';

// === All available actions (master catalog) ===
interface ActionDef {
  id: string;
  label: string;
  iconName: string;
  color: string;
  shadow: string;
  route?: string;
  isSpecial?: boolean; // for non-route actions like search
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Search: <Search size={18} />,
  ArrowLeftRight: <ArrowLeftRight size={18} />,
  Users: <Users size={18} />,
  ClipboardCheck: <ClipboardCheck size={18} />,
  Briefcase: <Briefcase size={18} />,
  DollarSign: <DollarSign size={18} />,
  Package: <Package size={18} />,
  BarChart3: <BarChart3 size={18} />,
  Calendar: <Calendar size={18} />,
  Landmark: <Landmark size={18} />,
  FileText: <FileText size={18} />,
  Inbox: <Inbox size={18} />,
  GitBranch: <GitBranch size={18} />,
  CalendarOff: <CalendarOff size={18} />,
  MapPin: <MapPin size={18} />,
  HardDrive: <HardDrive size={18} />,
  Settings: <Settings size={18} />,
};

const ALL_ACTIONS: ActionDef[] = [
  { id: 'search', label: 'Tìm kiếm nhanh', iconName: 'Search', color: 'bg-slate-600', shadow: 'shadow-slate-600/30', isSpecial: true },
  { id: 'new-transaction', label: 'Tạo phiếu kho', iconName: 'ArrowLeftRight', color: 'bg-blue-500', shadow: 'shadow-blue-500/30', route: '/operations' },
  { id: 'new-employee', label: 'Thêm nhân viên', iconName: 'Users', color: 'bg-teal-500', shadow: 'shadow-teal-500/30', route: '/hrm/employees' },
  { id: 'new-request', label: 'Tạo yêu cầu vật tư', iconName: 'ClipboardCheck', color: 'bg-amber-500', shadow: 'shadow-amber-500/30', route: '/requests' },
  { id: 'new-workflow', label: 'Tạo quy trình mới', iconName: 'Briefcase', color: 'bg-violet-500', shadow: 'shadow-violet-500/30', route: '/wf' },
  { id: 'payroll', label: 'Bảng lương', iconName: 'DollarSign', color: 'bg-emerald-500', shadow: 'shadow-emerald-500/30', route: '/hrm/payroll' },
  { id: 'inventory', label: 'Tồn kho', iconName: 'Package', color: 'bg-green-500', shadow: 'shadow-green-500/30', route: '/inventory' },
  { id: 'dashboard', label: 'Dashboard Kho', iconName: 'BarChart3', color: 'bg-indigo-500', shadow: 'shadow-indigo-500/30', route: '/dashboard' },
  { id: 'attendance', label: 'Chấm công', iconName: 'Calendar', color: 'bg-cyan-500', shadow: 'shadow-cyan-500/30', route: '/hrm/attendance' },
  { id: 'leave', label: 'Nghỉ phép', iconName: 'CalendarOff', color: 'bg-pink-500', shadow: 'shadow-pink-500/30', route: '/hrm/leave' },
  { id: 'asset', label: 'Tài sản', iconName: 'Landmark', color: 'bg-rose-500', shadow: 'shadow-rose-500/30', route: '/ts/dashboard' },
  { id: 'project', label: 'Dự án', iconName: 'GitBranch', color: 'bg-orange-500', shadow: 'shadow-orange-500/30', route: '/da' },
  { id: 'expense', label: 'Chi phí', iconName: 'BarChart3', color: 'bg-red-500', shadow: 'shadow-red-500/30', route: '/expense' },
  { id: 'settings', label: 'Cài đặt', iconName: 'Settings', color: 'bg-gray-500', shadow: 'shadow-gray-500/30', route: '/settings' },
  { id: 'contract', label: 'Hợp đồng LĐ', iconName: 'FileText', color: 'bg-sky-500', shadow: 'shadow-sky-500/30', route: '/hrm/contracts' },
  { id: 'rq-dashboard', label: 'Yêu cầu nội bộ', iconName: 'Inbox', color: 'bg-lime-600', shadow: 'shadow-lime-600/30', route: '/rq' },
];

const DEFAULT_ENABLED = ['search', 'new-transaction', 'new-employee', 'new-request', 'new-workflow', 'payroll'];
const STORAGE_KEY = 'vioo_fab_actions';

const QuickActionFab: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [enabledIds, setEnabledIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_ENABLED;
    } catch { return DEFAULT_ENABLED; }
  });

  const navigate = useNavigate();
  const location = useLocation();

  // Detect if we're on the AI chat page to shrink the FAB
  const isAiPage = location.pathname.startsWith('/ai');
  const fabRef = useRef<HTMLDivElement>(null);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledIds));
  }, [enabledIds]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowSettings(false);
      }
    };
    if (isOpen || showSettings) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, showSettings]);

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
    setShowSettings(false);
  }, [location.pathname]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsOpen(false); setShowSettings(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build active actions from enabledIds
  const activeActions = useMemo(() => {
    return enabledIds
      .map(id => ALL_ACTIONS.find(a => a.id === id))
      .filter(Boolean) as ActionDef[];
  }, [enabledIds]);

  const openSearch = () => {
    setIsOpen(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  };

  const handleAction = (action: ActionDef) => {
    setIsOpen(false);
    if (action.isSpecial && action.id === 'search') {
      openSearch();
    } else if (action.route) {
      navigate(action.route);
    }
  };

  // Toggle action on/off
  const toggleAction = (id: string) => {
    setEnabledIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Move action up/down
  const moveAction = (id: string, dir: 'up' | 'down') => {
    setEnabledIds(prev => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const newArr = [...prev];
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= newArr.length) return prev;
      [newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]];
      return newArr;
    });
  };

  // Reset to defaults
  const resetDefaults = () => {
    setEnabledIds([...DEFAULT_ENABLED]);
  };

  return (
    <div ref={fabRef} className={`fixed z-[90] transition-all duration-300 ${isAiPage ? 'bottom-[72px] right-3 lg:bottom-6 lg:right-6' : 'bottom-[52px] right-3 lg:bottom-6 lg:right-6'}`}>
      {/* Backdrop */}
      {(isOpen || showSettings) && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px] -z-10" onClick={() => { setIsOpen(false); setShowSettings(false); }} />
      )}

      {/* === Settings Panel === */}
      {showSettings && (
        <div
          className="absolute bottom-16 right-0 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
          style={{ animation: 'fabSettingsIn 0.2s ease-out' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white">Tùy chỉnh thao tác nhanh</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Bật/tắt và sắp xếp các hành động</p>
            </div>
            <button
              onClick={resetDefaults}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition"
              title="Khôi phục mặc định"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          {/* Enabled list (reorderable) */}
          {enabledIds.length > 0 && (
            <div className="px-2 py-2 border-b border-slate-100 dark:border-slate-800">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1.5">
                Đang hiển thị ({enabledIds.length})
              </p>
              {enabledIds.map((id, idx) => {
                const action = ALL_ACTIONS.find(a => a.id === id);
                if (!action) return null;
                return (
                  <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 group">
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveAction(id, 'up')}
                        disabled={idx === 0}
                        className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition"
                      >
                        <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                      </button>
                      <button
                        onClick={() => moveAction(id, 'down')}
                        disabled={idx === enabledIds.length - 1}
                        className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition"
                      >
                        <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                    {/* Icon + Label */}
                    <div className={`w-7 h-7 rounded-lg ${action.color} text-white flex items-center justify-center shrink-0`}>
                      {ICON_MAP[action.iconName]}
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1 truncate">{action.label}</span>
                    {/* Remove */}
                    <button
                      onClick={() => toggleAction(id)}
                      className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                      title="Ẩn"
                    >
                      <EyeOff size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Available (disabled) actions */}
          <div className="px-2 py-2 max-h-48 overflow-y-auto">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1.5">
              Có thể thêm
            </p>
            {ALL_ACTIONS.filter(a => !enabledIds.includes(a.id)).map(action => (
              <button
                key={action.id}
                onClick={() => toggleAction(action.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition group"
              >
                <div className={`w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-400 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 group-hover:text-emerald-500 transition`}>
                  {ICON_MAP[action.iconName]}
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-1 text-left truncate">{action.label}</span>
                <Plus size={13} className="text-slate-300 group-hover:text-emerald-500 transition" />
              </button>
            ))}
            {ALL_ACTIONS.filter(a => !enabledIds.includes(a.id)).length === 0 && (
              <p className="text-[10px] text-slate-300 dark:text-slate-600 text-center py-3 italic">Đã thêm tất cả</p>
            )}
          </div>
        </div>
      )}

      {/* === Action items (normal menu) === */}
      {!showSettings && (
        <div className={`absolute bottom-16 right-0 flex flex-col-reverse items-end gap-2 transition-all duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {/* Settings gear at top of menu */}
          {isOpen && (
            <button
              onClick={() => { setIsOpen(false); setShowSettings(true); }}
              className="flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-2xl bg-white dark:bg-slate-800 text-slate-500 shadow-lg border border-slate-200 dark:border-slate-700 hover:scale-105 active:scale-95 transition-all duration-300"
              style={{
                transform: isOpen ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.8)',
                opacity: isOpen ? 1 : 0,
                transitionDelay: isOpen ? `${activeActions.length * 40}ms` : '0ms',
              }}
            >
              <span className="text-[10px] font-bold whitespace-nowrap">Tùy chỉnh</span>
              <Settings size={14} />
            </button>
          )}

          {activeActions.map((action, idx) => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              className={`flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-2xl text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 group ${action.color} ${action.shadow}`}
              style={{
                transform: isOpen ? 'translateY(0) scale(1)' : `translateY(${(idx + 1) * 12}px) scale(0.8)`,
                opacity: isOpen ? 1 : 0,
                transitionDelay: isOpen ? `${idx * 40}ms` : '0ms',
              }}
            >
              <span className="text-xs font-bold whitespace-nowrap">{action.label}</span>
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                {ICON_MAP[action.iconName]}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* FAB Button */}
      <button
        onClick={() => {
          if (showSettings) {
            setShowSettings(false);
          } else {
            setIsOpen(prev => !prev);
          }
        }}
        className={`flex items-center justify-center text-white shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 ${
          isAiPage ? 'w-10 h-10 rounded-xl' : 'w-11 h-11 lg:w-14 lg:h-14 rounded-2xl'
        } ${
          isOpen || showSettings
            ? 'bg-slate-800 dark:bg-slate-700 rotate-45 shadow-slate-800/40 opacity-100'
            : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/40 opacity-70 lg:opacity-100'
        }`}
        title="Hành động nhanh"
      >
        <Plus size={isAiPage ? 18 : 22} strokeWidth={2.5} className="transition-transform duration-300 lg:!w-6 lg:!h-6" />
      </button>

      {/* Pulse ring when closed (desktop only) */}
      {!isOpen && !showSettings && !isAiPage && (
        <div className="absolute inset-0 rounded-2xl bg-indigo-500/30 animate-ping pointer-events-none hidden lg:block" style={{ animationDuration: '3s' }} />
      )}

      {/* CSS */}
      <style>{`
        @keyframes fabSettingsIn {
          from { transform: translateY(10px) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default QuickActionFab;
