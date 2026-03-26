import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, X, Package, Users, ArrowLeftRight, ClipboardCheck, MessageSquare,
  FileText, Search, Briefcase, DollarSign, Calendar
} from 'lucide-react';

interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  shadow: string;
  route?: string;
  action?: () => void;
}

const QuickActionFab: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const fabRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openSearch = () => {
    setIsOpen(false);
    // Trigger Ctrl+K programmatically
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  };

  const actions: QuickAction[] = [
    {
      id: 'search',
      label: 'Tìm kiếm nhanh',
      icon: <Search size={18} />,
      color: 'bg-slate-600',
      shadow: 'shadow-slate-600/30',
      action: openSearch,
    },
    {
      id: 'new-transaction',
      label: 'Tạo phiếu kho',
      icon: <ArrowLeftRight size={18} />,
      color: 'bg-blue-500',
      shadow: 'shadow-blue-500/30',
      route: '/operations',
    },
    {
      id: 'new-employee',
      label: 'Thêm nhân viên',
      icon: <Users size={18} />,
      color: 'bg-teal-500',
      shadow: 'shadow-teal-500/30',
      route: '/hrm/employees',
    },
    {
      id: 'new-request',
      label: 'Tạo yêu cầu vật tư',
      icon: <ClipboardCheck size={18} />,
      color: 'bg-amber-500',
      shadow: 'shadow-amber-500/30',
      route: '/requests',
    },
    {
      id: 'new-workflow',
      label: 'Tạo quy trình mới',
      icon: <Briefcase size={18} />,
      color: 'bg-violet-500',
      shadow: 'shadow-violet-500/30',
      route: '/wf',
    },
    {
      id: 'payroll',
      label: 'Bảng lương',
      icon: <DollarSign size={18} />,
      color: 'bg-emerald-500',
      shadow: 'shadow-emerald-500/30',
      route: '/hrm/payroll',
    },
  ];

  const handleAction = (action: QuickAction) => {
    setIsOpen(false);
    if (action.action) {
      action.action();
    } else if (action.route) {
      navigate(action.route);
    }
  };

  return (
    <div ref={fabRef} className="fixed bottom-6 right-6 z-[90] hidden lg:block">
      {/* Backdrop when open */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px] -z-10" onClick={() => setIsOpen(false)} />
      )}

      {/* Action items */}
      <div className={`absolute bottom-16 right-0 flex flex-col-reverse items-end gap-2 transition-all duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        {actions.map((action, idx) => (
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
              {action.icon}
            </div>
          </button>
        ))}
      </div>

      {/* FAB Button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 ${
          isOpen
            ? 'bg-slate-800 dark:bg-slate-700 rotate-45 shadow-slate-800/40'
            : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/40'
        }`}
        title="Hành động nhanh"
      >
        <Plus size={24} strokeWidth={2.5} className="transition-transform duration-300" />
      </button>

      {/* Pulse ring when closed */}
      {!isOpen && (
        <div className="absolute inset-0 rounded-2xl bg-indigo-500/30 animate-ping pointer-events-none" style={{ animationDuration: '3s' }} />
      )}
    </div>
  );
};

export default QuickActionFab;
