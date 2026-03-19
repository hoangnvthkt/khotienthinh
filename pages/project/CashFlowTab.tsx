import React, { useState, useMemo, useEffect } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
    DollarSign, TrendingUp, TrendingDown, Calendar, Plus, X, Check,
    AlertTriangle, Clock, ArrowUpRight, ArrowDownRight, Trash2, Edit2, Save
} from 'lucide-react';
import { ProjectTransaction, PaymentSchedule, PaymentScheduleStatus } from '../../types';
import { paymentService } from '../../lib/projectService';

interface CashFlowTabProps {
    constructionSiteId: string;
    transactions: ProjectTransaction[];
    contractValue: number;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return n.toLocaleString('vi-VN');
};
const fmtFull = (n: number) => n.toLocaleString('vi-VN') + ' đ';

const RANGE_OPTIONS = [
    { key: '3m', label: '3 tháng' },
    { key: '6m', label: '6 tháng' },
    { key: '12m', label: '12 tháng' },
    { key: 'all', label: 'Tất cả' },
] as const;

const STATUS_BADGES: Record<PaymentScheduleStatus, { label: string; color: string; bg: string }> = {
    pending: { label: 'Chờ TT', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
    paid: { label: 'Đã TT', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
    overdue: { label: 'Quá hạn', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
};

const CashFlowTab: React.FC<CashFlowTabProps> = ({ constructionSiteId, transactions, contractValue }) => {
    const [range, setRange] = useState<'3m' | '6m' | '12m' | 'all'>('12m');
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [editingPayment, setEditingPayment] = useState<PaymentSchedule | null>(null);

    // Payment schedule state (Supabase)
    const [paymentSchedules, setPaymentSchedules] = useState<PaymentSchedule[]>([]);

    useEffect(() => {
        paymentService.list(constructionSiteId).then(setPaymentSchedules).catch(console.error);
    }, [constructionSiteId]);

    // Payment form state
    const [pDesc, setPDesc] = useState('');
    const [pAmount, setPAmount] = useState('');
    const [pDueDate, setPDueDate] = useState('');
    const [pType, setPType] = useState<'receivable' | 'payable'>('receivable');
    const [pContact, setPContact] = useState('');

    const resetPaymentForm = () => {
        setEditingPayment(null);
        setPDesc(''); setPAmount(''); setPDueDate('');
        setPType('receivable'); setPContact('');
        setShowPaymentForm(false);
    };

    const openEditPayment = (p: PaymentSchedule) => {
        setEditingPayment(p);
        setPDesc(p.description); setPAmount(String(p.amount));
        setPDueDate(p.dueDate); setPType(p.type); setPContact(p.contactName || '');
        setShowPaymentForm(true);
    };

    const handleSavePayment = async () => {
        if (!pDesc || !pAmount || !pDueDate) return;
        const now = new Date().toISOString().split('T')[0];
        const isOverdue = pDueDate < now;

        const item: PaymentSchedule = editingPayment ? {
            ...editingPayment,
            description: pDesc, amount: Number(pAmount), dueDate: pDueDate,
            type: pType, contactName: pContact,
            status: editingPayment.status === 'paid' ? 'paid' : isOverdue ? 'overdue' : 'pending',
        } : {
            id: crypto.randomUUID(),
            constructionSiteId,
            description: pDesc, amount: Number(pAmount), dueDate: pDueDate,
            status: isOverdue ? 'overdue' : 'pending',
            type: pType, contactName: pContact,
        };
        await paymentService.upsert(item);
        setPaymentSchedules(await paymentService.list(constructionSiteId));
        resetPaymentForm();
    };

    const markPaid = async (id: string) => {
        const p = paymentSchedules.find(x => x.id === id);
        if (!p) return;
        await paymentService.upsert({ ...p, status: 'paid', paidDate: new Date().toISOString().split('T')[0], paidAmount: p.amount });
        setPaymentSchedules(await paymentService.list(constructionSiteId));
    };

    const deletePayment = async (id: string) => {
        if (!confirm('Xoá lịch thanh toán này?')) return;
        await paymentService.remove(id);
        setPaymentSchedules(await paymentService.list(constructionSiteId));
    };

    // Auto-update overdue
    useEffect(() => {
        const now = new Date().toISOString().split('T')[0];
        const overdueItems = paymentSchedules.filter(p => p.status === 'pending' && p.dueDate < now);
        if (overdueItems.length > 0) {
            Promise.all(overdueItems.map(p => paymentService.upsert({ ...p, status: 'overdue' as const })))
                .then(() => paymentService.list(constructionSiteId))
                .then(setPaymentSchedules)
                .catch(console.error);
        }
    }, [paymentSchedules.length]);

    // ========== CHART DATA ==========
    const chartData = useMemo(() => {
        const now = new Date();
        const rangeMap = { '3m': 3, '6m': 6, '12m': 12, 'all': 120 };
        const monthsBack = rangeMap[range];
        const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);

        // Build month buckets
        const months: { key: string; label: string; expense: number; revenue: number; cumExpense: number; cumRevenue: number; profit: number }[] = [];
        const cur = new Date(startDate);
        while (cur <= now) {
            months.push({
                key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
                label: `T${cur.getMonth() + 1}/${String(cur.getFullYear()).slice(2)}`,
                expense: 0, revenue: 0, cumExpense: 0, cumRevenue: 0, profit: 0,
            });
            cur.setMonth(cur.getMonth() + 1);
        }

        // Fill data
        transactions.forEach(tx => {
            const d = new Date(tx.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const m = months.find(mo => mo.key === key);
            if (m) {
                if (tx.type === 'expense') m.expense += tx.amount;
                else m.revenue += tx.amount;
            }
        });

        // Cumulative
        let ce = 0, cr = 0;
        months.forEach(m => {
            ce += m.expense;
            cr += m.revenue;
            m.cumExpense = ce;
            m.cumRevenue = cr;
            m.profit = cr - ce;
        });

        return months;
    }, [transactions, range]);

    // ========== SUMMARY ==========
    const summary = useMemo(() => {
        const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const totalRevenue = transactions.filter(t => t.type === 'revenue_received').reduce((s, t) => s + t.amount, 0);
        const totalPending = transactions.filter(t => t.type === 'revenue_pending').reduce((s, t) => s + t.amount, 0);
        const profit = totalRevenue - totalExpense;

        const receivables = paymentSchedules.filter(p => p.type === 'receivable' && p.status !== 'paid');
        const payables = paymentSchedules.filter(p => p.type === 'payable' && p.status !== 'paid');
        const overdueCount = paymentSchedules.filter(p => p.status === 'overdue').length;
        const totalReceivable = receivables.reduce((s, p) => s + p.amount, 0);
        const totalPayable = payables.reduce((s, p) => s + p.amount, 0);

        return { totalExpense, totalRevenue, totalPending, profit, totalReceivable, totalPayable, overdueCount };
    }, [transactions, paymentSchedules]);

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><TrendingUp size={11} /> Tổng thu</div>
                    <div className="text-xl font-black text-emerald-600">{fmt(summary.totalRevenue)}</div>
                    <div className="text-[10px] text-amber-500 font-bold mt-1">Chờ: {fmt(summary.totalPending)}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><TrendingDown size={11} /> Tổng chi</div>
                    <div className="text-xl font-black text-orange-600">{fmt(summary.totalExpense)}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{((summary.totalExpense / (contractValue || 1)) * 100).toFixed(1)}% HĐ</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign size={11} /> Lợi nhuận</div>
                    <div className={`text-xl font-black ${summary.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(summary.profit)}</div>
                    <div className={`text-[10px] font-bold mt-1 flex items-center gap-0.5 ${summary.profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {summary.profit >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                        {((summary.profit / (contractValue || 1)) * 100).toFixed(1)}%
                    </div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertTriangle size={11} /> Công nợ</div>
                    <div className="flex gap-3">
                        <div>
                            <div className="text-xs font-black text-blue-600">{fmt(summary.totalReceivable)}</div>
                            <div className="text-[9px] text-slate-400">Phải thu</div>
                        </div>
                        <div>
                            <div className="text-xs font-black text-orange-600">{fmt(summary.totalPayable)}</div>
                            <div className="text-[9px] text-slate-400">Phải trả</div>
                        </div>
                    </div>
                    {summary.overdueCount > 0 && (
                        <div className="text-[10px] font-bold text-red-500 mt-1 flex items-center gap-0.5">
                            <AlertTriangle size={10} /> {summary.overdueCount} quá hạn
                        </div>
                    )}
                </div>
            </div>

            {/* Cash Flow Chart */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                        <DollarSign size={16} className="text-indigo-500" /> Dòng tiền luỹ kế
                    </h3>
                    <div className="flex items-center gap-1.5">
                        {RANGE_OPTIONS.map(r => (
                            <button key={r.key} onClick={() => setRange(r.key)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${range === r.key ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:bg-slate-100'}`}>
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="p-5 h-[320px]">
                    {chartData.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-20">
                            <DollarSign size={48} />
                            <p className="text-xs font-black uppercase mt-3">Chưa có dữ liệu</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="cfRevGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="cfExpGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="cfProfitGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }}
                                    tickFormatter={v => v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v} />
                                <Tooltip contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 8px 16px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                                    formatter={(value: any, name: string) => [fmtFull(Number(value)), name]} />
                                <Area type="monotone" dataKey="cumRevenue" name="Thu luỹ kế" stroke="#10b981" strokeWidth={2.5} fill="url(#cfRevGrad)" dot={{ r: 3, fill: '#10b981' }} />
                                <Area type="monotone" dataKey="cumExpense" name="Chi luỹ kế" stroke="#f97316" strokeWidth={2.5} fill="url(#cfExpGrad)" dot={{ r: 3, fill: '#f97316' }} />
                                <Area type="monotone" dataKey="profit" name="Lợi nhuận" stroke="#6366f1" strokeWidth={2} fill="url(#cfProfitGrad)" dot={{ r: 2, fill: '#6366f1' }} strokeDasharray="5 5" />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* Monthly breakdown table */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                        <Calendar size={16} className="text-violet-500" /> Chi tiết theo tháng
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50/50 text-[9px] uppercase font-black text-slate-400 tracking-widest border-b border-slate-100">
                                <th className="p-3">Tháng</th>
                                <th className="p-3 text-right">Thu trong kỳ</th>
                                <th className="p-3 text-right">Chi trong kỳ</th>
                                <th className="p-3 text-right">Thu luỹ kế</th>
                                <th className="p-3 text-right">Chi luỹ kế</th>
                                <th className="p-3 text-right">Lợi nhuận LK</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-xs">
                            {chartData.map(m => (
                                <tr key={m.key} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="p-3 font-bold text-slate-700">{m.label}</td>
                                    <td className="p-3 text-right font-bold text-emerald-600">{m.revenue > 0 ? `+${fmt(m.revenue)}` : '—'}</td>
                                    <td className="p-3 text-right font-bold text-orange-600">{m.expense > 0 ? `-${fmt(m.expense)}` : '—'}</td>
                                    <td className="p-3 text-right text-emerald-600">{fmt(m.cumRevenue)}</td>
                                    <td className="p-3 text-right text-orange-600">{fmt(m.cumExpense)}</td>
                                    <td className={`p-3 text-right font-black ${m.profit >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>{fmt(m.profit)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Payment Schedule */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                        <Clock size={16} className="text-amber-500" /> Lịch thanh toán ({paymentSchedules.length})
                    </h3>
                    <button onClick={() => { resetPaymentForm(); setShowPaymentForm(true); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-all">
                        <Plus size={12} /> Thêm đợt TT
                    </button>
                </div>

                {paymentSchedules.length === 0 ? (
                    <div className="p-12 text-center">
                        <Clock size={36} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-sm font-bold text-slate-400">Chưa có lịch thanh toán</p>
                        <p className="text-xs text-slate-300 mt-1">Thêm các đợt thanh toán để theo dõi công nợ</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {paymentSchedules
                            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                            .map(p => {
                                const badge = STATUS_BADGES[p.status];
                                return (
                                    <div key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors group">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${p.type === 'receivable' ? 'bg-blue-50 text-blue-500' : 'bg-orange-50 text-orange-500'}`}>
                                                {p.type === 'receivable' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-slate-800 truncate">{p.description}</div>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                                    <span>{p.type === 'receivable' ? '📥 Phải thu' : '📤 Phải trả'}</span>
                                                    {p.contactName && <><span>•</span><span>{p.contactName}</span></>}
                                                    <span>•</span>
                                                    <span>Hạn: {new Date(p.dueDate).toLocaleDateString('vi-VN')}</span>
                                                    {p.paidDate && <><span>•</span><span className="text-emerald-500">TT: {new Date(p.paidDate).toLocaleDateString('vi-VN')}</span></>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <div className="text-right">
                                                <div className="text-sm font-black text-slate-800">{fmtFull(p.amount)}</div>
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold border ${badge.bg} ${badge.color}`}>
                                                    {badge.label}
                                                </span>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {p.status !== 'paid' && (
                                                    <button onClick={() => markPaid(p.id)} title="Đánh dấu đã TT"
                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50">
                                                        <Check size={14} />
                                                    </button>
                                                )}
                                                <button onClick={() => openEditPayment(p)} title="Sửa"
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50">
                                                    <Edit2 size={13} />
                                                </button>
                                                <button onClick={() => deletePayment(p.id)} title="Xoá"
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                )}
            </div>

            {/* Payment Form Modal */}
            {showPaymentForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => resetPaymentForm()}>
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-500 to-violet-600 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingPayment ? <><Edit2 size={18} /> Sửa đợt thanh toán</> : <><Plus size={18} /> Thêm đợt thanh toán</>}
                            </span>
                            <button onClick={resetPaymentForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại</label>
                                <div className="flex gap-2">
                                    <button onClick={() => setPType('receivable')} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${pType === 'receivable' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>📥 Phải thu (CĐT)</button>
                                    <button onClick={() => setPType('payable')} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${pType === 'payable' ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-slate-200 text-slate-500'}`}>📤 Phải trả (NTP)</button>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                                <input value={pDesc} onChange={e => setPDesc(e.target.value)} placeholder="VD: Đợt 1 - Tạm ứng 30%"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số tiền (VNĐ)</label>
                                    <input type="number" value={pAmount} onChange={e => setPAmount(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Hạn thanh toán</label>
                                    <input type="date" value={pDueDate} onChange={e => setPDueDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đối tác (tuỳ chọn)</label>
                                <input value={pContact} onChange={e => setPContact(e.target.value)} placeholder="VD: Chủ đầu tư ABC / NTP XYZ"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetPaymentForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSavePayment} disabled={!pDesc || !pAmount || !pDueDate}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingPayment ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CashFlowTab;
