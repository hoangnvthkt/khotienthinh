
import React, { useState, useMemo } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import {
  WorkflowInstance, WorkflowInstanceStatus, WorkflowNodeType,
  WorkflowInstanceAction
} from '../../types';
import {
  BarChart3, CheckCircle, Clock, XCircle, AlertTriangle,
  TrendingUp, Users, Award, X, GitBranch,
  ArrowRight, ChevronRight, Target, Zap, Timer, Calendar, CalendarRange
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';

// ========== Types ==========
interface DrillDownData {
  title: string;
  instances: WorkflowInstance[];
}

interface NodeSlaInfo {
  nodeId: string;
  nodeLabel: string;
  templateName: string;
  totalInstances: number;
  overdueCount: number;
  avgHours: number;
  slaHours: number;
  overdueInstances: WorkflowInstance[];
}

// ========== Constants ==========
const STATUS_CONFIG: Record<WorkflowInstanceStatus, { label: string; color: string; bg: string; icon: any }> = {
  RUNNING: { label: 'Đang xử lý', color: '#3B82F6', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', icon: Clock },
  COMPLETED: { label: 'Hoàn thành', color: '#10B981', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800', icon: CheckCircle },
  REJECTED: { label: 'Từ chối', color: '#EF4444', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', icon: XCircle },
  CANCELLED: { label: 'Đã hủy', color: '#94A3B8', bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700', icon: XCircle },
};

const PIE_COLORS = ['#3B82F6', '#10B981', '#EF4444', '#94A3B8'];

type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all';

const getPresetRange = (preset: DatePreset): { from: string; to: string } => {
  const now = new Date();
  const toStr = (d: Date) => d.toISOString().slice(0, 10);
  const today = toStr(now);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'week': {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1); // Monday
      return { from: toStr(d), to: today };
    }
    case 'month': return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today };
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`, to: today };
    }
    case 'year': return { from: `${now.getFullYear()}-01-01`, to: today };
    case 'all': return { from: '', to: '' };
  }
};

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Hôm nay', week: 'Tuần này', month: 'Tháng này',
  quarter: 'Quý này', year: 'Năm nay', all: 'Tất cả',
};

const WorkflowDashboard: React.FC = () => {
  const { templates, instances, nodes, edges, logs } = useWorkflow();
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
    setActivePreset('all'); // reset preset when custom
    if (field === 'from') setDateFrom(value);
    else setDateTo(value);
  };

  // Filter instances by date range
  const filteredInstances = useMemo(() => {
    if (!dateFrom && !dateTo) return instances;
    return instances.filter(i => {
      const d = i.createdAt.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }, [instances, dateFrom, dateTo]);

  // ==================== SLA ANALYSIS ====================
  // For each instance+node, compute time spent and compare with SLA
  const slaAnalysis = useMemo(() => {
    const results: {
      onTimeInstances: WorkflowInstance[];
      overdueInstances: WorkflowInstance[];
      nodeStats: Map<string, NodeSlaInfo>;
      instanceOverdue: Map<string, boolean>; // instanceId -> isOverdue
    } = {
      onTimeInstances: [],
      overdueInstances: [],
      nodeStats: new Map(),
      instanceOverdue: new Map(),
    };

    filteredInstances.forEach(inst => {
      const instLogs = logs.filter(l => l.instanceId === inst.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const templateNodes = nodes.filter(n => n.templateId === inst.templateId);
      const templateEdges = edges.filter(e => e.templateId === inst.templateId);
      const template = templates.find(t => t.id === inst.templateId);

      let instanceHasOverdue = false;

      // Build ordered path from START
      const orderedNodes: typeof templateNodes = [];
      let currentNode = templateNodes.find(n => n.type === WorkflowNodeType.START);
      const visited = new Set<string>();
      while (currentNode && !visited.has(currentNode.id)) {
        visited.add(currentNode.id);
        orderedNodes.push(currentNode);
        const nextEdge = templateEdges.find(e => e.sourceNodeId === currentNode!.id);
        if (nextEdge) currentNode = templateNodes.find(n => n.id === nextEdge.targetNodeId);
        else break;
      }

      // Analyze each node's processing time
      orderedNodes.forEach((node, idx) => {
        if (node.type === WorkflowNodeType.START || node.type === WorkflowNodeType.END) return;
        if (!node.config.slaHours) return;

        const nodeLog = instLogs.filter(l => l.nodeId === node.id);
        if (nodeLog.length === 0) {
          // Node hasn't been reached yet, or is current
          if (inst.currentNodeId === node.id && inst.status === WorkflowInstanceStatus.RUNNING) {
            // Currently at this node - compute time from when it arrived
            const prevNodeLog = instLogs.filter(l => {
              const prevIdx = orderedNodes.findIndex(n => n.id === l.nodeId);
              return prevIdx >= 0 && prevIdx < idx;
            });
            const arrivedAt = prevNodeLog.length > 0
              ? prevNodeLog[prevNodeLog.length - 1].createdAt
              : inst.createdAt;
            const hoursSpent = (Date.now() - new Date(arrivedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSpent > node.config.slaHours) {
              instanceHasOverdue = true;
              updateNodeStats(results.nodeStats, node.id, node.label, template?.name || '', node.config.slaHours, hoursSpent, true, inst);
            } else {
              updateNodeStats(results.nodeStats, node.id, node.label, template?.name || '', node.config.slaHours, hoursSpent, false, inst);
            }
          }
          return;
        }

        // Node was processed — compute time between arrival and action
        const firstLog = nodeLog[0];
        const prevIdx = orderedNodes.findIndex(n => n.id === node.id) - 1;
        const prevNode = prevIdx >= 0 ? orderedNodes[prevIdx] : null;
        const prevLogs = prevNode ? instLogs.filter(l => l.nodeId === prevNode.id) : [];
        const arrivedAt = prevLogs.length > 0
          ? prevLogs[prevLogs.length - 1].createdAt
          : inst.createdAt;
        const processedAt = firstLog.createdAt;
        const hoursSpent = (new Date(processedAt).getTime() - new Date(arrivedAt).getTime()) / (1000 * 60 * 60);
        const isOverdue = hoursSpent > node.config.slaHours;
        if (isOverdue) instanceHasOverdue = true;

        updateNodeStats(results.nodeStats, node.id, node.label, template?.name || '', node.config.slaHours, hoursSpent, isOverdue, inst);
      });

      results.instanceOverdue.set(inst.id, instanceHasOverdue);

      if (inst.status === WorkflowInstanceStatus.COMPLETED) {
        if (instanceHasOverdue) results.overdueInstances.push(inst);
        else results.onTimeInstances.push(inst);
      }
    });

    return results;
  }, [filteredInstances, logs, nodes, edges, templates]);

  function updateNodeStats(
    map: Map<string, NodeSlaInfo>, nodeId: string, nodeLabel: string,
    templateName: string, slaHours: number, hoursSpent: number,
    isOverdue: boolean, inst: WorkflowInstance
  ) {
    const existing = map.get(nodeId) || {
      nodeId, nodeLabel, templateName, totalInstances: 0,
      overdueCount: 0, avgHours: 0, slaHours, overdueInstances: []
    };
    const totalHours = existing.avgHours * existing.totalInstances + hoursSpent;
    existing.totalInstances++;
    existing.avgHours = totalHours / existing.totalInstances;
    if (isOverdue) {
      existing.overdueCount++;
      existing.overdueInstances.push(inst);
    }
    map.set(nodeId, existing);
  }

  // ==================== KPI STATS ====================
  const stats = useMemo(() => {
    const total = filteredInstances.length;
    const running = filteredInstances.filter(i => i.status === WorkflowInstanceStatus.RUNNING);
    const completed = filteredInstances.filter(i => i.status === WorkflowInstanceStatus.COMPLETED);
    const rejected = filteredInstances.filter(i => i.status === WorkflowInstanceStatus.REJECTED);
    const cancelled = filteredInstances.filter(i => i.status === WorkflowInstanceStatus.CANCELLED);
    const onTime = slaAnalysis.onTimeInstances;
    const overdue = slaAnalysis.overdueInstances;
    // Running + overdue (currently running and past SLA)
    const runningOverdue = running.filter(i => slaAnalysis.instanceOverdue.get(i.id));

    return { total, running, completed, rejected, cancelled, onTime, overdue, runningOverdue };
  }, [filteredInstances, slaAnalysis]);

  // ==================== CHART DATA ====================
  const pieData = useMemo(() => [
    { name: 'Đang xử lý', value: stats.running.length },
    { name: 'Hoàn thành', value: stats.completed.length },
    { name: 'Từ chối', value: stats.rejected.length },
    { name: 'Đã hủy', value: stats.cancelled.length },
  ].filter(d => d.value > 0), [stats]);

  const barData = useMemo(() => {
    return templates.filter(t => t.isActive).map(t => {
      const tInstances = filteredInstances.filter(i => i.templateId === t.id);
      return {
        name: t.name.length > 15 ? t.name.slice(0, 15) + '...' : t.name,
        fullName: t.name,
        total: tInstances.length,
        running: tInstances.filter(i => i.status === WorkflowInstanceStatus.RUNNING).length,
        completed: tInstances.filter(i => i.status === WorkflowInstanceStatus.COMPLETED).length,
        rejected: tInstances.filter(i => i.status === WorkflowInstanceStatus.REJECTED).length,
      };
    }).filter(d => d.total > 0);
  }, [templates, filteredInstances]);

  // ==================== EMPLOYEE RANKINGS ====================
  const employeeStats = useMemo(() => {
    // actedBy stats from logs
    const userActions = new Map<string, { assigned: number; processed: number; onTime: number; overdue: number; assignedList: WorkflowInstance[]; processedList: WorkflowInstance[]; onTimeList: WorkflowInstance[]; overdueList: WorkflowInstance[] }>();

    // For "assigned" — count how many nodes have assigneeUserId = this user
    // For "processed" — count how many logs this user has (APPROVED/REJECTED actions)
    const processActions = new Set([WorkflowInstanceAction.APPROVED, WorkflowInstanceAction.REJECTED]);

    // Count assignments (nodes where user is the assignee)
    nodes.forEach(node => {
      if (node.config.assigneeUserId) {
        const uid = node.config.assigneeUserId;
        // Count instances that reached this node
        const reachedInstances = filteredInstances.filter(inst => {
          if (inst.templateId !== node.templateId) return false;
          const instLogs = logs.filter(l => l.instanceId === inst.id && l.nodeId === node.id);
          return instLogs.length > 0 || inst.currentNodeId === node.id;
        });
        const entry = userActions.get(uid) || { assigned: 0, processed: 0, onTime: 0, overdue: 0, assignedList: [], processedList: [], onTimeList: [], overdueList: [] };
        entry.assigned += reachedInstances.length;
        entry.assignedList.push(...reachedInstances);
        userActions.set(uid, entry);
      }
    });

    // Count processing
    logs.forEach(log => {
      if (!processActions.has(log.action)) return;
      const uid = log.actedBy;
      const inst = filteredInstances.find(i => i.id === log.instanceId);
      if (!inst) return;
      const entry = userActions.get(uid) || { assigned: 0, processed: 0, onTime: 0, overdue: 0, assignedList: [], processedList: [], onTimeList: [], overdueList: [] };
      entry.processed++;
      entry.processedList.push(inst);

      // Check if this specific action was on time
      const node = nodes.find(n => n.id === log.nodeId);
      if (node?.config.slaHours) {
        const nodeStat = slaAnalysis.nodeStats.get(node.id);
        if (nodeStat) {
          const isOverdue = nodeStat.overdueInstances.some(oi => oi.id === inst.id);
          if (isOverdue) {
            entry.overdue++;
            entry.overdueList.push(inst);
          } else {
            entry.onTime++;
            entry.onTimeList.push(inst);
          }
        } else {
          entry.onTime++;
          entry.onTimeList.push(inst);
        }
      } else {
        entry.onTime++;
        entry.onTimeList.push(inst);
      }

      userActions.set(uid, entry);
    });

    // Convert to sorted arrays
    const entries = Array.from(userActions.entries()).map(([uid, data]) => ({
      userId: uid,
      userName: users.find(u => u.id === uid)?.name || uid.slice(0, 8),
      ...data,
    }));

    return {
      mostAssigned: [...entries].sort((a, b) => b.assigned - a.assigned).slice(0, 5),
      mostProcessed: [...entries].sort((a, b) => b.processed - a.processed).slice(0, 5),
      mostOnTime: [...entries].sort((a, b) => b.onTime - a.onTime).slice(0, 5),
      mostOverdue: [...entries].sort((a, b) => b.overdue - a.overdue).filter(e => e.overdue > 0).slice(0, 5),
    };
  }, [nodes, logs, filteredInstances, users, slaAnalysis]);

  // ==================== NODE DELAY RANKING ====================
  const delayedNodes = useMemo((): NodeSlaInfo[] => {
    return (Array.from(slaAnalysis.nodeStats.values()) as NodeSlaInfo[])
      .filter(n => n.overdueCount > 0)
      .sort((a, b) => b.overdueCount - a.overdueCount)
      .slice(0, 10);
  }, [slaAnalysis]);

  // ==================== HELPERS ====================
  const openDrillDown = (title: string, list: WorkflowInstance[]) => {
    // Deduplicate
    const unique = Array.from(new Map(list.map(i => [i.id, i])).values());
    setDrillDown({ title, instances: unique });
  };

  const getStatusBadge = (status: WorkflowInstanceStatus) => {
    const cfg = STATUS_CONFIG[status];
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black ${cfg.bg} border`}>
        <Icon size={10} /> {cfg.label}
      </span>
    );
  };

  const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || userId.slice(0, 8);
  const getTemplateName = (templateId: string) => templates.find(t => t.id === templateId)?.name || '—';

  // ==================== RENDER ====================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <BarChart3 className="text-violet-500" size={28} /> Dashboard Quy Trình
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Tổng hợp thống kê và phân tích hiệu suất quy trình duyệt.</p>
        </div>
      </div>

      {/* Time Range Filter */}
      <div className="glass-panel rounded-2xl p-3 flex flex-col md:flex-row items-start md:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <CalendarRange size={14} className="text-violet-500" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Khoảng thời gian:</span>
        </div>
        {/* Presets */}
        <div className="flex gap-1 flex-wrap">
          {(Object.keys(PRESET_LABELS) as DatePreset[]).map(preset => (
            <button key={preset} onClick={() => handlePreset(preset)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all ${
                activePreset === preset && (dateFrom || dateTo || preset === 'all')
                  ? 'bg-violet-500 text-white shadow-md shadow-violet-500/30'
                  : 'bg-white/50 dark:bg-slate-800/50 text-slate-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 border border-slate-200 dark:border-slate-700'
              }`}>
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        {/* Custom date inputs */}
        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar size={12} className="text-slate-400" />
          <input type="date" value={dateFrom} onChange={e => handleCustomDate('from', e.target.value)}
            className="px-2.5 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300 w-32" />
          <span className="text-[10px] text-slate-400 font-bold">→</span>
          <input type="date" value={dateTo} onChange={e => handleCustomDate('to', e.target.value)}
            className="px-2.5 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300 w-32" />
        </div>
        {(dateFrom || dateTo) && (
          <span className="text-[10px] text-violet-500 font-bold bg-violet-50 dark:bg-violet-900/20 px-2 py-1 rounded-lg">
            {filteredInstances.length}/{instances.length} phiếu
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Tổng phiếu', value: stats.total, icon: GitBranch, color: 'from-slate-500 to-slate-600', list: filteredInstances, key: 'total' },
          { label: 'Đang xử lý', value: stats.running.length, icon: Clock, color: 'from-blue-500 to-blue-600', list: stats.running, key: 'running' },
          { label: 'Hoàn thành', value: stats.completed.length, icon: CheckCircle, color: 'from-emerald-500 to-emerald-600', list: stats.completed, key: 'completed' },
          { label: 'Đúng hạn', value: stats.onTime.length, icon: Target, color: 'from-green-500 to-teal-500', list: stats.onTime, key: 'onTime' },
          { label: 'Trễ hạn', value: stats.overdue.length + stats.runningOverdue.length, icon: AlertTriangle, color: 'from-amber-500 to-orange-500', list: [...stats.overdue, ...stats.runningOverdue], key: 'overdue' },
          { label: 'Từ chối', value: stats.rejected.length, icon: XCircle, color: 'from-red-500 to-rose-500', list: stats.rejected, key: 'rejected' },
          { label: 'Đã hủy', value: stats.cancelled.length, icon: XCircle, color: 'from-slate-400 to-slate-500', list: stats.cancelled, key: 'cancelled' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <button key={card.key} onClick={() => openDrillDown(card.label, card.list)}
              className="glass-panel rounded-2xl p-4 text-left hover:shadow-lg hover:scale-[1.02] transition-all group cursor-pointer border border-transparent hover:border-violet-200 dark:hover:border-violet-800">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white shadow-sm mb-2`}>
                <Icon size={18} />
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{card.value}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{card.label}</p>
              <p className="text-[9px] text-violet-400 font-bold mt-1 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5">
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
            <TrendingUp size={16} className="text-violet-500" /> Phân bổ trạng thái
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
            <BarChart3 size={16} className="text-violet-500" /> Phiếu theo mẫu quy trình
          </h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData} barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 700 }} />
                <Bar dataKey="running" name="Đang xử lý" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Hoàn thành" fill="#10B981" radius={[4, 4, 0, 0]} />
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
          { title: '🏆 Giao việc nhiều nhất', data: employeeStats.mostAssigned, field: 'assigned' as const, listField: 'assignedList' as const, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { title: '⚡ Xử lý nhiều nhất', data: employeeStats.mostProcessed, field: 'processed' as const, listField: 'processedList' as const, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
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
                    <ChevronRight size={12} className="text-slate-300 group-hover:text-violet-400 transition" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Delayed Nodes Analysis */}
      {delayedNodes.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2">
            <Timer size={16} className="text-amber-500" /> Giai đoạn trễ hạn nhiều nhất
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase tracking-wider text-[10px]">Giai đoạn</th>
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase tracking-wider text-[10px]">Mẫu QT</th>
                  <th className="px-4 py-2.5 text-center font-black text-slate-500 uppercase tracking-wider text-[10px]">SLA (giờ)</th>
                  <th className="px-4 py-2.5 text-center font-black text-slate-500 uppercase tracking-wider text-[10px]">TB thực tế</th>
                  <th className="px-4 py-2.5 text-center font-black text-slate-500 uppercase tracking-wider text-[10px]">Tổng phiếu</th>
                  <th className="px-4 py-2.5 text-center font-black text-red-500 uppercase tracking-wider text-[10px]">Trễ hạn</th>
                  <th className="px-4 py-2.5 text-center font-black text-slate-500 uppercase tracking-wider text-[10px]">Tỷ lệ trễ</th>
                  <th className="px-4 py-2.5 text-center font-black text-slate-500 uppercase tracking-wider text-[10px]"></th>
                </tr>
              </thead>
              <tbody>
                {delayedNodes.map((node, idx) => (
                  <tr key={node.nodeId} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'} hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition`}>
                    <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">{node.nodeLabel}</td>
                    <td className="px-4 py-2.5 text-slate-500">{node.templateName}</td>
                    <td className="px-4 py-2.5 text-center text-slate-500 font-mono">{node.slaHours}h</td>
                    <td className="px-4 py-2.5 text-center font-mono">
                      <span className={node.avgHours > node.slaHours ? 'text-red-500 font-bold' : 'text-emerald-500'}>
                        {node.avgHours.toFixed(1)}h
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center font-bold">{node.totalInstances}</td>
                    <td className="px-4 py-2.5 text-center font-black text-red-500">{node.overdueCount}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                        node.overdueCount / node.totalInstances > 0.5
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {((node.overdueCount / node.totalInstances) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => openDrillDown(`Trễ hạn — ${node.nodeLabel}`, node.overdueInstances)}
                        className="px-2.5 py-1 bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 rounded-lg text-[10px] font-bold hover:bg-violet-200 transition flex items-center gap-1 mx-auto">
                        Xem <ArrowRight size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== DRILL-DOWN MODAL ==================== */}
      {drillDown && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-violet-500 to-purple-500 rounded-t-3xl flex items-center justify-between shrink-0">
              <span className="font-bold text-lg text-white flex items-center gap-2">
                <Zap size={18} /> {drillDown.title} ({drillDown.instances.length})
              </span>
              <button onClick={() => setDrillDown(null)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center">
                <X size={18} />
              </button>
            </div>
            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {drillDown.instances.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">Không có phiếu nào</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {drillDown.instances.map(inst => (
                    <div key={inst.id} className="px-6 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="text-[10px] font-mono font-bold text-violet-500 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded">{inst.code}</span>
                            {getStatusBadge(inst.status)}
                          </div>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{inst.title}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
                            <span><Users size={10} className="inline mr-0.5" />{getUserName(inst.createdBy)}</span>
                            <span><GitBranch size={10} className="inline mr-0.5" />{getTemplateName(inst.templateId)}</span>
                            <span>{new Date(inst.createdAt).toLocaleDateString('vi-VN')}</span>
                          </div>
                        </div>
                        {slaAnalysis.instanceOverdue.get(inst.id) && (
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

export default WorkflowDashboard;
