import React, { useState, useEffect, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    AreaChart, Area, ComposedChart, Line, Scatter, ScatterChart, ZAxis
} from 'recharts';
import {
    Building2, TrendingUp, TrendingDown, DollarSign, Activity, Target,
    AlertTriangle, CheckCircle2, Users, Truck, Package, Clock,
    ArrowUpRight, ArrowDownRight, BarChart3, Layers, Flame, Shield,
    ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portfolioService, ProjectSummary, PortfolioKPIs } from '../lib/portfolioService';

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return n.toLocaleString('vi-VN');
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    planning: { label: 'Lập KH', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', dot: '#3b82f6' },
    active: { label: 'Đang TC', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', dot: '#10b981' },
    paused: { label: 'Tạm dừng', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', dot: '#f59e0b' },
    completed: { label: 'Hoàn thành', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', dot: '#8b5cf6' },
};

const CHART_COLORS = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#fb923c'];

const PortfolioDashboard: React.FC = () => {
    const navigate = useNavigate();
    const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [sortField, setSortField] = useState<'profit' | 'progressPercent' | 'contractValue' | 'overduePayments'>('contractValue');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    useEffect(() => {
        portfolioService.getSummaries()
            .then(setSummaries)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const kpis = useMemo(() => portfolioService.getKPIs(summaries), [summaries]);

    // ── Chart data ──
    const statusPie = useMemo(() => {
        const counts: Record<string, number> = {};
        summaries.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });
        return Object.entries(counts).map(([k, v]) => ({
            name: STATUS_CONFIG[k]?.label || k,
            value: v,
            fill: STATUS_CONFIG[k]?.dot || '#94a3b8',
        }));
    }, [summaries]);

    const budgetComparison = useMemo(() => {
        return summaries.map(s => ({
            name: s.siteName.length > 10 ? s.siteName.slice(0, 10) + '…' : s.siteName,
            'Giá trị HĐ': s.contractValue,
            'Chi phí': s.totalExpense,
            'Lợi nhuận': s.profit,
        }));
    }, [summaries]);

    const profitRanking = useMemo(() => {
        return [...summaries]
            .sort((a, b) => b.profitPercent - a.profitPercent)
            .map(s => ({
                name: s.siteName.length > 15 ? s.siteName.slice(0, 15) + '…' : s.siteName,
                value: s.profitPercent,
                fill: s.profitPercent >= 0 ? '#34d399' : '#ef4444',
            }));
    }, [summaries]);

    const riskMatrix = useMemo(() => {
        return summaries.map(s => {
            const budgetRisk = s.contractValue > 0 ? Math.max(0, (s.totalExpense / s.contractValue) * 100 - s.progressPercent) : 0;
            const scheduleRisk = Math.max(0, 100 - s.progressPercent) / 10;
            return {
                name: s.siteName,
                x: Math.min(budgetRisk, 100),  // Budget overrun risk
                y: scheduleRisk * 10,           // Schedule delay risk  
                z: s.contractValue,
                fill: budgetRisk > 30 && scheduleRisk > 5 ? '#ef4444' : budgetRisk > 15 || scheduleRisk > 5 ? '#f59e0b' : '#34d399',
            };
        });
    }, [summaries]);

    const progressVsExpense = useMemo(() => {
        return summaries.map(s => ({
            name: s.siteName.length > 10 ? s.siteName.slice(0, 10) + '…' : s.siteName,
            'Tiến độ (%)': s.progressPercent,
            'Chi phí (%)': s.contractValue > 0 ? Math.round((s.totalExpense / s.contractValue) * 100) : 0,
        }));
    }, [summaries]);

    const sortedSummaries = useMemo(() => {
        return [...summaries].sort((a, b) => {
            const av = a[sortField];
            const bv = b[sortField];
            return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
        });
    }, [summaries, sortField, sortDir]);

    const handleSort = (field: typeof sortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortField(field);
            setSortDir('desc');
        }
    };

    const SortIcon = ({ field }: { field: typeof sortField }) => {
        if (sortField !== field) return null;
        return sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-center">
                    <Layers size={48} className="mx-auto mb-4 text-indigo-300 animate-pulse" />
                    <p className="text-sm font-bold text-slate-400">Đang tải dữ liệu đa dự án...</p>
                </div>
            </div>
        );
    }

    if (summaries.length === 0) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-center">
                    <Building2 size={56} className="mx-auto mb-4 text-slate-200" />
                    <p className="text-lg font-black text-slate-400">Chưa có dự án nào</p>
                    <p className="text-xs text-slate-300 mt-2">Tạo công trình và thêm dữ liệu dự án để xem tổng quan</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                            <Layers size={20} />
                        </div>
                        Tổng quan Đa dự án
                    </h1>
                    <p className="text-xs text-slate-400 mt-1 ml-[52px]">Portfolio Dashboard • {summaries.length} dự án</p>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                    { label: 'Tổng dự án', value: kpis.totalProjects, sub: `${kpis.activeProjects} đang TC`, icon: <Building2 size={14} />, color: 'from-indigo-500 to-blue-500', textColor: 'text-indigo-600', link: '/da' },
                    { label: 'Giá trị HĐ', value: fmt(kpis.totalContractValue), sub: '', icon: <DollarSign size={14} />, color: 'from-emerald-500 to-teal-500', textColor: 'text-emerald-600', link: '/da' },
                    { label: 'Tổng chi', value: fmt(kpis.totalExpense), sub: `${((kpis.totalExpense / (kpis.totalContractValue || 1)) * 100).toFixed(1)}% HĐ`, icon: <TrendingDown size={14} />, color: 'from-orange-500 to-red-500', textColor: 'text-orange-600', link: '/da' },
                    { label: 'Lợi nhuận', value: fmt(kpis.totalProfit), sub: `${((kpis.totalProfit / (kpis.totalContractValue || 1)) * 100).toFixed(1)}%`, icon: kpis.totalProfit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />, color: kpis.totalProfit >= 0 ? 'from-green-500 to-emerald-500' : 'from-red-500 to-rose-500', textColor: kpis.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600', link: '/da' },
                    { label: 'Tiến độ TB', value: `${kpis.avgProgress}%`, sub: kpis.totalWasteOver > 0 ? `⚠️ ${kpis.totalWasteOver} vượt HH` : '✅ OK', icon: <Activity size={14} />, color: 'from-violet-500 to-purple-500', textColor: 'text-violet-600', link: '/da' },
                ].map((k, i) => (
                    <div key={i} onClick={() => navigate(k.link)}
                        className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider group-hover:text-indigo-500 transition-colors">{k.label}</span>
                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${k.color} flex items-center justify-center text-white shadow-sm`}>{k.icon}</div>
                        </div>
                        <div className={`text-xl font-black ${k.textColor} dark:opacity-90`}>{k.value}</div>
                        {k.sub && <div className="text-[10px] text-slate-400 mt-1 font-bold">{k.sub}</div>}
                        <div className="text-[8px] text-slate-300 mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <ExternalLink size={7} /> Xem chi tiết
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* 1. Status Distribution */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white"><BarChart3 size={14} /></div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">Trạng thái Dự án</span>
                    </div>
                    <div className="p-4">
                        {statusPie.length > 0 ? (
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie data={statusPie} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={4}
                                        dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={{ strokeWidth: 1 }}>
                                        {statusPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11, border: '1px solid #e2e8f0' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <EmptyChart text="Chưa có dữ liệu" />}
                    </div>
                </div>

                {/* 2. Progress vs Expense */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white"><Target size={14} /></div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">Tiến độ vs Chi phí (%)</span>
                    </div>
                    <div className="p-4">
                        {progressVsExpense.length > 0 ? (
                            <ResponsiveContainer width="100%" height={240}>
                                <ComposedChart data={progressVsExpense}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                    <YAxis domain={[0, 120]} tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} formatter={(v: number) => `${v}%`} />
                                    <Legend wrapperStyle={{ fontSize: 10 }} />
                                    <Bar dataKey="Tiến độ (%)" fill="#818cf8" radius={[4, 4, 0, 0]} barSize={24} />
                                    <Line type="monotone" dataKey="Chi phí (%)" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4, fill: '#f97316' }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : <EmptyChart text="Chưa có dữ liệu" />}
                    </div>
                </div>

                {/* 3. Budget vs Actual */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden lg:col-span-2">
                    <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white"><DollarSign size={14} /></div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">So sánh Ngân sách theo Dự án</span>
                    </div>
                    <div className="p-4">
                        {budgetComparison.length > 0 ? (
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={budgetComparison} barGap={3}>
                                    <defs>
                                        <linearGradient id="gradContract" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#818cf8" stopOpacity={0.9} />
                                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.7} />
                                        </linearGradient>
                                        <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#f97316" stopOpacity={0.9} />
                                            <stop offset="100%" stopColor="#ea580c" stopOpacity={0.7} />
                                        </linearGradient>
                                        <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#34d399" stopOpacity={0.9} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.7} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => fmt(v)} />
                                    <Tooltip formatter={(v: number) => fmt(v) + ' đ'} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
                                    <Legend wrapperStyle={{ fontSize: 10 }} />
                                    <Bar dataKey="Giá trị HĐ" fill="url(#gradContract)" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="Chi phí" fill="url(#gradExpense)" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="Lợi nhuận" fill="url(#gradProfit)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <EmptyChart text="Chưa có dữ liệu" />}
                    </div>
                </div>

                {/* 4. Profit Ranking */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center text-white"><TrendingUp size={14} /></div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">Xếp hạng Lợi nhuận (%)</span>
                    </div>
                    <div className="p-4">
                        {profitRanking.length > 0 ? (
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart layout="vertical" data={profitRanking}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 9, fill: '#64748b' }} />
                                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                                    <Bar dataKey="value" barSize={18} radius={[0, 4, 4, 0]}>
                                        {profitRanking.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <EmptyChart text="Chưa có dữ liệu" />}
                    </div>
                </div>

                {/* 5. Risk Heatmap */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white"><Flame size={14} /></div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">Ma trận Rủi ro</span>
                        <span className="text-[9px] text-slate-400 ml-auto">X: Vượt NS • Y: Chậm TĐ</span>
                    </div>
                    <div className="p-4">
                        {riskMatrix.length > 0 ? (
                            <div>
                                <ResponsiveContainer width="100%" height={200}>
                                    <ScatterChart>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis type="number" dataKey="x" name="Vượt NS (%)" tick={{ fontSize: 9, fill: '#94a3b8' }} label={{ value: 'Vượt ngân sách (%)', fontSize: 9, fill: '#94a3b8', position: 'bottom' }} />
                                        <YAxis type="number" dataKey="y" name="Chậm TĐ (%)" tick={{ fontSize: 9, fill: '#94a3b8' }} label={{ value: 'Chậm tiến độ', fontSize: 9, fill: '#94a3b8', angle: -90, position: 'insideLeft' }} />
                                        <ZAxis type="number" dataKey="z" range={[60, 300]} />
                                        <Tooltip cursor={{ strokeDasharray: '3 3' }}
                                            content={({ payload }) => {
                                                if (!payload || payload.length === 0) return null;
                                                const d = payload[0].payload;
                                                return (
                                                    <div className="bg-white rounded-xl shadow-lg border border-slate-200 px-3 py-2 text-[10px]">
                                                        <p className="font-black text-slate-700">{d.name}</p>
                                                        <p className="text-slate-500">Vượt NS: {d.x.toFixed(1)}%</p>
                                                        <p className="text-slate-500">Chậm TĐ: {d.y.toFixed(1)}%</p>
                                                    </div>
                                                );
                                            }}
                                        />
                                        <Scatter data={riskMatrix}>
                                            {riskMatrix.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                                {/* Risk legend */}
                                <div className="flex justify-center gap-4 mt-2">
                                    {[
                                        { color: '#34d399', label: 'An toàn' },
                                        { color: '#f59e0b', label: 'Cảnh báo' },
                                        { color: '#ef4444', label: 'Nguy hiểm' },
                                    ].map(l => (
                                        <div key={l.label} className="flex items-center gap-1">
                                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                                            <span className="text-[9px] font-bold text-slate-400">{l.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <EmptyChart text="Chưa có dữ liệu" />}
                    </div>
                </div>
            </div>

            {/* Project Ranking Table */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white"><Shield size={14} /></div>
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200">Bảng xếp hạng Dự án</span>
                    <span className="text-[9px] text-slate-400 ml-auto">Nhấn tiêu đề cột để sắp xếp</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50/80 dark:bg-slate-700/30 text-[9px] uppercase font-black text-slate-400 dark:text-slate-500 tracking-widest border-b border-slate-100 dark:border-slate-700">
                                <th className="p-3 w-8">#</th>
                                <th className="p-3">Dự án</th>
                                <th className="p-3 text-center">Trạng thái</th>
                                <th className="p-3 text-right cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('contractValue')}>
                                    Giá trị HĐ <SortIcon field="contractValue" />
                                </th>
                                <th className="p-3 text-right cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('progressPercent')}>
                                    Tiến độ <SortIcon field="progressPercent" />
                                </th>
                                <th className="p-3 text-right cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('profit')}>
                                    Lợi nhuận <SortIcon field="profit" />
                                </th>
                                <th className="p-3 text-center">HĐ</th>
                                <th className="p-3 text-center">NCC</th>
                                <th className="p-3 text-center">PO</th>
                                <th className="p-3 text-center cursor-pointer hover:text-slate-600 select-none" onClick={() => handleSort('overduePayments')}>
                                    ⚠️ <SortIcon field="overduePayments" />
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50 text-xs">
                            {sortedSummaries.map((s, i) => {
                                const stConfig = STATUS_CONFIG[s.status] || STATUS_CONFIG.planning;
                                return (
                                    <tr key={s.siteId} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors group cursor-pointer"
                                        onClick={() => navigate('/da')}>
                                        <td className="p-3 text-slate-400 font-bold">{i + 1}</td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-black shrink-0 shadow-sm">
                                                    {s.siteName.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 transition-colors flex items-center gap-1">
                                                        {s.siteName}
                                                        <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 text-indigo-400" />
                                                    </div>
                                                    {s.siteAddress && <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{s.siteAddress}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold border ${stConfig.bg} ${stConfig.color}`}>
                                                {stConfig.label}
                                            </span>
                                        </td>
                                        <td className="p-3 text-right font-bold text-slate-700 dark:text-slate-300">{s.contractValue > 0 ? fmt(s.contractValue) + ' đ' : '—'}</td>
                                        <td className="p-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                                                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                                                        style={{ width: `${Math.min(s.progressPercent, 100)}%` }} />
                                                </div>
                                                <span className="font-bold text-slate-600 dark:text-slate-400 w-8 text-right">{s.progressPercent}%</span>
                                            </div>
                                        </td>
                                        <td className="p-3 text-right">
                                            <span className={`font-black ${s.profit >= 0 ? 'text-emerald-600' : 'text-red-500'} flex items-center justify-end gap-0.5`}>
                                                {s.profit >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                                {fmt(s.profit)} đ
                                            </span>
                                            <span className={`text-[9px] ${s.profitPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.profitPercent.toFixed(1)}%</span>
                                        </td>
                                        <td className="p-3 text-center text-slate-500">{s.contractCount}</td>
                                        <td className="p-3 text-center text-slate-500">{s.vendorCount}</td>
                                        <td className="p-3 text-center text-slate-500">{s.poCount}</td>
                                        <td className="p-3 text-center">
                                            {s.overduePayments > 0 ? (
                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-600 text-[9px] font-bold">
                                                    <AlertTriangle size={9} /> {s.overduePayments}
                                                </span>
                                            ) : (
                                                <CheckCircle2 size={12} className="mx-auto text-emerald-400" />
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const EmptyChart = ({ text }: { text: string }) => (
    <div className="h-[200px] flex items-center justify-center text-xs text-slate-300 font-bold">{text}</div>
);

export default PortfolioDashboard;
