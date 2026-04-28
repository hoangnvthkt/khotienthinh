import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  Crown, Zap, Users, UserCheck, UserX, CalendarOff, ClipboardList,
  AlertTriangle, Package, Landmark, BarChart3, Wrench, FileWarning,
  RefreshCw, Bot, ArrowRight, Shield, TrendingUp, Clock, Loader2,
  AlertCircle, Info, CheckCircle2, Sparkles, Briefcase, Inbox, DollarSign,
  Settings2, Trophy, Medal, Award, Calendar
} from 'lucide-react';
import { escapeHtml } from '../lib/safeHtml';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

interface KpiData {
  totalEmployees: number;
  presentToday: number;
  absentToday: number;
  onLeaveToday: number;
  pendingRequests: number;
  overdueRequests: number;
  lowStockCount: number;
  activeProjects: number;
  monthExpense: number;
  budgetPlanned: number;
  budgetActual: number;
  budgetUsagePercent: number;
  pendingVouchers: number;
  assetsMaintenance: number;
}

interface Alert {
  type: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  link?: string;
}

interface BriefResponse {
  kpis: KpiData;
  alerts: Alert[];
  brief: string;
  generatedAt: string;
  lowStockItems: any[];
  projects: any[];
}

interface RankEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  positionName: string;
  totalScore: number;
  rank: number;
  grade: string;
  gradeEmoji: string;
  scores: Record<string, number>;
}

interface RankingData {
  rankings: RankEmployee[];
  criteria: any[];
  meta: { month: number; year: number; workingDays: number; employeeCount: number };
}

const RANK_GRADE_COLORS: Record<string, string> = {
  'Xuất sắc': 'from-amber-400 to-yellow-500 text-amber-900',
  'Tốt': 'from-emerald-400 to-green-500 text-emerald-900',
  'Khá': 'from-blue-400 to-cyan-500 text-blue-900',
  'Trung bình': 'from-orange-400 to-amber-500 text-orange-900',
  'Cần cải thiện': 'from-red-400 to-rose-500 text-red-900',
};

// Time period presets
const now = new Date();
const curMonth = now.getMonth() + 1;
const curYear = now.getFullYear();
const PERIOD_PRESETS = [
  { key: 'this_month', label: `T${curMonth}/${curYear}`, month: curMonth, year: curYear },
  { key: 'last_month', label: `T${curMonth === 1 ? 12 : curMonth - 1}/${curMonth === 1 ? curYear - 1 : curYear}`, month: curMonth === 1 ? 12 : curMonth - 1, year: curMonth === 1 ? curYear - 1 : curYear },
  { key: 'q1', label: 'Q1', month: 3, year: curYear },
  { key: 'q2', label: 'Q2', month: 6, year: curYear },
  { key: 'q3', label: 'Q3', month: 9, year: curYear },
  { key: 'q4', label: 'Q4', month: 12, year: curYear },
];

// ===== MODULE SELECTION CONFIG =====
const MODULE_OPTIONS = [
  { key: 'hr', icon: Users, label: 'Nhân sự', emoji: '👥', gradient: 'from-blue-500 to-cyan-500', desc: 'Nhân sự, chấm công, nghỉ phép' },
  { key: 'inventory', icon: Package, label: 'Tồn kho', emoji: '📦', gradient: 'from-orange-500 to-amber-500', desc: 'Vật tư, tồn kho cảnh báo' },
  { key: 'finance', icon: DollarSign, label: 'Tài chính', emoji: '💰', gradient: 'from-emerald-500 to-green-500', desc: 'Chi phí, ngân sách, phiếu thu chi' },
  { key: 'projects', icon: BarChart3, label: 'Dự án', emoji: '🏗️', gradient: 'from-violet-500 to-purple-500', desc: 'Tiến độ dự án, công trình' },
  { key: 'requests', icon: Inbox, label: 'Yêu cầu', emoji: '📋', gradient: 'from-cyan-500 to-blue-500', desc: 'Yêu cầu chờ duyệt, quá hạn' },
  { key: 'assets', icon: Wrench, label: 'Tài sản', emoji: '🔧', gradient: 'from-rose-500 to-pink-500', desc: 'Tài sản, bảo trì, sửa chữa' },
];

const KPI_MODULE_MAP: Record<string, string> = {
  totalEmployees: 'hr', presentToday: 'hr', absentToday: 'hr', onLeaveToday: 'hr',
  pendingRequests: 'requests', overdueRequests: 'requests',
  lowStockCount: 'inventory',
  activeProjects: 'projects',
  monthExpense: 'finance', budgetPlanned: 'finance', budgetActual: 'finance', budgetUsagePercent: 'finance', pendingVouchers: 'finance',
  assetsMaintenance: 'assets',
};

const KPI_CONFIG = [
  { key: 'totalEmployees', label: 'Tổng nhân sự', icon: Users, gradient: 'from-blue-500 to-cyan-500', link: '/hrm/employees' },
  { key: 'presentToday', label: 'Đi làm hôm nay', icon: UserCheck, gradient: 'from-emerald-500 to-green-500', link: '/hrm/attendance' },
  { key: 'absentToday', label: 'Vắng mặt', icon: UserX, gradient: 'from-red-500 to-rose-500', link: '/hrm/attendance' },
  { key: 'onLeaveToday', label: 'Nghỉ phép', icon: CalendarOff, gradient: 'from-amber-500 to-orange-500', link: '/hrm/leave' },
  { key: 'pendingRequests', label: 'Yêu cầu chờ duyệt', icon: ClipboardList, gradient: 'from-violet-500 to-purple-500', link: '/rq' },
  { key: 'overdueRequests', label: 'Quá hạn', icon: FileWarning, gradient: 'from-red-600 to-pink-600', link: '/rq' },
  { key: 'lowStockCount', label: 'Tồn kho thấp', icon: Package, gradient: 'from-orange-500 to-amber-500', link: '/inventory' },
  { key: 'activeProjects', label: 'Dự án hoạt động', icon: BarChart3, gradient: 'from-teal-500 to-cyan-500', link: '/da' },
  { key: 'budgetUsagePercent', label: 'Ngân sách đã dùng', icon: Landmark, gradient: 'from-indigo-500 to-blue-500', suffix: '%', link: '/expense' },
  { key: 'pendingVouchers', label: 'Phiếu chờ > 48h', icon: Clock, gradient: 'from-yellow-500 to-amber-500', link: '/expense' },
  { key: 'assetsMaintenance', label: 'Tài sản bảo trì', icon: Wrench, gradient: 'from-slate-500 to-gray-500', link: '/ts/dashboard' },
  { key: 'monthExpense', label: 'Chi phí tháng này', icon: TrendingUp, gradient: 'from-pink-500 to-rose-500', format: 'money', link: '/expense' },
];

const ALERT_STYLES = {
  critical: { bg: 'bg-red-500/10 border-red-300 dark:border-red-800', text: 'text-red-700 dark:text-red-400', icon: AlertCircle, badge: 'bg-red-500 text-white' },
  warning: { bg: 'bg-amber-500/10 border-amber-300 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle, badge: 'bg-amber-500 text-white' },
  info: { bg: 'bg-blue-500/10 border-blue-300 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-400', icon: Info, badge: 'bg-blue-500 text-white' },
};

const ExecutiveAI: React.FC = () => {
  const { user } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedModules, setSelectedModules] = useState<Set<string>>(
    new Set(MODULE_OPTIONS.map(m => m.key)) // All selected by default
  );

  // Ranking state
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankPeriod, setRankPeriod] = useState(PERIOD_PRESETS[0].key);

  // Auto-refresh state
  const REFRESH_INTERVAL = 60; // seconds
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleModule = (key: string) => {
    setSelectedModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // Must keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedModules(new Set(MODULE_OPTIONS.map(m => m.key)));
  const allSelected = selectedModules.size === MODULE_OPTIONS.length;

  const generateBrief = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/executive-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, modules: Array.from(selectedModules) }),
      });
      const result = await resp.json();
      if (result.error) throw new Error(result.error);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Không thể tải dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  // Ranking fetch
  const fetchRanking = useCallback(async (periodKey?: string) => {
    setRankingLoading(true);
    try {
      const p = PERIOD_PRESETS.find(pp => pp.key === (periodKey || rankPeriod)) || PERIOD_PRESETS[0];
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/employee-ranking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: p.month, year: p.year }),
      });
      const result = await resp.json();
      if (!result.error) setRankingData(result);
    } catch {} finally { setRankingLoading(false); }
  }, [rankPeriod]);

  // Auto-fetch ranking when brief is loaded
  useEffect(() => { if (data) fetchRanking(); }, [data]);

  // ===== AUTO-LOAD ON MOUNT + AUTO-REFRESH =====
  const generateBriefRef = useRef(generateBrief);
  generateBriefRef.current = generateBrief;

  useEffect(() => {
    // Auto-load on mount
    generateBriefRef.current();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Setup auto-refresh interval
  useEffect(() => {
    // Clear existing intervals
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (autoRefresh) {
      setCountdown(REFRESH_INTERVAL);
      // Countdown timer
      countdownRef.current = setInterval(() => {
        setCountdown(prev => Math.max(0, prev - 1));
      }, 1000);
      // Data refresh
      intervalRef.current = setInterval(() => {
        generateBriefRef.current();
        setCountdown(REFRESH_INTERVAL);
      }, REFRESH_INTERVAL * 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh]);

  // Reset countdown on manual refresh
  const handleManualRefresh = () => {
    generateBrief();
    setCountdown(REFRESH_INTERVAL);
  };

  const changeRankPeriod = (key: string) => {
    setRankPeriod(key);
    fetchRanking(key);
  };

  const formatValue = (key: string, value: number, config: any) => {
    if (config.format === 'money') return `${(value / 1000000).toFixed(1)}Tr`;
    if (config.suffix) return `${value}${config.suffix}`;
    return value.toLocaleString('vi-VN');
  };

  const formatMarkdown = (text: string) => {
    return escapeHtml(text)
      .replace(/^### (.*?)$/gm, '<h4 class="text-sm font-black text-white mt-2 mb-1">$1</h4>')
      .replace(/^## (.*?)$/gm, '<h3 class="text-base font-black text-white mt-2 mb-1">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-white/10 rounded text-xs font-mono">$1</code>')
      .replace(/\n/g, '<br/>')
      .replace(/(^|<br\/>)- (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-cyan-300 mt-0.5">•</span><span>$2</span></span>')
      .replace(/(^|<br\/>)(\d+)\. (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-cyan-300 font-bold mt-0.5 w-5 text-right shrink-0">$2.</span><span>$3</span></span>');
  };

  // Filter KPIs by selected modules
  const visibleKpis = KPI_CONFIG.filter(k => selectedModules.has(KPI_MODULE_MAP[k.key]));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center shadow-2xl shadow-purple-500/30">
            <Crown size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Ban Giám Đốc</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm flex items-center gap-1 mt-0.5">
              <Shield size={12} className="text-indigo-500" />
              Trợ lý AI • Tổng hợp dữ liệu toàn hệ thống
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Live indicator */}
          {data && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-1.5 text-[11px] font-bold transition-colors ${autoRefresh ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}
                title={autoRefresh ? 'Tắt auto-refresh' : 'Bật auto-refresh'}>
                <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                {autoRefresh ? 'LIVE' : 'Paused'}
              </button>
              {autoRefresh && (
                <span className="text-[10px] text-slate-400 font-mono tabular-nums w-6 text-right">{countdown}s</span>
              )}
            </div>
          )}
          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white font-black text-sm shadow-lg shadow-purple-500/20 hover:shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> Đang tải...</>
            ) : (
              <><RefreshCw size={16} /> Làm mới</>
            )}
          </button>
        </div>
      </div>

      {/* ===== MODULE SELECTION ===== */}
      <div className="glass-card rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <Settings2 size={14} className="text-indigo-500" />
            Chọn mục tổng hợp
          </h3>
          <button
            onClick={allSelected ? () => setSelectedModules(new Set(['hr'])) : selectAll}
            className="text-[11px] font-bold text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
          >
            {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {MODULE_OPTIONS.map(mod => {
            const Icon = mod.icon;
            const active = selectedModules.has(mod.key);
            return (
              <button
                key={mod.key}
                onClick={() => toggleModule(mod.key)}
                className={`relative flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl border-2 transition-all duration-300 active:scale-95 ${
                  active
                    ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 shadow-md shadow-indigo-500/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 opacity-50 hover:opacity-75'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  active
                    ? `bg-gradient-to-br ${mod.gradient} shadow-md`
                    : 'bg-slate-100 dark:bg-slate-700'
                }`}>
                  <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />
                </div>
                <div className="text-center">
                  <p className={`text-[11px] font-black ${active ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
                    {mod.label}
                  </p>
                  <p className={`text-[9px] mt-0.5 ${active ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'}`}>
                    {mod.desc}
                  </p>
                </div>
                {/* Checkmark */}
                {active && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                    <CheckCircle2 size={12} className="text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Initial Loading State — on first mount */}
      {!data && loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center exec-animate">
          <div className="relative mb-8">
            <div className="w-28 h-28 rounded-full border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Bot size={36} className="text-indigo-500" />
            </div>
          </div>
          <h2 className="text-lg font-black text-slate-800 dark:text-white mb-1">AI đang tổng hợp dữ liệu...</h2>
          <p className="text-sm text-slate-400 animate-pulse">
            Đang truy vấn {Array.from(selectedModules).map(m => MODULE_OPTIONS.find(o => o.key === m)?.label).join(', ')}...
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 exec-animate">
          <AlertCircle size={20} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400 font-medium">{error}</p>
        </div>
      )}

      {/* ===== DATA LOADED ===== */}
      {data && (
        <div className="space-y-6 exec-animate">
          {/* Morning Brief Card */}
          <div className="relative rounded-3xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900" />
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNjBMNjAgMCIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IGZpbGw9InVybCgjZykiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiLz48L3N2Zz4=')] opacity-50" />
            <div className="relative p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                    <Bot size={20} className="text-cyan-300" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white">Bản tin tổng hợp</h2>
                    <p className="text-[11px] text-white/50">
                      Cập nhật lúc {new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} •{' '}
                      {new Date(data.generatedAt).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {' • '}
                      {Array.from(selectedModules).map(m => MODULE_OPTIONS.find(o => o.key === m)?.emoji).join(' ')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={generateBrief}
                  disabled={loading}
                  className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all active:scale-90"
                  title="Làm mới"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div
                className="text-sm leading-relaxed text-white/80"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(data.brief) }}
              />
            </div>
          </div>

          {/* KPI Grid */}
          {visibleKpis.length > 0 && (
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <BarChart3 size={16} className="text-indigo-500" />
                Chỉ số tổng hợp
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {visibleKpis.map((kpi) => {
                  const Icon = kpi.icon;
                  const value = data.kpis[kpi.key as keyof KpiData] ?? 0;
                  const isAlert = (kpi.key === 'overdueRequests' && value > 0) ||
                                  (kpi.key === 'lowStockCount' && value > 0) ||
                                  (kpi.key === 'budgetUsagePercent' && value > 90) ||
                                  (kpi.key === 'absentToday' && value > 0);
                  return (
                    <button
                      key={kpi.key}
                      onClick={() => navigate(kpi.link)}
                      className={`group relative glass-card p-4 rounded-2xl text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300 active:scale-95 overflow-hidden ${
                        isAlert ? 'ring-2 ring-red-400/50 dark:ring-red-500/30' : ''
                      }`}
                    >
                      <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${kpi.gradient} opacity-[0.07] -translate-y-6 translate-x-6 group-hover:opacity-[0.12] transition-opacity`} />
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${kpi.gradient} flex items-center justify-center mb-2.5 shadow-md`}>
                        <Icon size={16} className="text-white" />
                      </div>
                      <p className="text-xl font-black text-slate-800 dark:text-white">
                        {formatValue(kpi.key, value, kpi)}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mt-0.5">{kpi.label}</p>
                      {isAlert && (
                        <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Smart Alerts */}
          {data.alerts.length > 0 && (
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                Cảnh báo thông minh
                <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-black">{data.alerts.length}</span>
              </h3>
              <div className="space-y-2.5">
                {data.alerts.map((alert, i) => {
                  const style = ALERT_STYLES[alert.level];
                  const AlertIcon = style.icon;
                  return (
                    <div
                      key={i}
                      onClick={() => alert.link && navigate(alert.link)}
                      className={`flex items-center gap-4 p-4 rounded-2xl border ${style.bg} ${alert.link ? 'cursor-pointer hover:shadow-md hover:-translate-y-px' : ''} transition-all exec-alert-animate`}
                      style={{ animationDelay: `${i * 0.05}s` }}
                    >
                      <div className={`w-10 h-10 rounded-xl ${style.badge} flex items-center justify-center shrink-0 shadow-sm`}>
                        <AlertIcon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-black ${style.text}`}>{alert.title}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{alert.detail}</p>
                      </div>
                      <span className={`text-[9px] px-2 py-1 rounded-full font-black uppercase ${style.badge}`}>
                        {alert.level === 'critical' ? 'Nghiêm trọng' : alert.level === 'warning' ? 'Cảnh báo' : 'Thông tin'}
                      </span>
                      {alert.link && <ArrowRight size={16} className="text-slate-300 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* All Clear */}
          {data.alerts.length === 0 && (
            <div className="flex items-center gap-4 p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <CheckCircle2 size={24} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">Mọi thứ ổn định!</p>
                <p className="text-[11px] text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">Không có cảnh báo bất thường nào</p>
              </div>
            </div>
          )}

          {/* ===== TOP 10 RANKING WIDGET ===== */}
          <div className="glass-card rounded-3xl overflow-hidden exec-animate">
            {/* Header with gradient */}
            <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                    <Trophy size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Top 10 Nhân viên xuất sắc</h3>
                    <p className="text-[11px] text-white/70">Xếp hạng theo hiệu suất tổng hợp</p>
                  </div>
                </div>
                <button onClick={() => navigate('/hrm/ranking')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-all backdrop-blur">
                  Xem đầy đủ <ArrowRight size={12} />
                </button>
              </div>
              {/* Period selector chips */}
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {PERIOD_PRESETS.map(p => (
                  <button key={p.key} onClick={() => changeRankPeriod(p.key)}
                    className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                      rankPeriod === p.key
                        ? 'bg-white text-orange-600 shadow-md'
                        : 'bg-white/15 text-white/80 hover:bg-white/25'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-5">
              {rankingLoading ? (
                <div className="flex items-center justify-center py-8 gap-3">
                  <Loader2 size={20} className="animate-spin text-amber-500" />
                  <span className="text-sm text-slate-400 font-medium">Đang tải xếp hạng...</span>
                </div>
              ) : rankingData && rankingData.rankings.length > 0 ? (
                <div className="space-y-4">
                  {/* Mini Podium - Top 3 */}
                  {rankingData.rankings.length >= 3 && (
                    <div className="flex items-end justify-center gap-4 py-3">
                      {[1, 0, 2].map(idx => {
                        const emp = rankingData.rankings[idx];
                        if (!emp) return null;
                        const isFirst = idx === 0;
                        const icons = [Crown, Medal, Medal];
                        const colors = ['from-amber-400 to-yellow-500', 'from-slate-300 to-slate-400', 'from-amber-600 to-orange-700'];
                        const sizes = isFirst ? 'w-14 h-14' : 'w-11 h-11';
                        const Icon = icons[idx];
                        return (
                          <div key={emp.employeeId} className={`flex flex-col items-center ${idx === 0 ? 'order-2' : idx === 1 ? 'order-1' : 'order-3'}`}>
                            <div className="relative mb-1">
                              <div className={`${sizes} rounded-xl bg-gradient-to-br ${colors[idx]} flex items-center justify-center text-white shadow-lg`}>
                                <span className={`${isFirst ? 'text-xl' : 'text-base'} font-black`}>{emp.fullName.charAt(0)}</span>
                              </div>
                              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-slate-900 shadow flex items-center justify-center">
                                <Icon size={10} className={idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-slate-400' : 'text-amber-700'} />
                              </div>
                            </div>
                            <p className="text-[11px] font-black text-slate-800 dark:text-white text-center truncate max-w-[80px]">{emp.fullName}</p>
                            <p className={`text-xs font-black bg-gradient-to-r ${colors[idx]} bg-clip-text text-transparent`}>{emp.totalScore}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Ranking bars — Top 10 */}
                  <div className="space-y-1.5">
                    {rankingData.rankings.slice(0, 10).map((emp, i) => {
                      const maxScore = rankingData.rankings[0]?.totalScore || 100;
                      const barWidth = Math.max(5, (emp.totalScore / maxScore) * 100);
                      const gradeColor = RANK_GRADE_COLORS[emp.grade] || RANK_GRADE_COLORS['Trung bình'];
                      const podiumBg = i < 3
                        ? ['from-amber-400/20 border-amber-300 dark:border-amber-700', 'from-slate-300/20 border-slate-300 dark:border-slate-600', 'from-orange-400/20 border-orange-300 dark:border-orange-700'][i]
                        : 'from-transparent border-slate-100 dark:border-slate-800';
                      return (
                        <div key={emp.employeeId}
                          className={`flex items-center gap-3 p-2.5 rounded-xl border bg-gradient-to-r ${podiumBg} transition-all hover:shadow-sm`}
                          style={{ animationDelay: `${i * 0.05}s` }}>
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                            i === 0 ? 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white shadow-sm'
                            : i === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white'
                            : i === 2 ? 'bg-gradient-to-br from-amber-600 to-orange-700 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>{emp.rank}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{emp.fullName}</p>
                              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                <span className="text-xs font-black text-slate-700 dark:text-white">{emp.totalScore}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black bg-gradient-to-r ${gradeColor}`}>
                                  {emp.gradeEmoji}
                                </span>
                              </div>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${
                                emp.totalScore >= 80 ? 'bg-gradient-to-r from-emerald-400 to-green-500'
                                : emp.totalScore >= 60 ? 'bg-gradient-to-r from-blue-400 to-cyan-500'
                                : emp.totalScore >= 40 ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                                : 'bg-gradient-to-r from-red-400 to-rose-500'
                              }`} style={{ width: `${barWidth}%` }} />
                            </div>
                            <p className="text-[9px] text-slate-400 mt-0.5 truncate">{emp.positionName || emp.employeeCode}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer meta */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400">
                      <Calendar size={10} className="inline mr-1" />
                      T{rankingData.meta.month}/{rankingData.meta.year} • {rankingData.meta.workingDays} ngày làm việc • {rankingData.meta.employeeCount} NV
                    </p>
                    <button onClick={() => navigate('/hrm/ranking')}
                      className="text-[10px] font-bold text-amber-500 hover:text-amber-600 flex items-center gap-0.5 transition">
                      Chi tiết xếp hạng <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Trophy size={32} className="text-slate-200 dark:text-slate-700 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Chưa có dữ liệu xếp hạng</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes execFadeIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes alertSlide {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .exec-animate { animation: execFadeIn 0.5s ease-out; }
        .exec-alert-animate { animation: alertSlide 0.4s ease-out both; }
      `}</style>
    </div>
  );
};

export default ExecutiveAI;
