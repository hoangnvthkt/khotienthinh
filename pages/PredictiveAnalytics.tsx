import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, Legend, Cell
} from 'recharts';
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Briefcase, Activity,
  ArrowDown, ArrowUp, Minus, RefreshCw, Filter, BarChart3
} from 'lucide-react';
import {
  forecastStock, analyzeBudgetBurndown, detectAnomalies,
  StockForecast, BudgetBurndown, Anomaly
} from '../lib/predictiveService';
import { useModuleData } from '../hooks/useModuleData';

// ══════════════════════════════════════════
//  PREDICTIVE ANALYTICS PAGE
// ══════════════════════════════════════════

type TabType = 'stock' | 'budget' | 'anomalies';

const PredictiveAnalytics: React.FC = () => {
  const { items, transactions, projectFinances, constructionSites } = useApp();
  useModuleData('wms');
  useModuleData('da');
  const [tab, setTab] = useState<TabType>('stock');
  const [selectedForecast, setSelectedForecast] = useState<string | null>(null);

  // ═════════ Compute Data ═════════
  const stockForecasts = useMemo(
    () => forecastStock(items, transactions, 30),
    [items, transactions]
  );

  const budgetAnalysis = useMemo(
    () => analyzeBudgetBurndown(projectFinances, constructionSites || []),
    [projectFinances, constructionSites]
  );

  const anomalies = useMemo(
    () => detectAnomalies(transactions, items),
    [transactions, items]
  );

  // ═════════ Summary KPIs ═════════
  const kpis = useMemo(() => {
    const stockoutRisk = stockForecasts.filter(f => f.daysUntilStockout !== null && f.daysUntilStockout <= 14).length;
    const budgetWarning = budgetAnalysis.filter(b => b.status !== 'healthy').length;
    const highAnomalies = anomalies.filter(a => a.severity === 'high').length;
    return { stockoutRisk, budgetWarning, highAnomalies };
  }, [stockForecasts, budgetAnalysis, anomalies]);

  const TABS: { id: TabType; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'stock', label: 'Dự báo tồn kho', icon: <Package size={16} />, badge: kpis.stockoutRisk },
    { id: 'budget', label: 'Ngân sách dự án', icon: <Briefcase size={16} />, badge: kpis.budgetWarning },
    { id: 'anomalies', label: 'Bất thường', icon: <Activity size={16} />, badge: kpis.highAnomalies },
  ];

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/30">
              <BarChart3 size={20} />
            </div>
            Predictive Analytics
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 ml-[52px]">
            Dự báo thông minh • Phát hiện bất thường • Phân tích xu hướng
          </p>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`rounded-2xl p-5 border shadow-sm transition-all ${
          kpis.stockoutRisk > 0 ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
        }`}>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Package size={10} /> Rủi ro hết hàng (14 ngày)
          </div>
          <div className={`text-3xl font-black ${kpis.stockoutRisk > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {kpis.stockoutRisk}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">vật tư cần bổ sung</div>
        </div>
        <div className={`rounded-2xl p-5 border shadow-sm transition-all ${
          kpis.budgetWarning > 0 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
        }`}>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Briefcase size={10} /> Ngân sách cảnh báo
          </div>
          <div className={`text-3xl font-black ${kpis.budgetWarning > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {kpis.budgetWarning}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">dự án vượt/sắp vượt ngân sách</div>
        </div>
        <div className={`rounded-2xl p-5 border shadow-sm transition-all ${
          kpis.highAnomalies > 0 ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
        }`}>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <AlertTriangle size={10} /> Bất thường nghiêm trọng
          </div>
          <div className={`text-3xl font-black ${kpis.highAnomalies > 0 ? 'text-purple-600' : 'text-emerald-600'}`}>
            {kpis.highAnomalies}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">phát hiện hôm nay</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              tab === t.id
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t.icon} {t.label}
            {(t.badge || 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'stock' && <StockForecastTab forecasts={stockForecasts} selectedId={selectedForecast} onSelect={setSelectedForecast} />}
      {tab === 'budget' && <BudgetBurndownTab analysis={budgetAnalysis} />}
      {tab === 'anomalies' && <AnomalyTab anomalies={anomalies} />}
    </div>
  );
};

// ═════════ Stock Forecast Tab ═════════
const StockForecastTab: React.FC<{ forecasts: StockForecast[]; selectedId: string | null; onSelect: (id: string | null) => void }> = ({ forecasts, selectedId, onSelect }) => {
  const selected = forecasts.find(f => f.itemId === selectedId);
  const atRisk = forecasts.filter(f => f.daysUntilStockout !== null && f.daysUntilStockout <= 30);
  const safe = forecasts.filter(f => f.daysUntilStockout === null || f.daysUntilStockout > 30);

  return (
    <div className="space-y-4">
      {/* At Risk Items */}
      {atRisk.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-xs font-black text-red-600 dark:text-red-400 uppercase tracking-wide flex items-center gap-2">
              <AlertTriangle size={14} /> Rủi ro hết hàng ({atRisk.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {atRisk.map(f => (
              <button
                key={f.itemId}
                onClick={() => onSelect(f.itemId === selectedId ? null : f.itemId)}
                className={`w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition ${
                  selectedId === f.itemId ? 'bg-violet-50 dark:bg-violet-900/20' : ''
                }`}
              >
                <TrendingIcon trend={f.trend} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{f.itemName}</div>
                  <div className="text-[10px] text-slate-400">{f.itemSku} • {f.dailyConsumption} {f.unit}/ngày</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-slate-700 dark:text-slate-300">{f.currentStock} {f.unit}</div>
                  {f.daysUntilStockout !== null && (
                    <div className={`text-[10px] font-bold ${
                      f.daysUntilStockout <= 7 ? 'text-red-500' : f.daysUntilStockout <= 14 ? 'text-amber-500' : 'text-blue-500'
                    }`}>
                      Hết sau ~{f.daysUntilStockout} ngày
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Forecast Chart */}
      {selected && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5">
          <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4">
            📈 Dự báo tồn kho — {selected.itemName}
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={selected.forecastDays.map(p => ({
              date: p.date.slice(5),
              'Dự báo': Math.round(p.predicted),
              'Mức tối thiểu': selected.minStock,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Area type="monotone" dataKey="Dự báo" stroke="#6366f1" fill="#6366f140" strokeWidth={2} />
              <Line type="monotone" dataKey="Mức tối thiểu" stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Safe Items (collapsed) */}
      {safe.length > 0 && (
        <details className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <summary className="px-5 py-3 text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide cursor-pointer">
            ✅ Tồn kho ổn định ({safe.length})
          </summary>
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {safe.slice(0, 10).map(f => (
              <div key={f.itemId} className="px-5 py-2 flex items-center gap-3">
                <TrendingIcon trend={f.trend} />
                <span className="text-xs text-slate-600 dark:text-slate-400 flex-1 truncate">{f.itemName}</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{f.currentStock} {f.unit}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

// ═════════ Budget Burndown Tab ═════════
const BudgetBurndownTab: React.FC<{ analysis: BudgetBurndown[] }> = ({ analysis }) => (
  <div className="space-y-4">
    {analysis.length === 0 && (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-12 text-center">
        <Briefcase size={36} className="mx-auto mb-2 text-slate-200" />
        <p className="text-sm font-bold text-slate-400">Chưa có dự án đang hoạt động</p>
      </div>
    )}
    {analysis.map(b => (
      <div key={b.projectId} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm overflow-hidden ${
        b.status === 'critical' ? 'border-red-200 dark:border-red-800' :
        b.status === 'warning' ? 'border-amber-200 dark:border-amber-800' : 'border-slate-100 dark:border-slate-700'
      }`}>
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white">{b.projectName}</h3>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Burn rate: {(b.burnRate / 1e6).toFixed(2)}M/ngày
              {b.daysRemaining && ` • Còn ~${b.daysRemaining} ngày`}
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full text-[10px] font-black ${
            b.status === 'critical' ? 'bg-red-100 text-red-600' :
            b.status === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
          }`}>
            {b.usagePercent.toFixed(0)}% used
          </div>
        </div>

        {/* Budget bar */}
        <div className="px-5 pb-2">
          <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                b.status === 'critical' ? 'bg-red-500' : b.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, b.usagePercent)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-slate-400">
            <span>Thực tế: {(b.totalActual / 1e6).toFixed(1)}M</span>
            <span>Ngân sách: {(b.totalBudget / 1e6).toFixed(1)}M</span>
          </div>
        </div>

        {/* Burndown Chart */}
        <div className="px-5 pb-4">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={b.burndownPoints} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
              <Tooltip formatter={(v: number) => `${(v / 1e6).toFixed(2)}M`} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
              <Bar dataKey="budget" name="Dự toán" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Thực tế" radius={[4, 4, 0, 0]}>
                {b.burndownPoints.map((_, i) => (
                  <Cell key={i} fill={b.burndownPoints[i].actual > b.burndownPoints[i].budget ? '#ef4444' : '#6366f1'} />
                ))}
              </Bar>
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {b.estimatedOverrun && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
              <AlertTriangle size={14} className="text-red-500 shrink-0" />
              <span className="text-[11px] text-red-600 dark:text-red-400 font-bold">
                Dự kiến vượt ngân sách: +{(b.estimatedOverrun / 1e6).toFixed(1)}M
              </span>
            </div>
          </div>
        )}
      </div>
    ))}
  </div>
);

// ═════════ Anomaly Tab ═════════
const AnomalyTab: React.FC<{ anomalies: Anomaly[] }> = ({ anomalies }) => (
  <div className="space-y-3">
    {anomalies.length === 0 && (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-12 text-center">
        <span className="text-3xl">✅</span>
        <p className="text-sm font-bold text-slate-400 mt-2">Không phát hiện bất thường</p>
        <p className="text-[10px] text-slate-400 mt-1">Hệ thống hoạt động trong giới hạn bình thường</p>
      </div>
    )}
    {anomalies.map(a => (
      <div key={a.id} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm p-5 ${
        a.severity === 'high' ? 'border-red-200 dark:border-red-800' :
        a.severity === 'medium' ? 'border-amber-200 dark:border-amber-800' : 'border-slate-100 dark:border-slate-700'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${
                a.severity === 'high' ? 'bg-red-100 text-red-600' :
                a.severity === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
              }`}>
                {a.severity === 'high' ? 'NGHIÊM TRỌNG' : a.severity === 'medium' ? 'CẢNH BÁO' : 'THÔNG TIN'}
              </span>
              <span className={`text-[9px] font-bold ${
                a.type === 'spike' ? 'text-red-500' : a.type === 'drop' ? 'text-blue-500' : 'text-amber-500'
              }`}>
                {a.type === 'spike' ? '↑ SPIKE' : a.type === 'drop' ? '↓ DROP' : '~ UNUSUAL'}
              </span>
            </div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{a.title}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{a.description}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-slate-400">Khoảng bình thường</div>
            <div className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">
              {a.expectedRange[0].toLocaleString()} — {a.expectedRange[1].toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ═════════ Helpers ═════════
const TrendingIcon: React.FC<{ trend: string }> = ({ trend }) => (
  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
    trend === 'decreasing' ? 'bg-red-50 text-red-500' :
    trend === 'increasing' ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-50 text-slate-400'
  }`}>
    {trend === 'decreasing' ? <ArrowDown size={16} /> :
     trend === 'increasing' ? <ArrowUp size={16} /> : <Minus size={16} />}
  </div>
);

export default PredictiveAnalytics;
