import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useWorkflow } from '../context/WorkflowContext';
import { useRequest } from '../context/RequestContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import {
  LayoutGrid, Plus, Save, X, GripVertical, Trash2, Settings2,
  ChevronDown, Package, AlertTriangle, TrendingUp, Users, Briefcase,
  Monitor, Clock, Sparkles, ArrowRight, RefreshCw, Maximize2, Minimize2,
  Edit3, Check, MoreVertical, Eye
} from 'lucide-react';
import { WidgetConfig, WidgetType, WIDGET_CATALOG, KPI_METRICS, CHART_DATA_SOURCES, DEFAULT_LAYOUT, DashboardLayout } from '../lib/widgetRegistry';
import { dashboardService } from '../lib/dashboardService';
import { xpService, UserXP, LEVELS } from '../lib/xpService';
import { WorkflowInstanceStatus } from '../types';

// ══════════════════════════════════════════
//  CUSTOM DASHBOARD — Drag-Drop Widget Grid
// ══════════════════════════════════════════

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

// ═════════ KPI Widget ═════════
const KPIWidget: React.FC<{ config: WidgetConfig; data: any }> = ({ config, data }) => {
  const metric = KPI_METRICS.find(m => m.id === config.metric);
  const value = data[config.metric || ''] ?? 0;
  const formatted = typeof value === 'number' && value > 1000000
    ? `${(value / 1000000).toFixed(1)}M`
    : typeof value === 'number' && value > 1000
    ? `${(value / 1000).toFixed(0)}K`
    : String(value);

  return (
    <div className="h-full flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{config.title}</span>
        <span className="text-lg">{metric?.icon || '📊'}</span>
      </div>
      <div className="flex-1 flex items-center">
        <span className={`text-3xl font-black bg-gradient-to-r ${metric?.color || 'from-blue-500 to-cyan-500'} bg-clip-text text-transparent`}>
          {formatted}
        </span>
      </div>
      <div className="text-[10px] text-slate-400 font-medium mt-1">{metric?.module || ''}</div>
    </div>
  );
};

// ═════════ Bar Chart Widget ═════════
const BarChartWidget: React.FC<{ config: WidgetConfig; data: any[] }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{config.title}</div>
    <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 12, border: 'none', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }} />
          <Bar dataKey="value" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
          <defs>
            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

// ═════════ Line Chart Widget ═════════
const LineChartWidget: React.FC<{ config: WidgetConfig; data: any[] }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{config.title}</div>
    <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 12, border: 'none', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }} />
          <Area type="monotone" dataKey="value" stroke="#6366f1" fill="url(#areaGradient)" strokeWidth={2} />
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

// ═════════ Pie Chart Widget ═════════
const PieChartWidget: React.FC<{ config: WidgetConfig; data: any[] }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{config.title}</div>
    <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="40%" outerRadius="75%" paddingAngle={3}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-1 mt-1">
        {data.slice(0, 4).map((d, i) => (
          <span key={i} className="text-[9px] flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  </div>
);

// ═════════ Data Table Widget ═════════
const DataTableWidget: React.FC<{ config: WidgetConfig; data: any[] }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{config.title}</div>
    <div className="flex-1 overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-white dark:bg-slate-800">
          <tr className="border-b border-slate-100 dark:border-slate-700">
            <th className="text-left py-1.5 px-2 text-slate-400 font-bold">Tên</th>
            <th className="text-right py-1.5 px-2 text-slate-400 font-bold">Tồn kho</th>
            <th className="text-right py-1.5 px-2 text-slate-400 font-bold">Tối thiểu</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, config.limit || 10).map((item, i) => (
            <tr key={i} className="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
              <td className="py-1.5 px-2 font-medium text-slate-700 dark:text-slate-300 truncate max-w-[140px]">{item.name}</td>
              <td className={`py-1.5 px-2 text-right font-bold ${item.stock < item.minStock ? 'text-red-500' : 'text-slate-600 dark:text-slate-400'}`}>
                {item.stock}
              </td>
              <td className="py-1.5 px-2 text-right text-slate-400">{item.minStock}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && <div className="text-center text-slate-400 text-xs py-6">Không có dữ liệu</div>}
    </div>
  </div>
);

// ═════════ Alert List Widget ═════════
const AlertListWidget: React.FC<{ config: WidgetConfig; data: any[] }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{config.title}</div>
    <div className="flex-1 overflow-auto space-y-1.5">
      {data.slice(0, config.limit || 5).map((alert, i) => (
        <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-[11px] ${
          alert.severity === 'critical' ? 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30' :
          alert.severity === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30' :
          'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30'
        }`}>
          <span className="text-sm mt-0.5">{alert.icon || '⚠️'}</span>
          <div className="min-w-0">
            <div className="font-bold text-slate-700 dark:text-slate-300">{alert.title}</div>
            <div className="text-slate-500 dark:text-slate-400 truncate">{alert.message}</div>
          </div>
        </div>
      ))}
      {data.length === 0 && <div className="text-center text-slate-400 text-xs py-6">✅ Không có cảnh báo</div>}
    </div>
  </div>
);

// ═════════ Activity Feed Widget ═════════
const ActivityFeedWidget: React.FC<{ config: WidgetConfig; data: any[] }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{config.title}</div>
    <div className="flex-1 overflow-auto space-y-1">
      {data.slice(0, config.limit || 8).map((act, i) => (
        <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/50 last:border-0">
          <div className={`w-1.5 h-1.5 mt-1.5 rounded-full shrink-0 ${
            act.status === 'SUCCESS' ? 'bg-green-400' : act.status === 'DANGER' ? 'bg-red-400' : act.status === 'WARNING' ? 'bg-amber-400' : 'bg-blue-400'
          }`} />
          <div className="min-w-0 text-[11px]">
            <div className="text-slate-700 dark:text-slate-300 font-medium truncate">{act.description}</div>
            <div className="text-slate-400 text-[9px]">{act.timestamp ? new Date(act.timestamp).toLocaleString('vi-VN') : ''}</div>
          </div>
        </div>
      ))}
      {data.length === 0 && <div className="text-center text-slate-400 text-xs py-6">Chưa có hoạt động</div>}
    </div>
  </div>
);

// ═════════ AI Insight Widget ═════════
const AIInsightWidget: React.FC<{ config: WidgetConfig; data: any }> = ({ config, data }) => (
  <div className="h-full flex flex-col">
    <div className="flex items-center gap-2 mb-2">
      <Sparkles className="w-4 h-4 text-violet-500" />
      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{config.title}</span>
    </div>
    <div className="flex-1 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed overflow-auto">
      {data?.insight || (
        <div className="flex items-center gap-2 text-slate-400">
          <div className="animate-pulse flex gap-1">
            <div className="w-1 h-1 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>Đang phân tích dữ liệu...</span>
        </div>
      )}
    </div>
  </div>
);

// ═════════ XP Leaderboard Widget ═════════
const XPLeaderboardWidget: React.FC<{ config: WidgetConfig; data: { leaderboard: UserXP[]; users: any[]; currentUserId: string } }> = ({ config, data }) => {
  const MEDALS = ['🥇', '🥈', '🥉'];
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">🏆</span>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{config.title}</span>
      </div>
      <div className="flex-1 overflow-auto space-y-0.5">
        {data.leaderboard.map((entry, i) => {
          const userInfo = data.users.find((u: any) => u.id === entry.userId);
          const levelInfo = LEVELS.find(l => l.level === entry.level) || LEVELS[0];
          const isMe = entry.userId === data.currentUserId;
          return (
            <div key={entry.userId} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg transition-all ${
              isMe ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-200 dark:ring-indigo-700' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}>
              <span className="w-5 text-center text-xs font-black">
                {i < 3 ? MEDALS[i] : <span className="text-slate-400">#{i + 1}</span>}
              </span>
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                {(userInfo?.name || entry.userId)?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[11px] font-bold truncate ${isMe ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>
                  {userInfo?.name || entry.userId.slice(0, 8)}
                  {isMe && <span className="ml-1 text-[8px] text-indigo-400">(bạn)</span>}
                </div>
              </div>
              <span className="text-xs">{levelInfo.icon}</span>
              <div className="text-right shrink-0">
                <div className={`text-[11px] font-black ${i === 0 ? 'text-amber-500' : i < 3 ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500'}`}>
                  {entry.totalXp.toLocaleString()} XP
                </div>
                {entry.streakDays > 0 && (
                  <div className="text-[8px] text-orange-400">🔥 {entry.streakDays}d</div>
                )}
              </div>
            </div>
          );
        })}
        {data.leaderboard.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-6">Chưa có dữ liệu XP</div>
        )}
      </div>
    </div>
  );
};


// ═════════ ADD WIDGET PANEL ═════════
const AddWidgetPanel: React.FC<{
  onAdd: (type: WidgetType, metric?: string, dataSource?: string) => void;
  onClose: () => void;
}> = ({ onAdd, onClose }) => {
  const [selectedType, setSelectedType] = useState<WidgetType | null>(null);
  const [selectedMetric, setSelectedMetric] = useState('');
  const [selectedDataSource, setSelectedDataSource] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-black text-sm text-slate-800 dark:text-white">➕ Thêm Widget</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 overflow-auto max-h-[60vh]">
          {!selectedType ? (
            <div className="grid grid-cols-2 gap-2">
              {WIDGET_CATALOG.map(w => (
                <button
                  key={w.type}
                  onClick={() => setSelectedType(w.type)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition-all text-center group"
                >
                  <span className="text-2xl group-hover:scale-110 transition-transform">{w.icon}</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{w.label}</span>
                  <span className="text-[10px] text-slate-400 leading-tight">{w.description}</span>
                </button>
              ))}
            </div>
          ) : selectedType === 'kpi_card' ? (
            <div className="space-y-2">
              <button onClick={() => setSelectedType(null)} className="text-xs text-indigo-500 hover:underline mb-2">← Quay lại</button>
              <p className="text-xs font-bold text-slate-500 mb-3">Chọn chỉ số KPI:</p>
              {KPI_METRICS.map(m => (
                <button
                  key={m.id}
                  onClick={() => onAdd('kpi_card', m.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition-all text-left"
                >
                  <span className="text-lg">{m.icon}</span>
                  <div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{m.label}</div>
                    <div className="text-[10px] text-slate-400">{m.module}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : ['bar_chart', 'line_chart', 'pie_chart'].includes(selectedType) ? (
            <div className="space-y-2">
              <button onClick={() => setSelectedType(null)} className="text-xs text-indigo-500 hover:underline mb-2">← Quay lại</button>
              <p className="text-xs font-bold text-slate-500 mb-3">Chọn nguồn dữ liệu:</p>
              {CHART_DATA_SOURCES.map(ds => (
                <button
                  key={ds.id}
                  onClick={() => onAdd(selectedType, undefined, ds.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition-all text-left"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{ds.label}</div>
                    <div className="text-[10px] text-slate-400">{ds.module}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            // Direct add for data_table, alert_list, activity_feed, ai_insight
            (() => { onAdd(selectedType); return null; })()
          )}
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════
//  MAIN CUSTOM DASHBOARD
// ═══════════════════════════════════════════════
const CustomDashboard: React.FC = () => {
  const { items, transactions, activities, user, users, categories, warehouses, employees, requests, projectFinances, assets } = useApp();
  const { instances: wfInstances } = useWorkflow();
  const { requests: rqRequests } = useRequest();

  const [layout, setLayout] = useState<WidgetConfig[]>(DEFAULT_LAYOUT);
  const [savedLayout, setSavedLayout] = useState<DashboardLayout | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);

  // Load saved layout on mount
  useEffect(() => {
    dashboardService.getActiveLayout(user.id).then(dl => {
      setSavedLayout(dl);
      if (dl.layout && dl.layout.length > 0) setLayout(dl.layout);
    }).catch(err => console.error('Load dashboard layout:', err));
  }, [user.id]);

  // Load XP leaderboard
  const [xpLeaderboard, setXpLeaderboard] = useState<UserXP[]>([]);
  useEffect(() => {
    xpService.getLeaderboard(10).then(setXpLeaderboard).catch(() => {});
  }, []);

  // ═════════ Compute KPI Data ═════════
  const kpiData = useMemo(() => {
    const totalStock = items.reduce((sum, it) => {
      const stock = Object.values(it.stockByWarehouse || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      return sum + stock;
    }, 0);
    const lowStock = items.filter(it => {
      const stock = Object.values(it.stockByWarehouse || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      return stock < (it.minStock || 0) && it.minStock > 0;
    }).length;
    const totalValue = items.reduce((sum: number, it) => {
      const stock = Object.values(it.stockByWarehouse || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) as number;
      return sum + stock * ((it as any).priceIn || 0);
    }, 0);
    const pendingReq = requests.filter(r => r.status === 'PENDING').length;
    const pendingWf = wfInstances.filter(i => i.status === 'RUNNING' as WorkflowInstanceStatus).length;

    return {
      totalInventory: items.length,
      lowStock,
      totalValue,
      pendingRequests: pendingReq,
      totalEmployees: employees.length,
      activeProjects: projectFinances.length,
      totalAssets: assets.length,
      pendingWorkflows: pendingWf,
    };
  }, [items, requests, employees, projectFinances, assets, wfInstances]);

  // ═════════ Compute Chart Data ═════════
  const chartData = useMemo(() => {
    // Inventory by category
    const catMap: Record<string, number> = {};
    items.forEach(it => {
      const cat = it.category || 'Khác';
      const stock = Object.values(it.stockByWarehouse || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) as number;
      catMap[cat] = (catMap[cat] || 0) + (stock as number);
    });
    const inventoryByCategory = Object.entries(catMap).map(([name, value]) => ({ name: name.length > 12 ? name.slice(0, 12) + '…' : name, value }));

    // Inventory by warehouse
    const whMap: Record<string, number> = {};
    items.forEach(it => {
      Object.entries(it.stockByWarehouse || {}).forEach(([whId, qty]) => {
        const wh = warehouses.find(w => w.id === whId);
        const name = wh?.name || whId;
        whMap[name] = (whMap[name] || 0) + (Number(qty) || 0);
      });
    });
    const inventoryByWarehouse = Object.entries(whMap).map(([name, value]) => ({ name: name.length > 12 ? name.slice(0, 12) + '…' : name, value }));

    // Transactions last 7 days
    const days: Record<string, number> = {};
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      days[d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })] = 0;
    }
    transactions.forEach(tx => {
      const d = new Date(tx.date);
      if (now - d.getTime() < 7 * 86400000) {
        const key = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        if (key in days) days[key]++;
      }
    });
    const transactionsLastWeek = Object.entries(days).map(([name, value]) => ({ name, value }));

    // Requests by status
    const statusMap: Record<string, number> = {};
    requests.forEach(r => { statusMap[r.status] = (statusMap[r.status] || 0) + 1; });
    const requestsByStatus = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

    // Low stock items
    const lowStockItems = items
      .map(it => {
        const stock = Object.values(it.stockByWarehouse || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
        return { name: it.name, stock, minStock: it.minStock || 0 };
      })
      .filter(it => it.minStock > 0)
      .sort((a, b) => (a.stock / a.minStock) - (b.stock / b.minStock))
      .slice(0, 10);

    return { inventoryByCategory, inventoryByWarehouse, transactionsLastWeek, requestsByStatus, lowStockItems };
  }, [items, transactions, requests, warehouses]);

  // ═════════ Compute Alert Data ═════════
  const alertData = useMemo(() => {
    const alerts: any[] = [];
    // Low stock alerts
    items.forEach(it => {
      const stock = Object.values(it.stockByWarehouse || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      if (it.minStock && stock < it.minStock) {
        alerts.push({
          severity: stock === 0 ? 'critical' : 'warning',
          icon: stock === 0 ? '🔴' : '🟡',
          title: `${it.name} — ${stock === 0 ? 'HẾT HÀNG' : 'sắp hết'}`,
          message: `Tồn: ${stock} / Min: ${it.minStock}`,
        });
      }
    });
    return alerts.sort((a, b) => (a.severity === 'critical' ? -1 : 1));
  }, [items]);

  // AI insight (simple auto-gen)
  const aiInsight = useMemo(() => {
    const alerts = alertData.length;
    const pending = kpiData.pendingRequests + kpiData.pendingWorkflows;
    if (alerts === 0 && pending === 0) return { insight: '✅ Hệ thống vận hành bình thường. Không có cảnh báo hay phiếu chờ xử lý.' };
    let text = `📋 Tóm tắt: `;
    if (alerts > 0) text += `${alerts} vật tư cần bổ sung. `;
    if (kpiData.pendingRequests > 0) text += `${kpiData.pendingRequests} phiếu đề xuất chờ duyệt. `;
    if (kpiData.pendingWorkflows > 0) text += `${kpiData.pendingWorkflows} quy trình đang chạy. `;
    text += `\n\n💡 Đề xuất: Xử lý phiếu chờ trước để tránh nghẽn cổ chai.`;
    return { insight: text };
  }, [alertData, kpiData]);

  // ═════════ Get widget chart data by dataSource ═════════
  const getChartData = useCallback((dataSource?: string) => {
    if (!dataSource) return [];
    return (chartData as any)[dataSource] || [];
  }, [chartData]);

  // ═════════ Render Widget Content ═════════
  const renderWidget = useCallback((config: WidgetConfig) => {
    switch (config.type) {
      case 'kpi_card': return <KPIWidget config={config} data={kpiData} />;
      case 'bar_chart': return <BarChartWidget config={config} data={getChartData(config.dataSource)} />;
      case 'line_chart': return <LineChartWidget config={config} data={getChartData(config.dataSource)} />;
      case 'pie_chart': return <PieChartWidget config={config} data={getChartData(config.dataSource)} />;
      case 'data_table': return <DataTableWidget config={config} data={chartData.lowStockItems} />;
      case 'alert_list': return <AlertListWidget config={config} data={alertData} />;
      case 'activity_feed': return <ActivityFeedWidget config={config} data={activities.slice(0, config.limit || 8)} />;
      case 'ai_insight': return <AIInsightWidget config={config} data={aiInsight} />;
      case 'xp_leaderboard': return <XPLeaderboardWidget config={config} data={{ leaderboard: xpLeaderboard, users, currentUserId: user?.id }} />;
      default: return <div className="text-xs text-slate-400">Widget không xác định</div>;
    }
  }, [kpiData, getChartData, chartData, alertData, activities, aiInsight, xpLeaderboard, users, user]);

  // ═════════ Add Widget ═════════
  const handleAddWidget = useCallback((type: WidgetType, metric?: string, dataSource?: string) => {
    const catalog = WIDGET_CATALOG.find(c => c.type === type);
    const id = `w_${Date.now()}`;
    const maxRow = layout.reduce((m, w) => Math.max(m, w.row + w.rowSpan), 1);
    const title = type === 'kpi_card'
      ? KPI_METRICS.find(m => m.id === metric)?.label || 'KPI'
      : type === 'activity_feed' ? 'Hoạt động gần đây'
      : type === 'alert_list' ? 'Cảnh báo thông minh'
      : type === 'ai_insight' ? 'AI Insight'
      : CHART_DATA_SOURCES.find(d => d.id === dataSource)?.label || catalog?.label || 'Widget';

    const newWidget: WidgetConfig = {
      id,
      type,
      title,
      col: 1,
      row: maxRow,
      colSpan: catalog?.defaultColSpan || 1,
      rowSpan: catalog?.defaultRowSpan || 1,
      metric,
      dataSource,
    };
    setLayout(prev => [...prev, newWidget]);
    setShowAddPanel(false);
  }, [layout]);

  // ═════════ Remove Widget ═════════
  const handleRemoveWidget = useCallback((id: string) => {
    setLayout(prev => prev.filter(w => w.id !== id));
  }, []);

  // ═════════ Save Layout ═════════
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (savedLayout) {
        await dashboardService.updateLayout(savedLayout.id, { layout });
      } else {
        const dl = await dashboardService.createLayout(user.id, 'Mặc định', layout, true);
        setSavedLayout(dl);
      }
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
      setIsEditing(false);
    } catch (err) {
      console.error('Save dashboard error:', err);
    }
    setIsSaving(false);
  }, [layout, savedLayout, user.id]);

  // ═════════ Drag handlers ═════════
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    setLayout(prev => {
      const arr = [...prev];
      const dragIdx = arr.findIndex(w => w.id === dragId);
      const targetIdx = arr.findIndex(w => w.id === targetId);
      if (dragIdx === -1 || targetIdx === -1) return arr;
      // Swap positions
      const dragWidget = arr[dragIdx];
      const targetWidget = arr[targetIdx];
      const tempPos = { col: dragWidget.col, row: dragWidget.row, colSpan: dragWidget.colSpan, rowSpan: dragWidget.rowSpan };
      arr[dragIdx] = { ...dragWidget, col: targetWidget.col, row: targetWidget.row, colSpan: targetWidget.colSpan, rowSpan: targetWidget.rowSpan };
      arr[targetIdx] = { ...targetWidget, ...tempPos };
      return arr;
    });
    setDragId(null);
  };

  // ═════════ Reset to default ═════════
  const handleReset = () => setLayout([...DEFAULT_LAYOUT]);

  return (
    <div className="space-y-4 md:space-y-6 mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-indigo-500" />
            Dashboard
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {isEditing ? '🔧 Chế độ chỉnh sửa — kéo thả widget để thay đổi vị trí' : 'Tổng quan hoạt động'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button onClick={() => setShowAddPanel(true)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500 text-white rounded-xl text-xs font-bold hover:bg-indigo-600 transition active:scale-95">
                <Plus className="w-3.5 h-3.5" /> Thêm Widget
              </button>
              <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition">
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                  saveFlash ? 'bg-green-500 text-white' : 'bg-emerald-500 text-white hover:bg-emerald-600'
                }`}
              >
                {saveFlash ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {isSaving ? 'Đang lưu...' : saveFlash ? 'Đã lưu!' : 'Lưu'}
              </button>
              <button onClick={() => setIsEditing(false)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </>
          ) : (
            <button onClick={() => setIsEditing(true)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95">
              <Edit3 className="w-3.5 h-3.5" /> Tuỳ chỉnh
            </button>
          )}
        </div>
      </div>

      {/* Widget Grid */}
      <div
        className="grid dash-grid gap-3 md:gap-4 pb-20 lg:pb-0"
        style={{
          gridAutoRows: 'minmax(130px, auto)',
        }}
      >
        <style>{`
          .dash-grid { grid-template-columns: 1fr; }
          @media (min-width: 640px) { .dash-grid { grid-template-columns: repeat(2, 1fr); } }
          @media (min-width: 1024px) { .dash-grid { grid-template-columns: repeat(4, 1fr); } }
        `}</style>
        {layout.map((widget) => (
          <div
            key={widget.id}
            className={`relative rounded-2xl p-3 md:p-4 transition-all duration-200 ${
              isEditing
                ? `border-2 border-dashed ${dragId === widget.id ? 'border-indigo-400 opacity-50' : 'border-slate-300 dark:border-slate-600 hover:border-indigo-300'} cursor-move`
                : 'glass-card border border-slate-100 dark:border-slate-700/50 hover:shadow-lg'
            }`}
            style={{
              gridColumn: window.innerWidth < 640
                ? '1 / -1'
                : window.innerWidth < 1024
                  ? `span ${Math.min(widget.colSpan, 2)}`
                  : `${widget.col} / span ${widget.colSpan}`,
              gridRow: window.innerWidth < 640
                ? 'auto'
                : `${widget.row} / span ${widget.rowSpan}`,
            }}
            draggable={isEditing}
            onDragStart={e => handleDragStart(e, widget.id)}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, widget.id)}
          >
            {/* Edit controls */}
            {isEditing && (
              <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
                <div className="p-1 cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <button
                  onClick={() => handleRemoveWidget(widget.id)}
                  className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-500" />
                </button>
              </div>
            )}

            {/* Widget content */}
            <div className={`h-full ${isEditing ? 'pointer-events-none opacity-70' : ''}`}>
              {renderWidget(widget)}
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {layout.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <LayoutGrid className="w-12 h-12 text-slate-300 mb-4" />
          <p className="text-slate-400 text-sm mb-4">Dashboard trống — thêm widget để bắt đầu</p>
          <button onClick={() => { setIsEditing(true); setShowAddPanel(true); }} className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-xs font-bold hover:bg-indigo-600 transition">
            <Plus className="w-4 h-4 inline mr-1" /> Thêm Widget đầu tiên
          </button>
        </div>
      )}

      {/* Add Widget Panel */}
      {showAddPanel && <AddWidgetPanel onAdd={handleAddWidget} onClose={() => setShowAddPanel(false)} />}
    </div>
  );
};

export default CustomDashboard;
