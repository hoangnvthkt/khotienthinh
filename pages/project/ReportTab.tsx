import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, RadarChart, Radar,
    PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart
} from 'recharts';
import {
    BarChart3, PieChart as PieChartIcon, TrendingUp, FileText, Download,
    DollarSign, Users, Package, Truck, CheckCircle2, AlertTriangle,
    Calendar, Activity
} from 'lucide-react';
import { ProjectContract, AcceptanceRecord, MaterialBudgetItem, ProjectMaterialRequest, ProjectVendor, PurchaseOrder, ProjectTask, DailyLog } from '../../types';
import { contractService, acceptanceService, boqService, matRequestService, vendorService, poService, taskService, dailyLogService } from '../../lib/projectService';

interface ReportTabProps {
    constructionSiteId: string;
    contractValue?: number;
    totalSpent?: number;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return n.toLocaleString('vi-VN');
};

const COLORS = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#fb923c', '#38bdf8', '#4ade80'];
const GRADIENT_PAIRS = [
    ['#818cf8', '#6366f1'], ['#f472b6', '#ec4899'], ['#34d399', '#10b981'],
    ['#fbbf24', '#f59e0b'], ['#60a5fa', '#3b82f6'], ['#f87171', '#ef4444'],
];

const ReportTab: React.FC<ReportTabProps> = ({ constructionSiteId, contractValue = 0, totalSpent = 0 }) => {
    const [selectedChart, setSelectedChart] = useState<string | null>(null);

    // Load all data from Supabase
    const [contracts, setContracts] = useState<ProjectContract[]>([]);
    const [acceptances, setAcceptances] = useState<AcceptanceRecord[]>([]);
    const [boqItems, setBoqItems] = useState<MaterialBudgetItem[]>([]);
    const [matRequests, setMatRequests] = useState<ProjectMaterialRequest[]>([]);
    const [vendors, setVendors] = useState<ProjectVendor[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);

    useEffect(() => {
        contractService.list(constructionSiteId).then(setContracts).catch(console.error);
        acceptanceService.list(constructionSiteId).then(setAcceptances).catch(console.error);
        boqService.list(constructionSiteId).then(setBoqItems).catch(console.error);
        matRequestService.list(constructionSiteId).then(setMatRequests).catch(console.error);
        vendorService.list(constructionSiteId).then(setVendors).catch(console.error);
        poService.list(constructionSiteId).then(setPurchaseOrders).catch(console.error);
        taskService.list(constructionSiteId).then(setTasks).catch(console.error);
        dailyLogService.list(constructionSiteId).then(setDailyLogs).catch(console.error);
    }, [constructionSiteId]);

    // ==================== COMPUTED DATA ====================

    // 1. Budget Overview (Waterfall-style)
    const budgetWaterfall = useMemo(() => {
        const mainContracts = contracts.filter(c => c.type === 'main');
        const subContracts = contracts.filter(c => c.type === 'subcontract');
        const mainValue = mainContracts.reduce((s, c) => s + c.value, 0);
        const subValue = subContracts.reduce((s, c) => s + c.value, 0);
        const matBudget = boqItems.reduce((s, b) => s + (b.budgetTotal || 0), 0);
        const matActual = boqItems.reduce((s, b) => s + (b.actualTotal || 0), 0);
        const poValue = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
        const accepted = acceptances.reduce((s, a) => s + a.approvedValue, 0);
        const profit = (contractValue || mainValue) - totalSpent;

        return [
            { name: 'Giá trị HĐ', value: contractValue || mainValue, fill: '#818cf8' },
            { name: 'Thầu phụ', value: subValue, fill: '#f472b6' },
            { name: 'Vật tư DT', value: matBudget, fill: '#60a5fa' },
            { name: 'Vật tư TT', value: matActual, fill: matActual > matBudget ? '#ef4444' : '#34d399' },
            { name: 'PO', value: poValue, fill: '#fbbf24' },
            { name: 'Nghiệm thu', value: accepted, fill: '#a78bfa' },
            { name: 'Chi phí TT', value: totalSpent, fill: '#f87171' },
            { name: 'Lợi nhuận', value: profit, fill: profit >= 0 ? '#34d399' : '#ef4444' },
        ];
    }, [contracts, boqItems, purchaseOrders, acceptances, contractValue, totalSpent]);

    // 2. Contract Distribution (Pie)
    const contractPie = useMemo(() => {
        const main = contracts.filter(c => c.type === 'main').reduce((s, c) => s + c.value, 0);
        const sub = contracts.filter(c => c.type === 'subcontract').reduce((s, c) => s + c.value, 0);
        if (main === 0 && sub === 0) return [];
        return [
            { name: 'HĐ Chính', value: main, fill: '#818cf8' },
            { name: 'Thầu phụ', value: sub, fill: '#f472b6' },
        ];
    }, [contracts]);

    // 3. Material Waste (Horizontal Bar)
    const wasteData = useMemo(() => {
        return boqItems.map(b => ({
            name: b.itemName.length > 12 ? b.itemName.slice(0, 12) + '…' : b.itemName,
            'Dự toán': b.budgetQty,
            'Thực tế': b.actualQty,
            waste: b.wastePercent || 0,
            isOver: (b.wastePercent || 0) > b.wasteThreshold,
        }));
    }, [boqItems]);

    // 4. Task Progress (Radar)
    const taskRadar = useMemo(() => {
        if (tasks.length === 0) return [];
        const byStatus = {
            'Hoàn thành': tasks.filter(t => t.progress >= 100).length,
            'Đang làm': tasks.filter(t => t.progress > 0 && t.progress < 100).length,
            'Chưa bắt đầu': tasks.filter(t => t.progress === 0).length,
            'Milestone': tasks.filter(t => t.isMilestone).length,
        };
        return Object.entries(byStatus).map(([key, value]) => ({ subject: key, A: value, fullMark: tasks.length }));
    }, [tasks]);

    // 5. PO Status (Donut)
    const poStatusPie = useMemo(() => {
        if (purchaseOrders.length === 0) return [];
        const byStatus: Record<string, number> = {};
        purchaseOrders.forEach(p => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
        const labels: Record<string, string> = { draft: 'Nháp', sent: 'Đã gửi', partial: 'Giao 1 phần', delivered: 'Đã giao', cancelled: 'Huỷ' };
        const colors: Record<string, string> = { draft: '#94a3b8', sent: '#fbbf24', partial: '#fb923c', delivered: '#34d399', cancelled: '#ef4444' };
        return Object.entries(byStatus).map(([k, v]) => ({ name: labels[k] || k, value: v, fill: colors[k] || '#818cf8' }));
    }, [purchaseOrders]);

    // 6. Acceptance Progress (S-Curve style)
    const acceptanceSCurve = useMemo(() => {
        if (acceptances.length === 0) return [];
        const sorted = [...acceptances].sort((a, b) => a.periodNumber - b.periodNumber);
        let cumValue = 0;
        let cumPaid = 0;
        return sorted.map(a => {
            cumValue += a.approvedValue;
            if (a.status === 'paid') cumPaid += (a.payableAmount || a.approvedValue);
            return {
                name: `Đợt ${a.periodNumber}`,
                'Luỹ kế NT': cumValue,
                'Luỹ kế TT': cumPaid,
            };
        });
    }, [acceptances]);

    // 7. Weather Distribution from Daily Logs (Pie)
    const weatherPie = useMemo(() => {
        if (dailyLogs.length === 0) return [];
        const byWeather: Record<string, number> = {};
        dailyLogs.forEach(l => { byWeather[l.weather] = (byWeather[l.weather] || 0) + 1; });
        const labels: Record<string, string> = { sunny: '☀️ Nắng', cloudy: '⛅ Mây', rainy: '🌧️ Mưa', storm: '⛈️ Bão' };
        const colors: Record<string, string> = { sunny: '#fbbf24', cloudy: '#94a3b8', rainy: '#60a5fa', storm: '#6366f1' };
        return Object.entries(byWeather).map(([k, v]) => ({ name: labels[k] || k, value: v, fill: colors[k] || '#818cf8' }));
    }, [dailyLogs]);

    // 8. Worker trend from Daily Logs (Area)
    const workerTrend = useMemo(() => {
        if (dailyLogs.length === 0) return [];
        return [...dailyLogs]
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30) // Last 30 logs
            .map(l => ({
                name: new Date(l.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                'Công nhân': l.workerCount,
            }));
    }, [dailyLogs]);

    // 9. Vendor Rating (Horizontal Bar)
    const vendorRatingData = useMemo(() => {
        return vendors.map(v => ({
            name: v.name.length > 15 ? v.name.slice(0, 15) + '…' : v.name,
            rating: v.rating,
            orders: purchaseOrders.filter(p => p.vendorId === v.id).length,
        }));
    }, [vendors, purchaseOrders]);

    // 10. Material category breakdown (Pie)
    const matCategoryPie = useMemo(() => {
        if (boqItems.length === 0) return [];
        const byCategory: Record<string, number> = {};
        boqItems.forEach(b => { byCategory[b.category] = (byCategory[b.category] || 0) + (b.budgetTotal || 0); });
        return Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v], i) => ({ name: k, value: v, fill: COLORS[i % COLORS.length] }));
    }, [boqItems]);

    // Overall KPIs
    const kpis = useMemo(() => {
        const avgProgress = tasks.length > 0 ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;
        const totalAccepted = acceptances.reduce((s, a) => s + a.approvedValue, 0);
        const totalPaid = acceptances.filter(a => a.status === 'paid').reduce((s, a) => s + (a.payableAmount || a.approvedValue), 0);
        const totalPO = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
        const totalMatBudget = boqItems.reduce((s, b) => s + (b.budgetTotal || 0), 0);
        const totalMatActual = boqItems.reduce((s, b) => s + (b.actualTotal || 0), 0);
        const wasteOverCount = boqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold).length;
        const rainyDays = dailyLogs.filter(l => l.weather === 'rainy' || l.weather === 'storm').length;
        return { avgProgress, totalAccepted, totalPaid, totalPO, totalMatBudget, totalMatActual, wasteOverCount, rainyDays };
    }, [tasks, acceptances, purchaseOrders, boqItems, dailyLogs]);

    // Chart card component
    const ChartCard: React.FC<{ title: string; icon: React.ReactNode; color: string; children: React.ReactNode; span?: number }> =
        ({ title, icon, color, children, span = 1 }) => (
            <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${span === 2 ? 'col-span-2' : ''}`}
                onClick={() => setSelectedChart(selectedChart === title ? null : title)}>
                <div className={`px-5 py-3 border-b border-slate-50 flex items-center gap-2`}>
                    <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center text-white`}>{icon}</div>
                    <span className="text-xs font-black text-slate-700">{title}</span>
                </div>
                <div className="p-4">{children}</div>
            </div>
        );

    const EmptyChart = ({ text }: { text: string }) => (
        <div className="h-[200px] flex items-center justify-center text-xs text-slate-300 font-bold">{text}</div>
    );

    return (
        <div className="space-y-6">
            {/* Summary KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                    { label: 'Tiến độ', value: `${kpis.avgProgress}%`, icon: <Activity size={10} />, color: 'text-indigo-600' },
                    { label: 'Hợp đồng', value: contracts.length, icon: <FileText size={10} />, color: 'text-blue-600' },
                    { label: 'Nghiệm thu', value: fmt(kpis.totalAccepted) + ' đ', icon: <CheckCircle2 size={10} />, color: 'text-emerald-600' },
                    { label: 'Đã TT', value: fmt(kpis.totalPaid) + ' đ', icon: <DollarSign size={10} />, color: 'text-violet-600' },
                    { label: 'PO', value: purchaseOrders.length, icon: <Truck size={10} />, color: 'text-cyan-600' },
                    { label: 'NCC', value: vendors.length, icon: <Users size={10} />, color: 'text-orange-600' },
                    { label: 'Vượt HH', value: kpis.wasteOverCount, icon: <AlertTriangle size={10} />, color: kpis.wasteOverCount > 0 ? 'text-red-600' : 'text-emerald-600' },
                    { label: 'Ngày mưa', value: kpis.rainyDays, icon: <Calendar size={10} />, color: 'text-sky-600' },
                ].map((k, i) => (
                    <div key={i} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm text-center">
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-center gap-0.5">{k.icon} {k.label}</div>
                        <div className={`text-sm font-black ${k.color}`}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* 1. Budget Waterfall */}
                <ChartCard title="Tổng quan Ngân sách" icon={<BarChart3 size={14} />} color="bg-gradient-to-br from-indigo-500 to-purple-500" span={2}>
                    {budgetWaterfall.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={budgetWaterfall} barSize={40}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => fmt(v)} />
                                <Tooltip formatter={(v: number) => fmt(v) + ' đ'} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
                                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                    {budgetWaterfall.map((entry, idx) => (
                                        <Cell key={idx} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có dữ liệu ngân sách" />}
                </ChartCard>

                {/* 2. Contract Distribution (Pie) */}
                <ChartCard title="Phân bổ Hợp đồng" icon={<PieChartIcon size={14} />} color="bg-gradient-to-br from-pink-500 to-rose-500">
                    {contractPie.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie data={contractPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}
                                    dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    labelLine={{ strokeWidth: 1 }}>
                                    {contractPie.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip formatter={(v: number) => fmt(v) + ' đ'} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có hợp đồng" />}
                </ChartCard>

                {/* 3. Task Progress (Radar) */}
                <ChartCard title="Phân bổ Tiến độ" icon={<Activity size={14} />} color="bg-gradient-to-br from-emerald-500 to-teal-500">
                    {taskRadar.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <RadarChart cx="50%" cy="50%" outerRadius={70} data={taskRadar}>
                                <PolarGrid stroke="#e2e8f0" />
                                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
                                <PolarRadiusAxis tick={{ fontSize: 9 }} />
                                <Radar name="Số lượng" dataKey="A" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                            </RadarChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có hạng mục" />}
                </ChartCard>

                {/* 4. S-Curve: Acceptance cumulative */}
                <ChartCard title="S-Curve Nghiệm thu" icon={<TrendingUp size={14} />} color="bg-gradient-to-br from-violet-500 to-purple-500" span={2}>
                    {acceptanceSCurve.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <AreaChart data={acceptanceSCurve}>
                                <defs>
                                    <linearGradient id="colorNT" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorTT" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => fmt(v)} />
                                <Tooltip formatter={(v: number) => fmt(v) + ' đ'} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Area type="monotone" dataKey="Luỹ kế NT" stroke="#818cf8" fill="url(#colorNT)" strokeWidth={2} />
                                <Area type="monotone" dataKey="Luỹ kế TT" stroke="#a78bfa" fill="url(#colorTT)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có biên bản nghiệm thu" />}
                </ChartCard>

                {/* 5. Material Waste (Bar) */}
                <ChartCard title="Hao hụt Vật tư" icon={<Package size={14} />} color="bg-gradient-to-br from-amber-500 to-orange-500">
                    {wasteData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={wasteData} barGap={2}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Bar dataKey="Dự toán" fill="#818cf8" radius={[3, 3, 0, 0]} />
                                <Bar dataKey="Thực tế" radius={[3, 3, 0, 0]}>
                                    {wasteData.map((e, i) => <Cell key={i} fill={e.isOver ? '#ef4444' : '#34d399'} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có dữ liệu BOQ" />}
                </ChartCard>

                {/* 6. Material Category (Pie) */}
                <ChartCard title="Chi phí VT theo Nhóm" icon={<PieChartIcon size={14} />} color="bg-gradient-to-br from-cyan-500 to-blue-500">
                    {matCategoryPie.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie data={matCategoryPie} cx="50%" cy="50%" outerRadius={75} paddingAngle={2}
                                    dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    labelLine={{ strokeWidth: 1 }}>
                                    {matCategoryPie.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip formatter={(v: number) => fmt(v) + ' đ'} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có dữ liệu BOQ" />}
                </ChartCard>

                {/* 7. PO Status (Donut) */}
                <ChartCard title="Trạng thái Đơn hàng" icon={<Truck size={14} />} color="bg-gradient-to-br from-teal-500 to-emerald-500">
                    {poStatusPie.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie data={poStatusPie} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}
                                    dataKey="value" label={({ name, value }) => `${name}: ${value}`}
                                    labelLine={{ strokeWidth: 1 }}>
                                    {poStatusPie.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có đơn hàng" />}
                </ChartCard>

                {/* 8. Weather Distribution (Pie) */}
                <ChartCard title="Thời tiết Công trường" icon={<Calendar size={14} />} color="bg-gradient-to-br from-sky-500 to-blue-500">
                    {weatherPie.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie data={weatherPie} cx="50%" cy="50%" outerRadius={75} paddingAngle={3}
                                    dataKey="value" label={({ name, value }) => `${name}: ${value}`}
                                    labelLine={{ strokeWidth: 1 }}>
                                    {weatherPie.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có nhật ký" />}
                </ChartCard>

                {/* 9. Worker Trend (Area) */}
                <ChartCard title="Nhân công theo ngày" icon={<Users size={14} />} color="bg-gradient-to-br from-orange-500 to-red-500" span={2}>
                    {workerTrend.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={workerTrend}>
                                <defs>
                                    <linearGradient id="colorWorker" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                                <Area type="monotone" dataKey="Công nhân" stroke="#f97316" fill="url(#colorWorker)" strokeWidth={2} dot={{ r: 2 }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có nhật ký công trường" />}
                </ChartCard>

                {/* 10. Vendor Rating (Horizontal Bar) */}
                <ChartCard title="Đánh giá NCC" icon={<Users size={14} />} color="bg-gradient-to-br from-rose-500 to-pink-500">
                    {vendorRatingData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <ComposedChart layout="vertical" data={vendorRatingData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 9, fill: '#64748b' }} />
                                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                                <Bar dataKey="rating" barSize={16} radius={[0, 4, 4, 0]}>
                                    {vendorRatingData.map((e, i) => (
                                        <Cell key={i} fill={e.rating >= 4 ? '#34d399' : e.rating >= 3 ? '#fbbf24' : '#f87171'} />
                                    ))}
                                </Bar>
                            </ComposedChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có NCC" />}
                </ChartCard>

                {/* 11. Overall Cost Breakdown (Composed: Bar + Line) */}
                <ChartCard title="Chi phí Tổng hợp" icon={<DollarSign size={14} />} color="bg-gradient-to-br from-fuchsia-500 to-purple-500">
                    {(contractValue > 0 || totalSpent > 0) ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <ComposedChart data={[
                                { name: 'HĐ', 'Giá trị': contractValue, fill: '#818cf8' },
                                { name: 'Chi phí', 'Giá trị': totalSpent, fill: '#f87171' },
                                { name: 'Lợi nhuận', 'Giá trị': contractValue - totalSpent, fill: (contractValue - totalSpent) >= 0 ? '#34d399' : '#ef4444' },
                            ]}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => fmt(v)} />
                                <Tooltip formatter={(v: number) => fmt(v) + ' đ'} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                                <Bar dataKey="Giá trị" barSize={50} radius={[6, 6, 0, 0]}>
                                    {[0,1,2].map(i => <Cell key={i} fill={['#818cf8', '#f87171', (contractValue - totalSpent) >= 0 ? '#34d399' : '#ef4444'][i]} />)}
                                </Bar>
                            </ComposedChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart text="Chưa có dữ liệu tài chính" />}
                </ChartCard>
            </div>

            {/* Summary Table */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-xs font-black text-slate-700 flex items-center gap-2"><FileText size={14} className="text-indigo-500" /> Bảng tổng hợp dự án</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50/80">
                            <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                <th className="text-left px-4 py-3">Hạng mục</th>
                                <th className="text-right px-4 py-3">Số lượng</th>
                                <th className="text-right px-4 py-3">Giá trị</th>
                                <th className="text-center px-4 py-3">Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {[
                                { name: 'Hợp đồng chính', count: contracts.filter(c => c.type === 'main').length, value: contracts.filter(c => c.type === 'main').reduce((s, c) => s + c.value, 0), status: '📋' },
                                { name: 'Hợp đồng thầu phụ', count: contracts.filter(c => c.type === 'subcontract').length, value: contracts.filter(c => c.type === 'subcontract').reduce((s, c) => s + c.value, 0), status: '🏗️' },
                                { name: 'Nghiệm thu', count: acceptances.length, value: kpis.totalAccepted, status: acceptances.filter(a => a.status === 'paid').length === acceptances.length && acceptances.length > 0 ? '✅' : '⏳' },
                                { name: 'Vật tư (DT)', count: boqItems.length, value: kpis.totalMatBudget, status: '📦' },
                                { name: 'Vật tư (TT)', count: boqItems.length, value: kpis.totalMatActual, status: kpis.totalMatActual > kpis.totalMatBudget ? '⚠️' : '✅' },
                                { name: 'Đơn hàng (PO)', count: purchaseOrders.length, value: kpis.totalPO, status: '🚛' },
                                { name: 'Nhà cung cấp', count: vendors.length, value: 0, status: '🏢' },
                                { name: 'Hạng mục (Task)', count: tasks.length, value: 0, status: `${kpis.avgProgress}%` },
                                { name: 'Nhật ký', count: dailyLogs.length, value: 0, status: '📝' },
                            ].map((row, i) => (
                                <tr key={i} className="hover:bg-slate-50/50">
                                    <td className="px-4 py-2.5 font-bold text-slate-700">{row.name}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-600">{row.count}</td>
                                    <td className="px-4 py-2.5 text-right font-bold text-slate-700">{row.value > 0 ? fmt(row.value) + ' đ' : '—'}</td>
                                    <td className="px-4 py-2.5 text-center">{row.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ReportTab;
