import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart
} from 'recharts';
import {
    Landmark, TrendingUp, Users, Wrench, Shield, AlertTriangle,
    BarChart3, PieChart as PieChartIcon, ArrowRight, ArrowLeft, Calendar,
    CheckCircle, Clock, UserPlus, UserMinus
} from 'lucide-react';
import { AssetStatus, ASSET_STATUS_LABELS } from '../../types';
import { useTheme } from '../../context/ThemeContext';

const COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

const AssetDashboard: React.FC = () => {
    const navigate = useNavigate();
    const { assets, assetCategories, assetAssignments, assetMaintenances } = useApp();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [chartType, setChartType] = useState<'bar' | 'pie'>('bar');
    const [trendRange, setTrendRange] = useState<'3m' | '6m' | '12m' | 'all' | 'custom'>('6m');
    const [trendFrom, setTrendFrom] = useState(() => {
        const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0];
    });
    const [trendTo, setTrendTo] = useState(() => new Date().toISOString().split('T')[0]);

    // ========== STATS ==========
    const stats = useMemo(() => {
        const activeAssets = assets.filter(a => a.status !== AssetStatus.DISPOSED);
        const total = activeAssets.length;
        const inUse = activeAssets.filter(a => a.status === AssetStatus.IN_USE).length;
        const maintenance = activeAssets.filter(a => a.status === AssetStatus.MAINTENANCE).length;
        const totalValue = activeAssets.reduce((sum, a) => sum + a.originalValue, 0);
        const available = activeAssets.filter(a => a.status === AssetStatus.AVAILABLE).length;

        // Sắp hết bảo hành (≤ 30 ngày) — chỉ tài sản đang hoạt động
        const now = new Date();
        const expiringWarranty = activeAssets.filter(a => {
            if (!a.warrantyMonths || a.warrantyMonths <= 0) return false;
            const expiry = new Date(a.purchaseDate);
            expiry.setMonth(expiry.getMonth() + a.warrantyMonths);
            const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            return daysLeft > 0 && daysLeft <= 30;
        });

        return { total, inUse, maintenance, totalValue, available, expiringWarranty };
    }, [assets]);

    // ========== CHART DATA ==========
    const categoryChartData = useMemo(() => {
        const map: Record<string, { name: string; count: number; value: number }> = {};
        assets.forEach(a => {
            const cat = assetCategories.find(c => c.id === a.categoryId);
            const catName = cat?.name || 'Khác';
            if (!map[catName]) map[catName] = { name: catName, count: 0, value: 0 };
            map[catName].count++;
            map[catName].value += a.originalValue;
        });
        return Object.values(map).sort((a, b) => b.count - a.count);
    }, [assets, assetCategories]);

    const statusChartData = useMemo(() => {
        return Object.values(AssetStatus).map(status => ({
            name: ASSET_STATUS_LABELS[status],
            value: assets.filter(a => a.status === status).length
        })).filter(d => d.value > 0);
    }, [assets]);

    // ========== TREND RANGE HELPERS ==========
    const trendMonths = useMemo(() => {
        const now = new Date();
        let from: Date, to: Date;
        if (trendRange === 'custom') {
            from = new Date(trendFrom); to = new Date(trendTo);
        } else {
            to = now;
            const mMap = { '3m': 3, '6m': 6, '12m': 12, 'all': 120 };
            from = new Date(now.getFullYear(), now.getMonth() - (mMap[trendRange] - 1), 1);
        }
        const months: { key: string; label: string }[] = [];
        const cur = new Date(from.getFullYear(), from.getMonth(), 1);
        const end = new Date(to.getFullYear(), to.getMonth(), 1);
        while (cur <= end) {
            months.push({
                key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
                label: `T${cur.getMonth() + 1}/${cur.getFullYear()}`,
            });
            cur.setMonth(cur.getMonth() + 1);
        }
        return months;
    }, [trendRange, trendFrom, trendTo]);

    // ========== ASSIGNMENT TREND ==========
    const assignmentTrendData = useMemo(() => {
        const data = trendMonths.map(m => ({ ...m, assign: 0, return: 0, transfer: 0 }));
        assetAssignments.forEach(a => {
            const d = new Date(a.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const m = data.find(mo => mo.key === key);
            if (m) {
                if (a.type === 'assign') m.assign++;
                else if (a.type === 'return') m.return++;
                else if (a.type === 'transfer') m.transfer++;
            }
        });
        return data;
    }, [assetAssignments, trendMonths]);

    // ========== MAINTENANCE TREND ==========
    const maintenanceTrendData = useMemo(() => {
        const data = trendMonths.map(m => ({ ...m, scheduled: 0, repair: 0, inspection: 0, warranty: 0, cost: 0 }));
        assetMaintenances.forEach(m => {
            const d = new Date(m.startDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const mo = data.find(month => month.key === key);
            if (mo) {
                if (m.type === 'scheduled') mo.scheduled++;
                else if (m.type === 'repair') mo.repair++;
                else if (m.type === 'inspection') mo.inspection++;
                else if (m.type === 'warranty') mo.warranty++;
                mo.cost += m.actualCost || m.estimatedCost || m.cost || 0;
            }
        });
        return data;
    }, [assetMaintenances, trendMonths]);

    // ========== WARRANTY ALERTS ==========
    const warrantyAlerts = useMemo(() => {
        const now = new Date();
        return assets
            .filter(a => a.warrantyMonths && a.warrantyMonths > 0)
            .map(a => {
                const expiry = new Date(a.purchaseDate);
                expiry.setMonth(expiry.getMonth() + (a.warrantyMonths || 0));
                const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                return { ...a, daysLeft, expiryDate: expiry };
            })
            .filter(a => a.daysLeft <= 60 && a.daysLeft > -30)
            .sort((a, b) => a.daysLeft - b.daysLeft);
    }, [assets]);

    // ========== RECENT ACTIVITIES ==========
    const recentActivities = useMemo(() => {
        const activities: Array<{ id: string; type: string; icon: React.ReactNode; text: string; date: string; color: string }> = [];

        assetAssignments.slice(0, 10).forEach(a => {
            const asset = assets.find(as => as.id === a.assetId);
            const isAssign = a.type === 'assign';
            activities.push({
                id: a.id,
                type: isAssign ? 'assign' : 'return',
                icon: isAssign ? <UserPlus size={14} /> : <UserMinus size={14} />,
                text: `${isAssign ? 'Cấp phát' : 'Thu hồi'} ${asset?.name || a.assetId} ${isAssign ? 'cho' : 'từ'} ${a.userName}`,
                date: a.date,
                color: isAssign ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-amber-100 text-amber-600 border-amber-200',
            });
        });

        assetMaintenances.slice(0, 5).forEach(m => {
            const asset = assets.find(a => a.id === m.assetId);
            activities.push({
                id: m.id,
                type: 'maintenance',
                icon: <Wrench size={14} />,
                text: `${m.type === 'repair' ? 'Sửa chữa' : 'Bảo trì'} ${asset?.name || m.assetId} - ${m.description}`,
                date: m.startDate,
                color: 'bg-blue-100 text-blue-600 border-blue-200',
            });
        });

        return activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);
    }, [assetAssignments, assetMaintenances, assets]);

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
        if (diff < 60) return 'Vừa xong';
        if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
        return d.toLocaleDateString('vi-VN');
    };

    // Depreciation summary (chỉ tài sản đang hoạt động)
    const depreciationSummary = useMemo(() => {
        let totalOriginal = 0, totalRemaining = 0;
        assets.filter(a => a.status !== AssetStatus.DISPOSED).forEach(a => {
            totalOriginal += a.originalValue;
            const purchase = new Date(a.purchaseDate);
            const now = new Date();
            const monthsUsed = Math.max(0, (now.getFullYear() - purchase.getFullYear()) * 12 + (now.getMonth() - purchase.getMonth()));
            const totalMonths = a.depreciationYears * 12;
            const depreciable = a.originalValue - a.residualValue;
            const accumulated = Math.min(depreciable, (depreciable / totalMonths) * monthsUsed);
            totalRemaining += a.originalValue - accumulated;
        });
        return { totalOriginal, totalRemaining, totalDepreciated: totalOriginal - totalRemaining };
    }, [assets]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <Landmark className="text-rose-500" size={24} /> Dashboard Tài Sản
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
                        Tổng quan tình trạng tài sản cố định doanh nghiệp
                    </p>
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <div onClick={() => navigate('/ts/catalog')} className="glass-card p-4 md:p-6 rounded-2xl flex items-start justify-between hover:shadow-lg transition-all cursor-pointer active:scale-95">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] md:text-[11px] uppercase font-black tracking-widest mb-1">Tổng tài sản</p>
                        <h3 className="text-lg md:text-2xl font-black text-slate-800 dark:text-white">{stats.total}</h3>
                        <div className="text-[9px] text-slate-400 font-bold mt-1">{stats.available} sẵn sàng • {stats.inUse} đang dùng</div>
                    </div>
                    <div className="p-2 md:p-3 rounded-xl bg-indigo-600 bg-opacity-10 border border-indigo-200 dark:border-indigo-800">
                        <Landmark className="w-4 h-4 md:w-6 md:h-6 text-indigo-600" />
                    </div>
                </div>

                <div onClick={() => navigate('/ts/assignment')} className="glass-card p-4 md:p-6 rounded-2xl flex items-start justify-between hover:shadow-lg transition-all cursor-pointer active:scale-95">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] md:text-[11px] uppercase font-black tracking-widest mb-1">Đang sử dụng</p>
                        <h3 className="text-lg md:text-2xl font-black text-blue-600">{stats.inUse}</h3>
                        <div className="text-[9px] text-slate-400 font-bold mt-1">{stats.maintenance} đang bảo trì</div>
                    </div>
                    <div className="p-2 md:p-3 rounded-xl bg-blue-600 bg-opacity-10 border border-blue-200 dark:border-blue-800">
                        <Users className="w-4 h-4 md:w-6 md:h-6 text-blue-600" />
                    </div>
                </div>

                <div onClick={() => navigate('/ts/reports')} className="glass-card p-4 md:p-6 rounded-2xl flex items-start justify-between hover:shadow-lg transition-all cursor-pointer active:scale-95">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] md:text-[11px] uppercase font-black tracking-widest mb-1">Nguyên giá</p>
                        <h3 className="text-lg md:text-2xl font-black text-slate-800 dark:text-white">{(depreciationSummary.totalOriginal / 1000000).toFixed(1)}M</h3>
                        <div className="text-[9px] text-emerald-500 font-bold mt-1">Còn lại: {(depreciationSummary.totalRemaining / 1000000).toFixed(1)}M</div>
                    </div>
                    <div className="p-2 md:p-3 rounded-xl bg-emerald-600 bg-opacity-10 border border-emerald-200 dark:border-emerald-800">
                        <TrendingUp className="w-4 h-4 md:w-6 md:h-6 text-emerald-600" />
                    </div>
                </div>

                <div className="glass-card p-4 md:p-6 rounded-2xl flex items-start justify-between hover:shadow-lg transition-all">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] md:text-[11px] uppercase font-black tracking-widest mb-1">Sắp hết BH</p>
                        <h3 className={`text-lg md:text-2xl font-black ${stats.expiringWarranty.length > 0 ? 'text-red-500' : 'text-slate-800 dark:text-white'}`}>{stats.expiringWarranty.length}</h3>
                        <div className="text-[9px] text-slate-400 font-bold mt-1">trong vòng 30 ngày</div>
                    </div>
                    <div className={`p-2 md:p-3 rounded-xl ${stats.expiringWarranty.length > 0 ? 'bg-red-500 bg-opacity-10 border border-red-200 dark:border-red-800' : 'bg-slate-400 bg-opacity-10 border border-slate-200 dark:border-slate-700'}`}>
                        <Shield className={`w-4 h-4 md:w-6 md:h-6 ${stats.expiringWarranty.length > 0 ? 'text-red-500' : 'text-slate-400'}`} />
                    </div>
                </div>
            </div>

            {/* Charts + Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Chart */}
                <div className="lg:col-span-2 glass-panel rounded-2xl flex flex-col overflow-hidden min-h-[400px]">
                    <div className="p-6 border-b border-white/20 dark:border-white/5 flex items-center justify-between">
                        <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2 text-sm">
                            <BarChart3 size={18} className="text-rose-500" />
                            Phân bổ tài sản theo loại
                        </h3>
                        <div className="bg-white/20 dark:bg-slate-800/50 p-1 rounded-xl flex items-center shadow-inner">
                            <button onClick={() => setChartType('bar')} className={`p-2 rounded-lg ${chartType === 'bar' ? 'bg-white/40 dark:bg-slate-700 text-rose-600 shadow-sm' : 'text-slate-500'}`}><BarChart3 size={16} /></button>
                            <button onClick={() => setChartType('pie')} className={`p-2 rounded-lg ${chartType === 'pie' ? 'bg-white/40 dark:bg-slate-700 text-rose-600 shadow-sm' : 'text-slate-500'}`}><PieChartIcon size={16} /></button>
                        </div>
                    </div>
                    <div className="p-6 flex-1">
                        {categoryChartData.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20">
                                <Landmark size={48} />
                                <p className="text-xs font-black uppercase mt-4">Chưa có tài sản</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                {chartType === 'bar' ? (
                                    <BarChart data={categoryChartData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#f1f5f9'} />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                                        <Bar dataKey="count" name="Số lượng" fill="#f43f5e" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                ) : (
                                    <PieChart>
                                        <Pie data={categoryChartData} cx="50%" cy="50%" outerRadius={120} innerRadius={60} paddingAngle={4} dataKey="count" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                            {categoryChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                )}
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Activity Log */}
                <div className="glass-panel rounded-2xl flex flex-col h-full overflow-hidden">
                    <div className="p-6 border-b border-white/20 dark:border-white/5">
                        <h3 className="font-black text-slate-800 dark:text-white text-sm uppercase tracking-widest">Hoạt động gần đây</h3>
                    </div>
                    <div className="p-4 flex-1 overflow-y-auto space-y-4 max-h-[450px]">
                        {recentActivities.length > 0 ? (
                            recentActivities.map(act => (
                                <div key={act.id} className="relative pl-8">
                                    <div className="absolute left-[11px] top-7 bottom-[-20px] w-px bg-white/30 dark:bg-slate-700/50" />
                                    <div className={`absolute left-0 top-0.5 w-6 h-6 rounded-lg border flex items-center justify-center z-10 ${act.color}`}>
                                        {act.icon}
                                    </div>
                                    <div className="pb-5">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-xs font-black text-slate-800 dark:text-slate-200 line-clamp-1">{act.text}</span>
                                        </div>
                                        <span className="text-[9px] text-slate-400 font-bold">{formatTime(act.date)}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 py-10">
                                <Clock size={40} />
                                <p className="text-xs font-black uppercase mt-4 dark:text-white">Chưa có hoạt động</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Line Charts — Assignment & Maintenance Trends */}
            <div className="space-y-4">
                {/* Time Range Selector */}
                <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-indigo-500" />
                        <span className="text-xs font-black text-slate-700 dark:text-white uppercase tracking-wider">Khoảng thời gian</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {([['3m', '3 tháng'], ['6m', '6 tháng'], ['12m', '12 tháng'], ['all', 'Tất cả'], ['custom', 'Tuỳ chọn']] as const).map(([val, label]) => (
                            <button key={val} onClick={() => {
                                setTrendRange(val);
                                if (val !== 'custom') {
                                    const now = new Date();
                                    const mMap = { '3m': 3, '6m': 6, '12m': 12, 'all': 120 };
                                    const from = new Date(now.getFullYear(), now.getMonth() - (mMap[val] - 1), 1);
                                    setTrendFrom(from.toISOString().split('T')[0]);
                                    setTrendTo(now.toISOString().split('T')[0]);
                                }
                            }}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                                    trendRange === val
                                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                        : 'bg-white/30 dark:bg-slate-800/50 text-slate-500 hover:text-slate-700 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700'
                                }`}>
                                {label}
                            </button>
                        ))}
                        {trendRange === 'custom' && (
                            <div className="flex items-center gap-2 ml-2">
                                <input type="date" value={trendFrom} onChange={e => setTrendFrom(e.target.value)}
                                    className="px-2 py-1.5 text-[11px] font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" />
                                <span className="text-slate-400 text-[10px] font-bold">→</span>
                                <input type="date" value={trendTo} onChange={e => setTrendTo(e.target.value)}
                                    className="px-2 py-1.5 text-[11px] font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" />
                            </div>
                        )}
                    </div>
                </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Assignment Trend */}
                <div className="glass-panel rounded-2xl flex flex-col overflow-hidden min-h-[340px]">
                    <div className="p-5 border-b border-white/20 dark:border-white/5">
                        <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2 text-sm">
                            <UserPlus size={16} className="text-blue-500" />
                            Cấp phát / Thu hồi
                        </h3>
                    </div>
                    <div className="p-4 flex-1">
                        {assetAssignments.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20">
                                <Users size={40} />
                                <p className="text-xs font-black uppercase mt-3">Chưa có dữ liệu</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={assignmentTrendData}>
                                    <defs>
                                        <linearGradient id="assignGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="returnGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="transferGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#f1f5f9'} />
                                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                                    <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 8px 16px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
                                    <Area type="monotone" dataKey="assign" name="Cấp phát" stroke="#3b82f6" strokeWidth={2.5} fill="url(#assignGrad)" dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
                                    <Area type="monotone" dataKey="return" name="Thu hồi" stroke="#f59e0b" strokeWidth={2.5} fill="url(#returnGrad)" dot={{ r: 4, fill: '#f59e0b' }} activeDot={{ r: 6 }} />
                                    <Area type="monotone" dataKey="transfer" name="Luân chuyển" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#transferGrad)" dot={{ r: 4, fill: '#8b5cf6' }} activeDot={{ r: 6 }} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Maintenance Trend */}
                <div className="glass-panel rounded-2xl flex flex-col overflow-hidden min-h-[340px]">
                    <div className="p-5 border-b border-white/20 dark:border-white/5">
                        <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2 text-sm">
                            <Wrench size={16} className="text-amber-500" />
                            Bảo trì / Sửa chữa
                        </h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">Số lượng & chi phí</p>
                    </div>
                    <div className="p-4 flex-1">
                        {assetMaintenances.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20">
                                <Wrench size={40} />
                                <p className="text-xs font-black uppercase mt-3">Chưa có dữ liệu</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={maintenanceTrendData}>
                                    <defs>
                                        <linearGradient id="scheduledGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="repairGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#f1f5f9'} />
                                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                    <YAxis yAxisId="count" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                                    <YAxis yAxisId="cost" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => v >= 1000000 ? `${(v / 1000000).toFixed(0)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                                    <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 8px 16px rgb(0 0 0 / 0.1)', fontSize: '12px' }} formatter={(value: any, name: string) => [name === 'Chi phí' ? `${Number(value).toLocaleString('vi-VN')}đ` : value, name]} />
                                    <Area yAxisId="count" type="monotone" dataKey="scheduled" name="Bảo trì" stroke="#10b981" strokeWidth={2.5} fill="url(#scheduledGrad)" dot={{ r: 4, fill: '#10b981' }} activeDot={{ r: 6 }} />
                                    <Area yAxisId="count" type="monotone" dataKey="repair" name="Sửa chữa" stroke="#f43f5e" strokeWidth={2.5} fill="url(#repairGrad)" dot={{ r: 4, fill: '#f43f5e' }} activeDot={{ r: 6 }} />
                                    <Line yAxisId="cost" type="monotone" dataKey="cost" name="Chi phí" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#6366f1' }} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
            </div>

            {/* Warranty Alerts */}
            {warrantyAlerts.length > 0 && (
                <div className="glass-panel rounded-2xl overflow-hidden">
                    <div className="p-6 border-b border-white/20 dark:border-white/5 flex items-center justify-between">
                        <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2 text-sm">
                            <AlertTriangle size={18} className="text-amber-500" />
                            Cảnh báo bảo hành ({warrantyAlerts.length})
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {warrantyAlerts.map(a => (
                            <div key={a.id} onClick={() => navigate('/ts/catalog')} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.daysLeft <= 0 ? 'bg-slate-100 dark:bg-slate-800' : a.daysLeft <= 15 ? 'bg-red-50 dark:bg-red-950/20' : 'bg-amber-50 dark:bg-amber-950/20'}`}>
                                        <Shield size={18} className={a.daysLeft <= 0 ? 'text-slate-400' : a.daysLeft <= 15 ? 'text-red-500' : 'text-amber-500'} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-black text-slate-800 dark:text-white truncate">{a.name}</div>
                                        <div className="text-[10px] font-mono text-slate-400">{a.code} • Hết BH: {a.expiryDate.toLocaleDateString('vi-VN')}</div>
                                    </div>
                                </div>
                                <div className="text-right shrink-0 ml-4">
                                    <div className={`text-sm font-black ${a.daysLeft <= 0 ? 'text-slate-400' : a.daysLeft <= 15 ? 'text-red-500' : 'text-amber-500'}`}>
                                        {a.daysLeft <= 0 ? 'Đã hết hạn' : `${a.daysLeft} ngày`}
                                    </div>
                                    <div className="text-[9px] text-slate-400 font-bold">
                                        {a.daysLeft <= 0 ? 'Hết bảo hành' : 'còn lại'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Depreciation Summary Bar */}
            {assets.length > 0 && (
                <div className="glass-panel rounded-2xl p-6">
                    <h3 className="font-black text-slate-800 dark:text-white text-sm uppercase tracking-widest mb-4 flex items-center gap-2">
                        <TrendingUp size={16} className="text-emerald-500" /> Tổng quan khấu hao
                    </h3>
                    <div className="grid grid-cols-3 gap-6 mb-4">
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase">Nguyên giá</p>
                            <p className="text-xl font-black text-slate-800 dark:text-white">{depreciationSummary.totalOriginal.toLocaleString('vi-VN')}đ</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase">Đã khấu hao</p>
                            <p className="text-xl font-black text-rose-500">{depreciationSummary.totalDepreciated.toLocaleString('vi-VN')}đ</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase">Giá trị còn lại</p>
                            <p className="text-xl font-black text-emerald-600">{depreciationSummary.totalRemaining.toLocaleString('vi-VN')}đ</p>
                        </div>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-4 overflow-hidden">
                        <div className="h-4 rounded-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all"
                            style={{ width: `${depreciationSummary.totalOriginal > 0 ? (depreciationSummary.totalRemaining / depreciationSummary.totalOriginal) * 100 : 0}%` }} />
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-slate-400 font-bold">
                        <span>Đã khấu hao {depreciationSummary.totalOriginal > 0 ? ((depreciationSummary.totalDepreciated / depreciationSummary.totalOriginal) * 100).toFixed(1) : 0}%</span>
                        <span>Còn lại {depreciationSummary.totalOriginal > 0 ? ((depreciationSummary.totalRemaining / depreciationSummary.totalOriginal) * 100).toFixed(1) : 0}%</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetDashboard;
