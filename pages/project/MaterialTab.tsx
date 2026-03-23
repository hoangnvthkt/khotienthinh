import React, { useState, useMemo, useEffect } from 'react';
import {
    Plus, Edit2, Trash2, X, Save, Package, AlertTriangle, TrendingUp,
    CheckCircle2, Clock, Ban, FileCheck, ChevronDown, ChevronUp,
    BarChart3
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { MaterialBudgetItem, ProjectMaterialRequest, MaterialRequestStatus } from '../../types';
import { boqService, matRequestService } from '../../lib/projectService';

interface MaterialTabProps {
    constructionSiteId: string;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const REQ_STATUS: Record<MaterialRequestStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    pending: { label: 'Chờ duyệt', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Clock size={12} /> },
    approved: { label: 'Đã duyệt', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    rejected: { label: 'Từ chối', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
    fulfilled: { label: 'Đã cấp', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', icon: <FileCheck size={12} /> },
};

const CATEGORIES = ['Xi măng', 'Thép', 'Cát', 'Đá', 'Gạch', 'Gỗ', 'Sơn', 'Ống nước', 'Dây điện', 'Khác'];

const MaterialTab: React.FC<MaterialTabProps> = ({ constructionSiteId }) => {
    const [activeSubTab, setActiveSubTab] = useState<'boq' | 'request' | 'waste'>('boq');

    // BOQ Data
    const [boqItems, setBoqItems] = useState<MaterialBudgetItem[]>([]);

    // Material Requests
    const [requests, setRequests] = useState<ProjectMaterialRequest[]>([]);

    useEffect(() => {
        boqService.list(constructionSiteId).then(setBoqItems).catch(console.error);
        matRequestService.list(constructionSiteId).then(setRequests).catch(console.error);
    }, [constructionSiteId]);

    const [showBoqForm, setShowBoqForm] = useState(false);
    const [editingBoq, setEditingBoq] = useState<MaterialBudgetItem | null>(null);
    const [showReqForm, setShowReqForm] = useState(false);
    const [editingReq, setEditingReq] = useState<ProjectMaterialRequest | null>(null);

    // BOQ Form
    const [bCat, setBCat] = useState('Xi măng');
    const [bName, setBName] = useState('');
    const [bUnit, setBUnit] = useState('');
    const [bBudgetQty, setBBudgetQty] = useState('');
    const [bPrice, setBPrice] = useState('');
    const [bActualQty, setBActualQty] = useState('0');
    const [bThreshold, setBThreshold] = useState('5');
    const [bNotes, setBNotes] = useState('');

    // Request Form
    const [rNum, setRNum] = useState('');
    const [rBy, setRBy] = useState('');
    const [rDate, setRDate] = useState(new Date().toISOString().split('T')[0]);
    const [rItems, setRItems] = useState<{ itemName: string; unit: string; qty: number; note?: string }[]>([{ itemName: '', unit: '', qty: 0 }]);
    const [rNote, setRNote] = useState('');

    const resetBoqForm = () => {
        setEditingBoq(null); setShowBoqForm(false);
        setBCat('Xi măng'); setBName(''); setBUnit(''); setBBudgetQty('');
        setBPrice(''); setBActualQty('0'); setBThreshold('5'); setBNotes('');
    };

    const openEditBoq = (item: MaterialBudgetItem) => {
        setEditingBoq(item);
        setBCat(item.category); setBName(item.itemName); setBUnit(item.unit);
        setBBudgetQty(String(item.budgetQty)); setBPrice(String(item.budgetUnitPrice));
        setBActualQty(String(item.actualQty)); setBThreshold(String(item.wasteThreshold));
        setBNotes(item.notes || '');
        setShowBoqForm(true);
    };

    const handleSaveBoq = async () => {
        if (!bName || !bUnit || !bBudgetQty || !bPrice) return;
        const budgetQty = Number(bBudgetQty);
        const actualQty = Number(bActualQty);
        const budgetUnitPrice = Number(bPrice);
        const wasteQty = actualQty - budgetQty;
        const wastePercent = budgetQty > 0 ? Math.round((wasteQty / budgetQty) * 1000) / 10 : 0;

        const item: MaterialBudgetItem = {
            id: editingBoq?.id || crypto.randomUUID(),
            constructionSiteId,
            category: bCat, itemName: bName, unit: bUnit,
            budgetQty, budgetUnitPrice,
            budgetTotal: budgetQty * budgetUnitPrice,
            actualQty, actualTotal: actualQty * budgetUnitPrice,
            wasteQty, wastePercent,
            wasteThreshold: Number(bThreshold),
            notes: bNotes || undefined,
        };

        await boqService.upsert(item);
        setBoqItems(await boqService.list(constructionSiteId));
        resetBoqForm();
    };

    const resetReqForm = () => {
        setEditingReq(null); setShowReqForm(false);
        setRNum(''); setRBy(''); setRDate(new Date().toISOString().split('T')[0]);
        setRItems([{ itemName: '', unit: '', qty: 0 }]); setRNote('');
    };

    const openEditReq = (req: ProjectMaterialRequest) => {
        setEditingReq(req);
        setRNum(req.requestNumber); setRBy(req.requestedBy);
        setRDate(req.requestDate); setRItems([...req.items]); setRNote(req.note || '');
        setShowReqForm(true);
    };

    const handleSaveReq = async () => {
        if (!rNum || !rBy || rItems.every(i => !i.itemName)) return;
        const validItems = rItems.filter(i => i.itemName);
        const reqItem: ProjectMaterialRequest = editingReq ? {
            ...editingReq, requestNumber: rNum, requestedBy: rBy,
            requestDate: rDate, items: validItems, totalItems: validItems.length,
            note: rNote || undefined,
        } : {
            id: crypto.randomUUID(), constructionSiteId,
            requestNumber: rNum, requestedBy: rBy, requestDate: rDate,
            items: validItems, totalItems: validItems.length,
            status: 'pending' as const, note: rNote || undefined,
            createdAt: new Date().toISOString(),
        };
        await matRequestService.upsert(reqItem);
        setRequests(await matRequestService.list(constructionSiteId));
        resetReqForm();
    };

    const updateReqStatus = async (id: string, status: MaterialRequestStatus) => {
        const req = requests.find(r => r.id === id);
        if (!req) return;
        const updated = {
            ...req, status,
            approvedAt: status === 'approved' ? new Date().toISOString() : req.approvedAt,
            fulfilledAt: status === 'fulfilled' ? new Date().toISOString() : req.fulfilledAt,
        };
        await matRequestService.upsert(updated);
        setRequests(await matRequestService.list(constructionSiteId));
    };

    // Stats
    const stats = useMemo(() => {
        const totalBudget = boqItems.reduce((s, b) => s + (b.budgetTotal || 0), 0);
        const totalActual = boqItems.reduce((s, b) => s + (b.actualTotal || 0), 0);
        const overWaste = boqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold);
        const pending = requests.filter(r => r.status === 'pending').length;
        return { totalBudget, totalActual, diff: totalActual - totalBudget, overWaste: overWaste.length, pendingReq: pending, boqCount: boqItems.length };
    }, [boqItems, requests]);

    // Chart data for waste comparison
    const wasteChartData = useMemo(() => {
        return boqItems.map(b => ({
            name: b.itemName.length > 8 ? b.itemName.slice(0, 8) + '…' : b.itemName,
            'Dự toán': b.budgetQty,
            'Thực tế': b.actualQty,
            waste: b.wastePercent || 0,
            threshold: b.wasteThreshold,
            isOver: (b.wastePercent || 0) > b.wasteThreshold,
        }));
    }, [boqItems]);

    return (
        <div className="space-y-6">
            {/* KPI Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Package size={10} /> Hạng mục BOQ</div>
                    <div className="text-2xl font-black text-slate-800">{stats.boqCount}</div>
                    <div className="text-[10px] text-slate-400 mt-1">DT: {fmt(stats.totalBudget)} đ</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><TrendingUp size={10} /> Chi phí thực tế</div>
                    <div className={`text-xl font-black ${stats.diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(stats.totalActual)} đ</div>
                    <div className={`text-[10px] font-bold mt-1 ${stats.diff > 0 ? 'text-red-400' : 'text-emerald-500'}`}>
                        {stats.diff > 0 ? '+' : ''}{fmt(stats.diff)} đ
                    </div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertTriangle size={10} /> Vượt hao hụt</div>
                    <div className={`text-2xl font-black ${stats.overWaste > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{stats.overWaste}</div>
                    <div className="text-[10px] text-slate-400 mt-1">hạng mục vượt ngưỡng</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Clock size={10} /> Yêu cầu chờ</div>
                    <div className="text-2xl font-black text-amber-600">{stats.pendingReq}</div>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm">
                {[
                    { key: 'boq' as const, label: '📋 Định mức (BOQ)', count: boqItems.length },
                    { key: 'request' as const, label: '📦 Yêu cầu vật tư', count: requests.length },
                    { key: 'waste' as const, label: '📊 Hao hụt', count: stats.overWaste },
                ].map(t => (
                    <button key={t.key} onClick={() => setActiveSubTab(t.key)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                            activeSubTab === t.key ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                        }`}>
                        {t.label} {t.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeSubTab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
                    </button>
                ))}
            </div>

            {/* BOQ Tab */}
            {activeSubTab === 'boq' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Package size={16} className="text-indigo-500" /> Bảng dự toán vật tư (BOQ)</h3>
                        <button onClick={() => { resetBoqForm(); setShowBoqForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100">
                            <Plus size={12} /> Thêm
                        </button>
                    </div>
                    {boqItems.length === 0 ? (
                        <div className="p-12 text-center">
                            <Package size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có dữ liệu BOQ</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50/80">
                                    <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                        <th className="text-left px-4 py-3">Nhóm</th>
                                        <th className="text-left px-4 py-3">Vật tư</th>
                                        <th className="text-center px-4 py-3">ĐVT</th>
                                        <th className="text-right px-4 py-3">KL Dự toán</th>
                                        <th className="text-right px-4 py-3">Đơn giá</th>
                                        <th className="text-right px-4 py-3">KL Thực tế</th>
                                        <th className="text-right px-4 py-3">Hao hụt</th>
                                        <th className="text-center px-4 py-3">TT</th>
                                        <th className="text-center px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {boqItems.map(item => {
                                        const isOver = (item.wastePercent || 0) > item.wasteThreshold;
                                        return (
                                            <tr key={item.id} className="hover:bg-slate-50/50 group">
                                                <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">{item.category}</span></td>
                                                <td className="px-4 py-2.5 font-bold text-slate-700">{item.itemName}</td>
                                                <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700">{item.budgetQty.toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-500">{fmt(item.budgetUnitPrice)}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700">{item.actualQty.toLocaleString()}</td>
                                                <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : (item.wastePercent || 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                    {(item.wastePercent || 0) > 0 ? '+' : ''}{item.wastePercent || 0}%
                                                    {isOver && <AlertTriangle size={10} className="inline ml-1" />}
                                                </td>
                                                <td className="px-4 py-2.5 text-center">
                                                    {isOver ? (
                                                        <span className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-red-50 text-red-500"><AlertTriangle size={10} /></span>
                                                    ) : (
                                                        <span className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><CheckCircle2 size={10} /></span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                        <button onClick={() => openEditBoq(item)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                        <button onClick={async () => { if(confirm('Xoá?')) { await boqService.remove(item.id); setBoqItems(await boqService.list(constructionSiteId)); } }} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-slate-50/80 font-bold">
                                    <tr className="text-xs">
                                        <td colSpan={3} className="px-4 py-3 text-slate-600">TỔNG CỘNG</td>
                                        <td className="px-4 py-3 text-right text-slate-700">{fmt(stats.totalBudget)} đ</td>
                                        <td className="px-4 py-3"></td>
                                        <td className="px-4 py-3 text-right text-slate-700">{fmt(stats.totalActual)} đ</td>
                                        <td className={`px-4 py-3 text-right font-black ${stats.diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                            {stats.diff > 0 ? '+' : ''}{fmt(stats.diff)} đ
                                        </td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Material Request Tab */}
            {activeSubTab === 'request' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Package size={16} className="text-purple-500" /> Phiếu yêu cầu vật tư</h3>
                        <button onClick={() => { resetReqForm(); setRNum(`YC-${String(requests.length + 1).padStart(3, '0')}`); setShowReqForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100">
                            <Plus size={12} /> Tạo phiếu
                        </button>
                    </div>
                    {requests.length === 0 ? (
                        <div className="p-12 text-center">
                            <Package size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có phiếu yêu cầu</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(req => {
                                const stCfg = REQ_STATUS[req.status];
                                return (
                                    <div key={req.id} className="px-5 py-4 hover:bg-slate-50/30 group">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className="w-9 h-9 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0">
                                                    <span className="text-[9px] font-black text-purple-600">📦</span>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                        {req.requestNumber}
                                                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                            {stCfg.icon} {stCfg.label}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                                        Người yêu cầu: {req.requestedBy} • {new Date(req.requestDate).toLocaleDateString('vi-VN')} • {req.totalItems} mục
                                                    </div>
                                                    {req.items.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {req.items.slice(0, 3).map((item, i) => (
                                                                <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-50 border border-slate-100 text-slate-500">{item.itemName} ({item.qty} {item.unit})</span>
                                                            ))}
                                                            {req.items.length > 3 && <span className="text-[9px] text-slate-400">+{req.items.length - 3} mục</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {req.status === 'pending' && (
                                                    <>
                                                        <button onClick={() => updateReqStatus(req.id, 'approved')} title="Duyệt"
                                                            className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-200"><CheckCircle2 size={13} /></button>
                                                        <button onClick={() => updateReqStatus(req.id, 'rejected')} title="Từ chối"
                                                            className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200"><Ban size={13} /></button>
                                                    </>
                                                )}
                                                {req.status === 'approved' && (
                                                    <button onClick={() => updateReqStatus(req.id, 'fulfilled')} title="Đã cấp"
                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-400 hover:text-violet-600 hover:bg-violet-50 border border-transparent hover:border-violet-200"><FileCheck size={13} /></button>
                                                )}
                                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                    <button onClick={() => openEditReq(req)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                    <button onClick={async () => { if(confirm('Xoá?')) { await matRequestService.remove(req.id); setRequests(await matRequestService.list(constructionSiteId)); } }} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Waste Comparison Tab */}
            {activeSubTab === 'waste' && (
                <div className="space-y-4">
                    {boqItems.length === 0 ? (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                            <BarChart3 size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Thêm dữ liệu BOQ để so sánh hao hụt</p>
                        </div>
                    ) : (
                        <>
                            {/* Bar chart: Budget vs Actual */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-indigo-500" /> Dự toán vs Thực tế</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={wasteChartData} barGap={4}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Bar dataKey="Dự toán" fill="#818cf8" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="Thực tế" radius={[4, 4, 0, 0]}>
                                            {wasteChartData.map((entry, idx) => (
                                                <Cell key={idx} fill={entry.isOver ? '#ef4444' : '#10b981'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Waste detail table */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                <div className="p-5 border-b border-slate-100">
                                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> Chi tiết hao hụt</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50/80">
                                            <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                                <th className="text-left px-4 py-3">Vật tư</th>
                                                <th className="text-center px-4 py-3">ĐVT</th>
                                                <th className="text-right px-4 py-3">Dự toán</th>
                                                <th className="text-right px-4 py-3">Thực tế</th>
                                                <th className="text-right px-4 py-3">Chênh lệch</th>
                                                <th className="text-right px-4 py-3">% Hao hụt</th>
                                                <th className="text-right px-4 py-3">Ngưỡng</th>
                                                <th className="text-center px-4 py-3">Trạng thái</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {boqItems.sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)).map(item => {
                                                const isOver = (item.wastePercent || 0) > item.wasteThreshold;
                                                const isNeg = (item.wastePercent || 0) <= 0;
                                                return (
                                                    <tr key={item.id} className={`${isOver ? 'bg-red-50/30' : ''}`}>
                                                        <td className="px-4 py-2.5 font-bold text-slate-700">{item.itemName}</td>
                                                        <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-600">{item.budgetQty.toLocaleString()}</td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-slate-700">{item.actualQty.toLocaleString()}</td>
                                                        <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {(item.wasteQty || 0) > 0 ? '+' : ''}{(item.wasteQty || 0).toLocaleString()}
                                                        </td>
                                                        <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : isNeg ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                            {(item.wastePercent || 0) > 0 ? '+' : ''}{item.wastePercent || 0}%
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right text-slate-400">{item.wasteThreshold}%</td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            {isOver ? (
                                                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold bg-red-50 border border-red-200 text-red-600"><AlertTriangle size={9} /> Vượt</span>
                                                            ) : isNeg ? (
                                                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-600"><CheckCircle2 size={9} /> Tốt</span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 border border-amber-200 text-amber-600"><Clock size={9} /> OK</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* BOQ Form Modal */}
            {showBoqForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingBoq ? <><Edit2 size={18} /> Sửa BOQ</> : <><Plus size={18} /> Thêm BOQ</>}
                            </span>
                            <button onClick={resetBoqForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nhóm vật tư</label>
                                    <select value={bCat} onChange={e => setBCat(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên vật tư</label>
                                    <input value={bName} onChange={e => setBName(e.target.value)} placeholder="VD: Xi măng PCB40"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn vị</label>
                                    <input value={bUnit} onChange={e => setBUnit(e.target.value)} placeholder="kg, m3, tấn..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">KL Dự toán</label>
                                    <input type="number" value={bBudgetQty} onChange={e => setBBudgetQty(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn giá (VNĐ)</label>
                                    <input type="number" value={bPrice} onChange={e => setBPrice(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">KL Thực xuất</label>
                                    <input type="number" value={bActualQty} onChange={e => setBActualQty(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngưỡng hao hụt (%)</label>
                                    <input type="number" value={bThreshold} onChange={e => setBThreshold(e.target.value)} placeholder="5"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                            </div>
                            {bBudgetQty && bPrice && (
                                <div className="px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-xs grid grid-cols-3 gap-2">
                                    <div><span className="text-indigo-400 block">Dự toán</span><span className="font-black text-indigo-700">{fmt(Number(bBudgetQty) * Number(bPrice))} đ</span></div>
                                    <div><span className="text-slate-400 block">Thực tế</span><span className="font-black text-slate-700">{fmt(Number(bActualQty) * Number(bPrice))} đ</span></div>
                                    <div>
                                        <span className="text-slate-400 block">Hao hụt</span>
                                        <span className={`font-black ${Number(bActualQty) > Number(bBudgetQty) ? 'text-red-500' : 'text-emerald-600'}`}>
                                            {Number(bBudgetQty) > 0 ? (Math.round((Number(bActualQty) - Number(bBudgetQty)) / Number(bBudgetQty) * 1000) / 10) : 0}%
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={bNotes} onChange={e => setBNotes(e.target.value)} rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetBoqForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveBoq} disabled={!bName || !bUnit || !bBudgetQty || !bPrice}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingBoq ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Request Form Modal */}
            {showReqForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-purple-500 to-pink-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingReq ? <><Edit2 size={18} /> Sửa phiếu</> : <><Plus size={18} /> Tạo phiếu YC</>}
                            </span>
                            <button onClick={resetReqForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số phiếu</label>
                                    <input value={rNum} onChange={e => setRNum(e.target.value)} placeholder="YC-001"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-purple-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Người yêu cầu</label>
                                    <input value={rBy} onChange={e => setRBy(e.target.value)} placeholder="Tên"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-purple-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày</label>
                                    <input type="date" value={rDate} onChange={e => setRDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                                    <span>Danh sách vật tư</span>
                                    <button onClick={() => setRItems([...rItems, { itemName: '', unit: '', qty: 0 }])}
                                        className="text-purple-500 hover:text-purple-700 flex items-center gap-0.5"><Plus size={10} /> Thêm dòng</button>
                                </label>
                                <div className="space-y-2 mt-2">
                                    {rItems.map((item, i) => (
                                        <div key={i} className="flex gap-2 items-center">
                                            <input value={item.itemName} onChange={e => { const n = [...rItems]; n[i].itemName = e.target.value; setRItems(n); }}
                                                placeholder="Tên vật tư" className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-purple-500 outline-none" />
                                            <input value={item.unit} onChange={e => { const n = [...rItems]; n[i].unit = e.target.value; setRItems(n); }}
                                                placeholder="ĐVT" className="w-16 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-purple-500 outline-none" />
                                            <input type="number" value={item.qty || ''} onChange={e => { const n = [...rItems]; n[i].qty = Number(e.target.value); setRItems(n); }}
                                                placeholder="SL" className="w-16 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-purple-500 outline-none" />
                                            {rItems.length > 1 && (
                                                <button onClick={() => setRItems(rItems.filter((_, j) => j !== i))} className="text-red-300 hover:text-red-500"><X size={14} /></button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={rNote} onChange={e => setRNote(e.target.value)} rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetReqForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveReq} disabled={!rNum || !rBy}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingReq ? 'Lưu' : 'Tạo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MaterialTab;
