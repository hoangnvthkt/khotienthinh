import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  ChevronRight,
  DollarSign,
  FileSignature,
  GitBranch,
  Grid,
  HardDrive,
  IdCard,
  Inbox,
  Landmark,
  Network,
  Package,
  ShoppingCart,
  Sparkles,
  Zap,
} from 'lucide-react';
import { User } from '../../types';
import { canViewModule } from '../../lib/permissions/permissionService';
import StatusBadge from './StatusBadge';

export interface ModuleAppDefinition {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
  glowColor: string;
  strokeColor: string;
  badgeTone?: 'rose' | 'amber' | 'blue' | 'emerald' | 'purple' | 'cyan';
}

const ALL_MODULE_DEFS: ModuleAppDefinition[] = [
  {
    key: 'DA',
    label: 'Dự án',
    shortLabel: 'DA',
    description: 'Quản lý tiến độ, BOQ & thi công',
    route: '/da',
    icon: BarChart3,
    gradient: 'from-emerald-500 to-teal-600',
    glowColor: 'rgba(16, 185, 129, 0.4)',
    strokeColor: '#10b981',
    badgeTone: 'emerald',
  },
  {
    key: 'WMS',
    label: 'Vật tư & Kho',
    shortLabel: 'KHO',
    description: 'Tồn kho, nhập xuất & điều chuyển',
    route: '/inventory',
    icon: Package,
    gradient: 'from-amber-500 to-orange-600',
    glowColor: 'rgba(245, 158, 11, 0.4)',
    strokeColor: '#f59e0b',
    badgeTone: 'amber',
  },
  {
    key: 'WF',
    label: 'Quy trình',
    shortLabel: 'QT',
    description: 'Phê duyệt & luân chuyển hồ sơ',
    route: '/wf',
    icon: GitBranch,
    gradient: 'from-indigo-500 to-purple-600',
    glowColor: 'rgba(99, 102, 241, 0.4)',
    strokeColor: '#6366f1',
    badgeTone: 'purple',
  },
  {
    key: 'HRM',
    label: 'Nhân sự',
    shortLabel: 'NS',
    description: 'Chấm công, nghỉ phép & hồ sơ',
    route: '/hrm/employees',
    icon: Briefcase,
    gradient: 'from-rose-500 to-pink-600',
    glowColor: 'rgba(244, 63, 94, 0.4)',
    strokeColor: '#f43f5e',
    badgeTone: 'rose',
  },
  {
    key: 'PROCUREMENT',
    label: 'Mua hàng',
    shortLabel: 'MH',
    description: 'Đơn mua hàng PO & Giao nhận',
    route: '/procurement',
    icon: ShoppingCart,
    gradient: 'from-cyan-500 to-blue-600',
    glowColor: 'rgba(6, 182, 212, 0.4)',
    strokeColor: '#06b6d4',
    badgeTone: 'cyan',
  },
  {
    key: 'TS',
    label: 'Tài sản',
    shortLabel: 'TS',
    description: 'Theo dõi, cấp phát & bảo dưỡng',
    route: '/ts/dashboard',
    icon: Landmark,
    gradient: 'from-sky-500 to-blue-600',
    glowColor: 'rgba(14, 165, 233, 0.4)',
    strokeColor: '#0ea5e9',
    badgeTone: 'blue',
  },
  {
    key: 'HD',
    label: 'Hợp đồng',
    shortLabel: 'HĐ',
    description: 'Quản lý đối tác & hợp đồng',
    route: '/hd/partners',
    icon: FileSignature,
    gradient: 'from-lime-500 to-emerald-600',
    glowColor: 'rgba(132, 204, 22, 0.4)',
    strokeColor: '#84cc16',
    badgeTone: 'emerald',
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
    strokeColor: '#a855f7',
    badgeTone: 'purple',
  },
  {
    key: 'RQ',
    label: 'Yêu cầu',
    shortLabel: 'RQ',
    description: 'Tạo & theo dõi ticket hỗ trợ',
    route: '/rq',
    icon: Inbox,
    gradient: 'from-violet-500 to-fuchsia-600',
    glowColor: 'rgba(139, 92, 246, 0.4)',
    strokeColor: '#8b5cf6',
    badgeTone: 'purple',
  },
  {
    key: 'STORAGE',
    label: 'Kho dữ liệu',
    shortLabel: 'DL',
    description: 'Lưu trữ & chia sẻ tài liệu',
    route: '/storage',
    icon: HardDrive,
    gradient: 'from-blue-500 to-indigo-600',
    glowColor: 'rgba(59, 130, 246, 0.4)',
    strokeColor: '#3b82f6',
    badgeTone: 'blue',
  },
  {
    key: 'KB',
    label: 'Kho Kiến thức',
    shortLabel: 'KT',
    description: 'Quy trình chuẩn & tài liệu kỹ thuật',
    route: '/knowledge-base',
    icon: BookOpen,
    gradient: 'from-teal-500 to-cyan-600',
    glowColor: 'rgba(20, 184, 166, 0.4)',
    strokeColor: '#14b8a6',
    badgeTone: 'cyan',
  },
  {
    key: 'AI',
    label: 'Trợ lý AI',
    shortLabel: 'AI',
    description: 'Phân tích & tự động hóa ERP',
    route: '/ai',
    icon: Bot,
    gradient: 'from-pink-500 to-rose-600',
    glowColor: 'rgba(236, 72, 153, 0.4)',
    strokeColor: '#ec4899',
    badgeTone: 'rose',
  },
  {
    key: 'EP',
    label: 'Hồ sơ NV',
    shortLabel: 'EP',
    description: 'Thông tin cá nhân & đãi ngộ',
    route: '/ep',
    icon: IdCard,
    gradient: 'from-orange-500 to-amber-600',
    glowColor: 'rgba(249, 115, 22, 0.4)',
    strokeColor: '#f97316',
    badgeTone: 'amber',
  },
];

interface NeuralAppHubProps {
  user: User;
  taskCounts?: Record<string, number>;
  totalPendingTasks?: number;
  roleLabels?: string[];
  todayFormatted?: string;
}

export const NeuralAppHub: React.FC<NeuralAppHubProps> = ({
  user,
  taskCounts = {},
  totalPendingTasks = 0,
  roleLabels = [],
  todayFormatted,
}) => {
  const navigate = useNavigate();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activeRippleKey, setActiveRippleKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'neural' | 'grid'>(() => {
    try {
      return (localStorage.getItem('home_app_hub_mode') as 'neural' | 'grid') || 'grid';
    } catch {
      return 'grid';
    }
  });

  const toggleViewMode = (mode: 'neural' | 'grid') => {
    setViewMode(mode);
    try {
      localStorage.setItem('home_app_hub_mode', mode);
    } catch {
      // ignore
    }
  };

  // Filter modules user is authorized to view
  const userModules = useMemo(() => {
    return ALL_MODULE_DEFS.filter(m => canViewModule(user, m.key));
  }, [user]);

  // Calculate layout coordinates for Neural Radial Graph
  const viewBoxWidth = 1040;
  const viewBoxHeight = 490;
  const centerX = viewBoxWidth / 2;
  const centerY = viewBoxHeight / 2;

  const nodeCoordinates = useMemo(() => {
    const total = userModules.length;
    if (total === 0) return [];

    // Expanded Ellipse radius parameters to maximize graph display area
    const rx = total > 8 ? 415 : 365;
    const ry = total > 8 ? 185 : 155;

    return userModules.map((mod, index) => {
      // Angle offset so top modules start at nice positions
      const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + rx * Math.cos(angle);
      const y = centerY + ry * Math.sin(angle);
      return {
        ...mod,
        x,
        y,
        angle,
      };
    });
  }, [userModules, centerX, centerY]);

  const handleLaunchModule = (module: ModuleAppDefinition) => {
    setActiveRippleKey(module.key);
    setTimeout(() => {
      navigate(module.route);
    }, 220);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-920 to-slate-950 p-6 shadow-2xl">
      {/* Dynamic Background Neural Glow & Grid Accent */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.14),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1e293b12_1px,transparent_1px),linear-gradient(to_bottom,#1e293b12_1px,transparent_1px)] bg-[size:24px_24px]" />

      {/* Integrated Header Row: Welcome Greeting + Date + Controls */}
      <div className="relative z-20 mb-4 flex flex-col gap-4 border-b border-slate-800/90 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 bg-blue-950/80 border border-blue-800/50 px-2 py-0.5 rounded-full">
              HÔM NAY
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-blue-300">
              <Zap size={10} className="text-blue-400" /> Mạng Nơ-ron Lối Tắt Ứng Dụng ({userModules.length} module)
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
            Chào {user.name}
          </h1>
          {todayFormatted && (
            <p className="mt-1 text-xs font-medium text-slate-400">
              {todayFormatted}. Màn hình điều hành trung tâm — Chọn ứng dụng nhanh bằng 1-Click.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <StatusBadge
              status="pending"
              label={`${totalPendingTasks} việc cần xử lý`}
              tone={totalPendingTasks > 0 ? 'attention' : 'success'}
              size="md"
            />
            {roleLabels.map(label => (
              <span
                key={label}
                className="rounded-full bg-slate-800/80 px-2.5 py-0.5 text-[11px] font-bold text-slate-300 border border-slate-700/60"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Right side controls: Notification Link + Mode Switcher */}
        <div className="flex flex-wrap gap-2.5 items-center justify-start lg:justify-end">
          <Link
            to="/notifications"
            className="flex items-center gap-1.5 rounded-xl border border-teal-500/30 bg-teal-950/40 px-3.5 py-2 text-xs font-black text-teal-300 transition-all hover:bg-teal-900/60 uppercase tracking-wider shadow-sm"
          >
            <Bell size={14} className="text-teal-400" /> Xem thông báo
          </Link>

          {/* View Mode Switcher Toggle */}
          <div className="flex items-center gap-1 rounded-2xl border border-slate-800 bg-slate-900/90 p-1 shadow-inner">
            <button
              onClick={() => toggleViewMode('neural')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-300 ${
                viewMode === 'neural'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Sparkles size={13} /> Mạng Nơ-ron
            </button>
            <button
              onClick={() => toggleViewMode('grid')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-300 ${
                viewMode === 'grid'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Grid size={13} /> Chế độ Thẻ
            </button>
          </div>
        </div>
      </div>

      {/* VIEW MODE 1: NEURAL GRAPH VIEW */}
      {viewMode === 'neural' && (
        <div className="relative z-10 min-h-[440px] w-full select-none overflow-hidden rounded-2xl bg-slate-950/60 backdrop-blur-sm border border-slate-800/60">
          {/* Desktop & Tablet Neural Interactive SVG */}
          <div className="relative w-full h-[470px]">
            <svg
              viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
              className="absolute inset-0 w-full h-full"
            >
              <defs>
                {/* Glow filter for active neural paths */}
                <filter id="synapse-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                {/* Core brain glow gradient */}
                <radialGradient id="core-glow-grad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Central Core Outer Pulsing Rings */}
              <circle
                cx={centerX}
                cy={centerY}
                r="75"
                fill="url(#core-glow-grad)"
                className="animate-ping opacity-25"
                style={{ animationDuration: '4s' }}
              />
              <circle
                cx={centerX}
                cy={centerY}
                r="60"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="animate-spin opacity-40"
                style={{ animationDuration: '25s' }}
              />

              {/* Render Synapse Connection Paths & Flowing Energy Signals */}
              {nodeCoordinates.map((node) => {
                const isHovered = hoveredKey === node.key;
                const count = taskCounts[node.key] || 0;
                const hasPending = count > 0;

                // Control point for smooth curved Bezier path
                const ctrlX = (centerX + node.x) / 2 + (node.y > centerY ? 25 : -25);
                const ctrlY = (centerY + node.y) / 2;
                const pathD = `M ${centerX} ${centerY} Q ${ctrlX} ${ctrlY} ${node.x} ${node.y}`;

                return (
                  <g key={`synapse-${node.key}`}>
                    {/* Background Synapse Line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={isHovered ? node.strokeColor : '#334155'}
                      strokeWidth={isHovered ? '2.8' : '1.2'}
                      strokeOpacity={isHovered ? '0.95' : '0.4'}
                      filter={isHovered ? 'url(#synapse-glow)' : undefined}
                      className="transition-all duration-300"
                    />

                    {/* Flowing Particle Light Energy Pulse */}
                    <circle
                      r={isHovered ? '3.5' : hasPending ? '3' : '2'}
                      fill={isHovered ? '#ffffff' : node.strokeColor}
                      filter="url(#synapse-glow)"
                    >
                      <animateMotion
                        path={pathD}
                        dur={isHovered ? '1.5s' : hasPending ? '2.5s' : '4s'}
                        repeatCount="indefinite"
                      />
                    </circle>
                  </g>
                );
              })}
            </svg>

            {/* Central Brain Node Overlay (VIOO Core) */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center justify-center cursor-default group"
              style={{ left: `${(centerX / viewBoxWidth) * 100}%`, top: `${(centerY / viewBoxHeight) * 100}%` }}
            >
              <div className="relative flex h-20 w-20 sm:h-22 sm:w-22 items-center justify-center rounded-3xl bg-gradient-to-tr from-slate-900 via-blue-950 to-indigo-900 border-2 border-blue-500/50 shadow-[0_0_35px_rgba(59,130,246,0.35)] transition-transform duration-500 group-hover:scale-105">
                <div className="absolute inset-0 rounded-3xl bg-blue-500/10 blur-sm animate-pulse" />
                <Bot size={36} className="relative z-10 text-blue-400 animate-bounce" style={{ animationDuration: '3s' }} />
              </div>
              <div className="mt-2 text-center">
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-300 bg-blue-950/90 border border-blue-500/40 px-2.5 py-0.5 rounded-full shadow-sm">
                  {user.name}
                </span>
                <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                  VIOO CORE {totalPendingTasks > 0 && <span className="text-amber-400 font-extrabold">({totalPendingTasks} việc)</span>}
                </div>
              </div>
            </div>

            {/* Application Neuron Nodes */}
            {nodeCoordinates.map((node) => {
              const Icon = node.icon;
              const isHovered = hoveredKey === node.key;
              const isRippling = activeRippleKey === node.key;
              const count = taskCounts[node.key] || 0;

              const leftPercent = (node.x / viewBoxWidth) * 100;
              const topPercent = (node.y / viewBoxHeight) * 100;

              return (
                <div
                  key={`node-${node.key}`}
                  onMouseEnter={() => setHoveredKey(node.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() => handleLaunchModule(node)}
                  style={{ left: `${leftPercent}%`, top: `${topPercent}%` }}
                  className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 ${
                    isHovered ? 'scale-115 z-30' : 'scale-100 z-20'
                  }`}
                >
                  {/* Ripple animation on click */}
                  {isRippling && (
                    <span className="absolute inset-0 -m-3 rounded-full border-2 border-white animate-ping" />
                  )}

                  {/* Outer glowing halo */}
                  <div
                    className="relative flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl border border-white/20 bg-slate-900/90 shadow-xl backdrop-blur-md transition-all duration-300"
                    style={{
                      boxShadow: isHovered
                        ? `0 0 25px ${node.glowColor}, 0 0 50px ${node.glowColor}`
                        : `0 8px 20px rgba(0, 0, 0, 0.4)`,
                    }}
                  >
                    <div
                      className={`flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-gradient-to-br ${node.gradient} text-white shadow-md transition-transform duration-300 ${
                        isHovered ? 'scale-110 rotate-3' : ''
                      }`}
                    >
                      <Icon size={22} />
                    </div>

                    {/* Task Badge Counter */}
                    {count > 0 && (
                      <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-slate-900 bg-rose-500 px-1.5 text-[11px] font-black text-white shadow-lg animate-bounce">
                        {count}
                      </span>
                    )}
                  </div>

                  {/* Label under node */}
                  <div className="mt-1 text-center">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-extrabold tracking-tight transition-colors duration-200 ${
                        isHovered
                          ? 'bg-white text-slate-900 shadow-md scale-105'
                          : 'bg-slate-900/90 text-slate-200 border border-slate-700/60'
                      }`}
                    >
                      {node.label}
                    </span>
                  </div>

                  {/* Hover Tooltip Card */}
                  {isHovered && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 w-48 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3 text-left shadow-2xl backdrop-blur-md z-40 animate-in fade-in zoom-in-95 duration-200">
                      <div className="flex items-center gap-2">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br ${node.gradient} text-white`}>
                          <Icon size={14} />
                        </div>
                        <div className="text-xs font-black text-white">{node.label}</div>
                      </div>
                      <p className="mt-1 text-[10px] font-medium leading-4 text-slate-300">
                        {node.description}
                      </p>
                      {count > 0 ? (
                        <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-1.5 text-[10px] font-bold text-amber-400">
                          <span>{count} việc cần xử lý</span>
                          <ChevronRight size={12} />
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-1.5 text-[10px] font-bold text-blue-400">
                          <span>Mở ứng dụng</span>
                          <ChevronRight size={12} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW MODE 2: COMPACT GRID VIEW */}
      {viewMode === 'grid' && (
        <div className="relative z-10 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {userModules.map((mod) => {
            const Icon = mod.icon;
            const count = taskCounts[mod.key] || 0;

            return (
              <button
                key={mod.key}
                onClick={() => handleLaunchModule(mod)}
                className="group relative flex flex-col items-start rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4 text-left shadow-md backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-slate-700 hover:bg-slate-900 hover:shadow-xl"
              >
                <div className="flex w-full items-center justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${mod.gradient} text-white shadow-md transition-transform duration-300 group-hover:scale-110`}>
                    <Icon size={20} />
                  </div>
                  {count > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500/20 px-1.5 text-[10px] font-black text-rose-400 border border-rose-500/30">
                      {count}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 text-xs font-black text-white group-hover:text-blue-400 transition-colors">
                  {mod.label}
                </h3>
                <p className="mt-0.5 line-clamp-2 text-[10px] font-medium text-slate-400 leading-3">
                  {mod.description}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NeuralAppHub;
