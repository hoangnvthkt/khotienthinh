
import React, { useState, useMemo } from 'react';
import { useRequest } from '../../context/RequestContext';
import { useApp } from '../../context/AppContext';
import { RequestInstance, RQStatus } from '../../types';
import {
  BarChart3, CheckCircle, Clock, XCircle, AlertTriangle,
  TrendingUp, Users, X, Inbox,
  ChevronRight, Target, Zap, Calendar, CalendarRange,
  FileText, PlayCircle, Ban
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';

// ========== Types ==========
interface DrillDownData {
  title: string;
  requests: RequestInstance[];
}

// ========== Constants ==========
const STATUS_CONFIG: Record<RQStatus, { label: string; color: string; bg: string; icon: any }> = {
  DRAFT: { label: 'Nháp', color: '#94A3B8', bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700', icon: FileText },
  PENDING: { label: 'Chờ duyệt', color: '#F59E0B', bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', icon: Clock },
  APPROVED: { label: 'Đã duyệt', color: '#3B82F6', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', icon: CheckCircle },
  IN_PROGRESS: { label: 'Đang xử lý', color: '#8B5CF6', bg: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800', icon: PlayCircle },
  DONE: { label: 'Hoàn thành', color: '#10B981', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800', icon: CheckCircle },
  REJECTED: { label: 'Từ chối', color: '#EF4444', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', icon: XCircle },
  CANCELLED: { label: 'Đã hủy', color: '#64748B', bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700', icon: Ban },
};

const PIE_COLORS = ['#94A3B8', '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981', '#EF4444', '#64748B'];

type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all';

const getPresetRange = (preset: DatePreset): { from: string; to: string } => {
  const now = new Date();
  const toStr = (d: Date) => d.toISOString().slice(0, 10);
  const today = toStr(now);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1); return { from: toStr(d), to: today }; }
    case 'month': return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today };
    case 'quarter': { const qMonth = Math.floor(now.getMonth() / 3) * 3; return { from: `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`, to: today }; }
    case 'year': return { from: `${now.getFullYear()}-01-01`, to: today };
    case 'all': return { from: '', to: '' };
  }
};

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Hôm nay', week: 'Tuần này', month: 'Tháng này',
  quarter: 'Quý này', year: 'Năm nay', all: 'Tất cả',
};

const RequestDashboard: React.FC = () => {
  const { categories, requests, logs } = useRequest();
  const { users } = useApp();
  const [drillDown, setDrillDown] = useState<DrillDownData | null>(null);

  // ==================== DATE FILTER ====================
  const [activePreset, setActivePreset] = useState<DatePreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handlePreset = (preset: DatePreset) => {
    setActivePreset(preset);
    const range = getPresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const handleCustomDate = (field: 'from' | 'to', value: string) => {
    setActivePreset('all');
    if (field === 'from') setDateFrom(value);
    else setDateTo(value);
  };

  const filteredRequests = useMemo(() => {
    if (!dateFrom && !dateTo) return requests;
    return requests.filter(r => {
      const d = r.createdAt.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }, [requests, dateFrom, dateTo]);

  // ==================== SLA ANALYSIS ====================
  const slaAnalysis = useMemo(() => {
    const overdue: RequestInstance[] = [];
    const onTime: RequestInstance[] = [];
    const overdueMap = new Map<string, boolean>();

    filteredRequests.forEach(req => {
      if (!req.dueDate) { overdueMap.set(req.id, false); return; }
      const due = new Date(req.dueDate).getTime();
      const isCompleted = req.status === RQStatus.DONE || req.status === RQStatus.APPROVED;
      const checkDate = isCompleted ? new Date(req.updatedAt).getTime() : Date.now();
      const isOverdue = checkDate > due;
      overdueMap.set(req.id, isOverdue);
      if (isCompleted) {
        if (isOverdue) overdue.push(req);
        else onTime.push(req);
      }
    });

    return { overdue, onTime, overdueMap };
  }, [filteredRequests]);

  // ==================== KPI STATS ====================
  const stats = useMemo(() => {
    const total = filteredRequests.length;
    const draft = filteredRequests.filter(r => r.status === RQStatus.DRAFT);
    const pending = filteredRequests.filter(r => r.status === RQStatus.PENDING);
    const approved = filteredRequests.filter(r => r.status === RQStatus.APPROVED);
    const inProgress = filteredRequests.filter(r => r.status === RQStatus.IN_PROGRESS);
    const done = filteredRequests.filter(r => r.status === RQStatus.DONE);
    const rejected = filteredRequests.filter(r => r.status === RQStatus.REJECTED);
    const cancelled = filteredRequests.filter(r => r.status === RQStatus.CANCELLED);
    const onTime = slaAnalysis.onTime;
    const overdue = slaAnalysis.overdue;
    const runningOverdue = [...pending, ...approved, ...inProgress].filter(r => slaAnalysis.overdueMap.get(r.id));

    return { total, draft, pending, approved, inProgress, done, rejected, cancelled, onTime, overdue, runningOverdue };
  }, [filteredRequests, slaAnalysis]);

  // ==================== CHART DATA ====================
  const pieData = useMemo(() => [
    { name: 'Nháp', value: stats.draft.length },
    { name: 'Chờ duyệt', value: stats.pending.length },
    { name: 'Đã duyệt', value: stats.approved.length },
    { name: 'Đang xử lý', value: stats.inProgress.length },
    { name: 'Hoàn thành', value: stats.done.length },
    { name: 'Từ chối', value: stats.rejected.length },
    { name: 'Đã hủy', value: stats.cancelled.length },
  ].filter(d => d.value > 0), [stats]);

  const barData = useMemo(() => {
    return categories.filter(c => c.isActive).map(c => {
      const cReqs = filteredRequests.filter(r => r.categoryId === c.id);
      return {
        name: c.name.length > 15 ? c.name.slice(0, 15) + '...' : c.name,
        fullName: c.name,
        total: cReqs.length,
        pending: cReqs.filter(r => r.status === RQStatus.PENDING).length,
        done: cReqs.filter(r => r.status === RQStatus.DONE || r.status === RQStatus.APPROVED).length,
        rejected: cReqs.filter(r => r.status === RQStatus.REJECTED).length,
      };
    }).filter(d => d.total > 0);
  }, [categories, filteredRequests]);

  // ==================== EMPLOYEE RANKINGS ====================
  const employeeStats = useMemo(() => {
    const userActions = new Map<string, {
      created: number; approved: number; onTime: number; overdue: number;
      createdList: RequestInstance[]; approvedList: RequestInstance[];
      onTimeList: RequestInstance[]; overdueList: RequestInstance[];
    }>();

    // Count creations
    filteredRequests.forEach(req => {
      const uid = req.createdBy;
      const entry = userActions.get(uid) || { created: 0, approved: 0, onTime: 0, overdue: 0, createdList: [], approvedList: [], onTimeList: [], overdueList: [] };
      entry.created++;
      entry.createdList.push(req);
      userActions.set(uid, entry);
    });

    // Count approvals from logs
    logs.forEach(log => {
      if (log.action !== 'APPROVED' && log.action !== 'REJECTED') return;
      const uid = log.actedBy;
      const req = filteredRequests.find(r => r.id === log.requestId);
      if (!req) return;
      const entry = userActions.get(uid) || { created: 0, approved: 0, onTime: 0, overdue: 0, createdList: [], approvedList: [], onTimeList: [], overdueList: [] };
      entry.approved++;
      entry.approvedList.push(req);

      // Check SLA
      const isOverdue = slaAnalysis.overdueMap.get(req.id);
      if (isOverdue) { entry.overdue++; entry.overdueList.push(req); }
      else { entry.onTime++; entry.onTimeList.push(req); }

      userActions.set(uid, entry);
    });

    const entries = Array.from(userActions.entries()).map(([uid, data]) => ({
      userId: uid,
      userName: users.find(u => u.id === uid)?.name || uid.slice(0, 8),
      ...data,
    }));

    return {
      mostCreated: [...entries].sort((a, b) => b.created - a.created).slice(0, 5),
      mostApproved: [...entries].sort((a, b) => b.approved - a.approved).filter(e => e.approved > 0).slice(0, 5),
      mostOnTime: [...entries].sort((a, b) => b.onTime - a.onTime).filter(e => e.onTime > 0).slice(0, 5),
      mostOverdue: [...entries].sort((a, b) => b.overdue - a.overdue).filter(e => e.overdue > 0).slice(0, 5),
    };
  }, [filteredRequests, logs, users, slaAnalysis]);

  // ==================== HELPERS ====================
  const openDrillDown = (title: string, list: RequestInstance[]) => {
    const unique = Array.from(new Map(list.map(r => [r.id, r])).values());
    setDrillDown({ title, requests: unique });
  };

  const getStatusBadge = (status: RQStatus) => {
    const cfg = STATUS_CONFIG[status];
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black ${cfg.bg} border`}>
        <Icon size={10} /> {cfg.label}
      </span>
    );
  };

  const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || userId.slice(0, 8);
  const getCategoryName = (catId: string) => categories.find(c => c.id === catId)?.name || '—';

  // ==================== RENDER ====================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <BarChart3 className="text-orange-500" size={28} /> Dashboard Yêu Cầu
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Tổng hợp thống kê và phân tích yêu cầu.</p>
        </div>
      </div>

      {/* Time Range Filter */}
      <div className="glass-panel rounded-2xl p-3 flex flex-col md:flex-row items-start md:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <CalendarRange size={14} className="text-orange-500" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Khoảng thời gian:</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {(Object.keys(PRESET_LABELS) as DatePreset[]).map(preset => (
            <button key={preset} onClick={() => handlePreset(preset)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all ${
                activePreset === preset && (dateFrom || dateTo || preset === 'all')
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30'
                  : 'bg-white/50 dark:bg-slate-800/50 text-slate-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:text-orange-600 border border-slate-200 dark:border-slate-700'
              }`}>
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar size={12} className="text-slate-400" />
          <input type="date" value={dateFrom} onChange={e => handleCustomDate('from', e.target.value)}
            className="px-2.5 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-300 w-32" />
          <span className="text-[10px] text-slate-400 font-bold">→</span>
          <input type="date" value={dateTo} onChange={e => handleCustomDate('to', e.target.value)}
            className="px-2.5 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-300 w-32" />
        </div>
        {(dateFrom || dateTo) && (
          <span className="text-[10px] text-orange-500 font-bold bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded-lg">
            {filteredRequests.length}/{requests.length} phiếu
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Tổng phiếu', value: stats.total, icon: Inbox, color: 'from-slate-500 to-slate-600', list: filteredRequests, key: 'total' },
          { label: 'Chờ duyệt', value: stats.pending.length, icon: Clock, color: 'from-amber-500 to-amber-600', list: stats.pending, key: 'pending' },
          { label: 'Hoàn thành', value: stats.done.length + stats.approved.length, icon: CheckCircle, color: 'from-emerald-500 to-emerald-600', list: [...stats.done, ...stats.approved], key: 'done' },
          { label: 'Đúng hạn', value: stats.onTime.length, icon: Target, color: 'from-green-500 to-teal-500', list: stats.onTime, key: 'onTime' },
          { label: 'Trễ hạn', value: stats.overdue.length + stats.runningOverdue.length, icon: AlertTriangle, color: 'from-amber-500 to-orange-500', list: [...stats.overdue, ...stats.runningOverdue], key: 'overdue' },
          { label: 'Từ chối', value: stats.rejected.length, icon: XCircle, color: 'from-red-500 to-rose-500', list: stats.rejected, key: 'rejected' },
          { label: 'Đã hủy', value: stats.cancelled.length, icon: Ban, color: 'from-slate-400 to-slate-500', list: stats.cancelled, key: 'cancelled' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <button key={card.key} onClick={() => openDrillDown(card.label, card.list)}
              className="glass-panel rounded-2xl p-4 text-left hover:shadow-lg hover:scale-[1.02] transition-all group cursor-pointer border border-transparent hover:border-orange-200 dark:hover:border-orange-800">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white shadow-sm mb-2`}>
                <Icon size={18} />
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{card.value}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{card.label}</p>
              <p className="text-[9px] text-orange-400 font-bold mt-1 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5">
                Xem chi tiết <ChevronRight size={10} />
              </p>
            </button>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie Chart */}
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-orange-500" /> Phân bổ trạng thái
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
                  paddingAngle={3} dataKey="value" stroke="none">
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: number) => [`${value} phiếu`, '']} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-sm text-slate-400">Chưa có dữ liệu</div>
          )}
        </div>

        {/* Bar Chart */}
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-orange-500" /> Phiếu theo danh mục
          </h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData} barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 700 }} />
                <Bar dataKey="pending" name="Chờ duyệt" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" name="Hoàn thành" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rejected" name="Từ chối" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-sm text-slate-400">Chưa có dữ liệu</div>
          )}
        </div>
      </div>

      {/* Employee Rankings */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: '🏆 Tạo yêu cầu nhiều nhất', data: employeeStats.mostCreated, field: 'created' as const, listField: 'createdList' as const, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { title: '⚡ Duyệt nhiều nhất', data: employeeStats.mostApproved, field: 'approved' as const, listField: 'approvedList' as const, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { title: '🎯 Đúng hạn nhiều nhất', data: employeeStats.mostOnTime, field: 'onTime' as const, listField: 'onTimeList' as const, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
          { title: '⚠️ Trễ hạn nhiều nhất', data: employeeStats.mostOverdue, field: 'overdue' as const, listField: 'overdueList' as const, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
        ].map(section => (
          <div key={section.title} className="glass-panel rounded-2xl p-4">
            <h4 className="text-xs font-black text-slate-600 dark:text-slate-300 mb-3">{section.title}</h4>
            {section.data.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic">Chưa có dữ liệu</p>
            ) : (
              <div className="space-y-2">
                {section.data.map((emp, idx) => (
                  <button key={emp.userId} onClick={() => openDrillDown(`${section.title} — ${emp.userName}`, emp[section.listField])}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl ${section.bg} hover:shadow-md transition-all group cursor-pointer text-left`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white ${idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600' : idx === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-500' : idx === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600' : 'bg-slate-400'}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{emp.userName}</p>
                    </div>
                    <span className={`text-sm font-black ${section.color}`}>{emp[section.field]}</span>
                    <ChevronRight size={12} className="text-slate-300 group-hover:text-orange-400 transition" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ==================== DRILL-DOWN MODAL ==================== */}
      {drillDown && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-orange-500 to-amber-500 rounded-t-3xl flex items-center justify-between shrink-0">
              <span className="font-bold text-lg text-white flex items-center gap-2">
                <Zap size={18} /> {drillDown.title} ({drillDown.requests.length})
              </span>
              <button onClick={() => setDrillDown(null)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center">
                <X size={18} />
              </button>
            </div>
            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {drillDown.requests.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">Không có phiếu nào</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {drillDown.requests.map(req => (
                    <div key={req.id} className="px-6 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="text-[10px] font-mono font-bold text-orange-500 bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 rounded">{req.code}</span>
                            {getStatusBadge(req.status)}
                          </div>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{req.title}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
                            <span><Users size={10} className="inline mr-0.5" />{getUserName(req.createdBy)}</span>
                            <span><Inbox size={10} className="inline mr-0.5" />{getCategoryName(req.categoryId)}</span>
                            <span>{new Date(req.createdAt).toLocaleDateString('vi-VN')}</span>
                          </div>
                        </div>
                        {slaAnalysis.overdueMap.get(req.id) && (
                          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[9px] font-black rounded-lg border border-amber-200 dark:border-amber-800">
                            ⏰ Trễ SLA
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestDashboard;
