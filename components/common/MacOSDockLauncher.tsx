import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Bot,
  Briefcase,
  DollarSign,
  FileSignature,
  GitBranch,
  HardDrive,
  IdCard,
  Inbox,
  Landmark,
  Package,
  ShoppingCart,
  Zap,
} from 'lucide-react';
import { User } from '../../types';
import { canViewModule } from '../../lib/permissions/permissionService';

export interface DockModuleItem {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
  glowColor: string;
}

const DOCK_MODULE_DEFS: DockModuleItem[] = [
  {
    key: 'DA',
    label: 'Dự án',
    shortLabel: 'DA',
    description: 'Tiến độ, BOQ & thi công',
    route: '/da',
    icon: BarChart3,
    gradient: 'from-emerald-500 to-teal-600',
    glowColor: 'rgba(16, 185, 129, 0.4)',
  },
  {
    key: 'WMS',
    label: 'Vật tư & Kho',
    shortLabel: 'KHO',
    description: 'Tồn kho, nhập xuất',
    route: '/inventory',
    icon: Package,
    gradient: 'from-amber-500 to-orange-600',
    glowColor: 'rgba(245, 158, 11, 0.4)',
  },
  {
    key: 'WF',
    label: 'Quy trình',
    shortLabel: 'QT',
    description: 'Phê duyệt & luân chuyển',
    route: '/wf',
    icon: GitBranch,
    gradient: 'from-indigo-500 to-purple-600',
    glowColor: 'rgba(99, 102, 241, 0.4)',
  },
  {
    key: 'HRM',
    label: 'Nhân sự',
    shortLabel: 'NS',
    description: 'Chấm công & hồ sơ',
    route: '/hrm/employees',
    icon: Briefcase,
    gradient: 'from-rose-500 to-pink-600',
    glowColor: 'rgba(244, 63, 94, 0.4)',
  },
  {
    key: 'PROCUREMENT',
    label: 'Mua hàng',
    shortLabel: 'MH',
    description: 'Đơn PO & Giao nhận',
    route: '/procurement',
    icon: ShoppingCart,
    gradient: 'from-cyan-500 to-blue-600',
    glowColor: 'rgba(6, 182, 212, 0.4)',
  },
  {
    key: 'TS',
    label: 'Tài sản',
    shortLabel: 'TS',
    description: 'Theo dõi & cấp phát',
    route: '/ts/dashboard',
    icon: Landmark,
    gradient: 'from-sky-500 to-blue-600',
    glowColor: 'rgba(14, 165, 233, 0.4)',
  },
  {
    key: 'HD',
    label: 'Hợp đồng',
    shortLabel: 'HĐ',
    description: 'Đối tác & hợp đồng',
    route: '/hd/partners',
    icon: FileSignature,
    gradient: 'from-lime-500 to-emerald-600',
    glowColor: 'rgba(132, 204, 22, 0.4)',
  },
  {
    key: 'EX',
    label: 'Chi phí',
    shortLabel: 'CP',
    description: 'Ngân sách & chứng từ chi',
    route: '/expense',
    icon: DollarSign,
    gradient: 'from-purple-500 to-pink-600',
    glowColor: 'rgba(168, 85, 247, 0.4)',
  },
  {
    key: 'RQ',
    label: 'Yêu cầu',
    shortLabel: 'RQ',
    description: 'Ticket hỗ trợ',
    route: '/rq',
    icon: Inbox,
    gradient: 'from-violet-500 to-fuchsia-600',
    glowColor: 'rgba(139, 92, 246, 0.4)',
  },
  {
    key: 'STORAGE',
    label: 'Kho dữ liệu',
    shortLabel: 'DL',
    description: 'Lưu trữ tài liệu',
    route: '/storage',
    icon: HardDrive,
    gradient: 'from-blue-500 to-indigo-600',
    glowColor: 'rgba(59, 130, 246, 0.4)',
  },
  {
    key: 'KB',
    label: 'Kho Kiến thức',
    shortLabel: 'KT',
    description: 'Quy trình & tài liệu kỹ thuật',
    route: '/knowledge-base',
    icon: BookOpen,
    gradient: 'from-teal-500 to-cyan-600',
    glowColor: 'rgba(20, 184, 166, 0.4)',
  },
  {
    key: 'AI',
    label: 'Trợ lý AI',
    shortLabel: 'AI',
    description: 'Phân tích tự động',
    route: '/ai',
    icon: Bot,
    gradient: 'from-pink-500 to-rose-600',
    glowColor: 'rgba(236, 72, 153, 0.4)',
  },
  {
    key: 'EP',
    label: 'Hồ sơ NV',
    shortLabel: 'EP',
    description: 'Thông tin cá nhân',
    route: '/ep',
    icon: IdCard,
    gradient: 'from-orange-500 to-amber-600',
    glowColor: 'rgba(249, 115, 22, 0.4)',
  },
];

interface MacOSDockLauncherProps {
  user: User;
  taskCounts?: Record<string, number>;
  isEnabled?: boolean;
}

export const MacOSDockLauncher: React.FC<MacOSDockLauncherProps> = ({
  user,
  taskCounts = {},
  isEnabled = true,
}) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [bouncingKey, setBouncingKey] = useState<string | null>(null);
  const [mouseY, setMouseY] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Filter modules user is authorized to view
  const userModules = useMemo(() => {
    return DOCK_MODULE_DEFS.filter(m => canViewModule(user, m.key));
  }, [user]);

  const handleMouseEnterTrigger = () => {
    if (!isEnabled) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setIsOpen(true);
  };

  const handleMouseLeaveDock = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setHoveredKey(null);
      setMouseY(null);
    }, 800);
  };

  const handleMouseMoveDock = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMouseY(e.clientY - rect.top);
    }
  };

  const handleLaunchModule = (module: DockModuleItem) => {
    setBouncingKey(module.key);
    setTimeout(() => {
      setBouncingKey(null);
      setIsOpen(false);
      navigate(module.route);
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!isEnabled || userModules.length === 0) return null;

  return (
    <>
      {/* Backdrop when dock is open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[84]"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Floating Edge Trigger Handle Button on Right Edge when closed */}
      {!isOpen && (
        <div
          onMouseEnter={handleMouseEnterTrigger}
          onClick={handleMouseEnterTrigger}
          className="fixed right-0 top-1/3 z-[80] -translate-y-1/2 cursor-pointer flex items-center gap-1.5 rounded-l-2xl bg-gradient-to-l from-slate-900 to-blue-950 px-2.5 py-2.5 border border-r-0 border-blue-500/40 shadow-xl text-blue-400 hover:scale-110 transition-transform duration-200"
          title="Mở macOS Dock Ứng Dụng (Cạnh phải)"
        >
          <Zap size={10} className="animate-pulse text-blue-400 shrink-0" />
        </div>
      )}

      {/* Floating Glassmorphic macOS Dock Bar at Right Edge (z-[85]) */}
      <div
        ref={containerRef}
        onMouseEnter={handleMouseEnterTrigger}
        onMouseLeave={handleMouseLeaveDock}
        onMouseMove={handleMouseMoveDock}
        style={{
          transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease',
        }}
        className={`fixed right-3 top-1/2 z-[85] -translate-y-1/2 ${isOpen
          ? 'translate-x-0 opacity-100 pointer-events-auto'
          : 'translate-x-full opacity-0 pointer-events-none'
          }`}
      >
        <div className="relative flex flex-col gap-1.5 rounded-3xl border border-white/20 bg-slate-900/95 p-3 shadow-[0_25px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl dark:border-slate-700/80 dark:bg-slate-950/95 min-w-[210px] max-h-[88vh] overflow-y-auto custom-scrollbar">
          {/* Top macOS Style Header */}
          <div className="flex items-center justify-between pb-1 px-1 border-b border-slate-800">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-blue-400">
              <Zap size={12} className="animate-pulse text-blue-400" /> Ứng dụng
            </div>
            <span className="text-[9px] font-extrabold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded-md">
              {userModules.length} apps
            </span>
          </div>

          {/* Module App List: Displays Icon AND Name Label together */}
          <div className="flex flex-col gap-1.5 py-1">
            {userModules.map((mod, index) => {
              const Icon = mod.icon;
              const isHovered = hoveredKey === mod.key;
              const isBouncing = bouncingKey === mod.key;
              const count = taskCounts[mod.key] || 0;

              // Calculate Fisheye Magnification Scale based on vertical mouse position
              let scale = 1;
              if (mouseY !== null && containerRef.current) {
                const itemCenterY = 45 + index * 44;
                const distance = Math.abs(mouseY - itemCenterY);
                if (distance < 90) {
                  scale = 1 + (1 - distance / 90) * 0.08;
                }
              }

              return (
                <div
                  key={mod.key}
                  onMouseEnter={() => setHoveredKey(mod.key)}
                  onClick={() => handleLaunchModule(mod)}
                  style={{
                    transform: `scale(${scale})`,
                    transition: 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)',
                  }}
                  className={`group flex items-center gap-2.5 rounded-2xl px-2.5 py-2 cursor-pointer select-none transition-all duration-200 border ${isHovered
                    ? 'border-blue-400/50 bg-blue-950/80 shadow-lg shadow-blue-500/20 text-white -translate-x-1'
                    : 'border-slate-800/80 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800/90 text-slate-200'
                    }`}
                >
                  {/* Icon Card */}
                  <div
                    className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${mod.gradient} text-white shadow-md transition-transform duration-200 ${isBouncing ? 'animate-bounce' : ''
                      }`}
                  >
                    <Icon size={18} />
                  </div>

                  {/* App Name Label & Description */}
                  <div className="flex flex-col min-w-0 pr-1">
                    <span className="text-xs font-extrabold tracking-tight truncate">
                      {mod.label}
                    </span>
                    <span className="text-[9px] font-medium text-slate-400 truncate leading-3">
                      {mod.description}
                    </span>
                  </div>

                  {/* Task Counter Badge */}
                  {count > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white shadow-sm animate-pulse">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};

export default MacOSDockLauncher;
