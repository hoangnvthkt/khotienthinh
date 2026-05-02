import React, { useState, useMemo, useEffect, useRef } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    Plus, Edit2, Trash2, X, Save, Package, AlertTriangle, TrendingUp,
    CheckCircle2, Clock, Ban, FileCheck, ChevronDown, ChevronUp,
    BarChart3, Search, Truck, ArrowRight
} from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { MaterialBudgetItem, InventoryItem, MaterialRequest, RequestStatus } from '../../types';
import { boqService } from '../../lib/projectService';
import { useApp } from '../../context/AppContext';
import RequestModal from '../../components/RequestModal';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface MaterialTabProps {
    constructionSiteId?: string;
    projectId?: string;
    siteWarehouseId?: string; // ID kho công trường
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const REQ_STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    PENDING:    { label: 'Chờ duyệt', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Clock size={12} /> },
    APPROVED:   { label: 'Chờ xuất kho', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: <CheckCircle2 size={12} /> },
    IN_TRANSIT: { label: 'Đang giao', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200', icon: <Truck size={12} /> },
    COMPLETED:  { label: 'Đã nhận', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <FileCheck size={12} /> },
    REJECTED:   { label: 'Từ chối', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
};

const MaterialTab: React.FC<MaterialTabProps> = ({ constructionSiteId, projectId, siteWarehouseId }) => {
    const { items: inventoryItems, requests: allRequests, warehouses, users } = useApp();
    const toast = useToast();
    const confirm = useConfirm();
    const effectiveId = projectId || constructionSiteId || '';
    const [activeSubTab, setActiveSubTab] = useState<'summary' | 'boq' | 'request' | 'waste' | 'dashboard'>('summary');

    // BOQ Data
    const [boqItems, setBoqItems] = useState<MaterialBudgetItem[]>([]);

    // Resolve siteWarehouseId: use prop or find warehouse named 'RICO'
    const resolvedWhId = useMemo(() => {
        if (siteWarehouseId) return siteWarehouseId;
        const ricoWh = warehouses.find(w => w.name.toUpperCase().includes('RICO'));
        return ricoWh?.id || 'wh-1';
    }, [siteWarehouseId, warehouses]);

    // Material Requests — filtered to this site's warehouse
    const requests = useMemo(() => {
        return allRequests.filter(r => r.siteWarehouseId === resolvedWhId);
    }, [allRequests, resolvedWhId]);

    // Request Modal state
    const [isReqModalOpen, setReqModalOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);

    useEffect(() => {
        if (!effectiveId) return;
        boqService.list(effectiveId, constructionSiteId || null).then(setBoqItems).catch(console.error);
    }, [effectiveId, constructionSiteId]);

    const [showBoqForm, setShowBoqForm] = useState(false);
    const [editingBoq, setEditingBoq] = useState<MaterialBudgetItem | null>(null);
    // Unused old state removed — now using RequestModal from inventory module

    // BOQ Form
    const [bCat, setBCat] = useState('Vật liệu xây dựng');
    const [bName, setBName] = useState('');
    const [bUnit, setBUnit] = useState('');
    const [bBudgetQty, setBBudgetQty] = useState('');
    const [bPrice, setBPrice] = useState('');
    const [bThreshold, setBThreshold] = useState('5');
    const [bNotes, setBNotes] = useState('');
    const [bInventoryItemId, setBInventoryItemId] = useState('');
    const [bMaterialCode, setBMaterialCode] = useState('');

    // Autocomplete state
    const [acQuery, setAcQuery] = useState('');
    const [acOpen, setAcOpen] = useState(false);
    const acRef = useRef<HTMLDivElement>(null);
    const acSuggestions = useMemo(() => {
        if (!acQuery || acQuery.length < 1) return [];
        const q = acQuery.toLowerCase();
        return inventoryItems.filter(i =>
            i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
        ).slice(0, 8);
    }, [acQuery, inventoryItems]);

    const selectInventoryItem = (item: InventoryItem) => {
        setBInventoryItemId(item.id);
        setBMaterialCode(item.sku);
        setBName(item.name);
        setBCat(item.category);
        setBUnit(item.unit);
        setBPrice(String(item.priceIn));
        setAcQuery(item.name);
        setAcOpen(false);
    };

    const resetBoqForm = () => {
        setEditingBoq(null); setShowBoqForm(false);
        setBCat('Vật liệu xây dựng'); setBName(''); setBUnit(''); setBBudgetQty('');
        setBPrice(''); setBThreshold('5'); setBNotes('');
        setBInventoryItemId(''); setBMaterialCode(''); setAcQuery('');
    };

    const openEditBoq = (item: MaterialBudgetItem) => {
        setEditingBoq(item);
        setBCat(item.category); setBName(item.itemName); setBUnit(item.unit);
        setBBudgetQty(String(item.budgetQty)); setBPrice(String(item.budgetUnitPrice));
        setBThreshold(String(item.wasteThreshold));
        setBNotes(item.notes || '');
        setBInventoryItemId(item.inventoryItemId || '');
        setBMaterialCode(item.materialCode || '');
        setAcQuery(item.itemName);
        setShowBoqForm(true);
    };

    // Compute actualQty from MaterialRequests (COMPLETED + IN_TRANSIT)
    const computedBoqItems = useMemo(() => {
        return boqItems.map(b => {
            if (!b.inventoryItemId) return b;
            // Sum approvedQty from completed/in_transit requests
            let totalApproved = 0;
            let totalRequested = 0;
            requests.forEach(r => {
                const rItems = r.items || [];
                rItems.forEach((ri: any) => {
                    if (ri.itemId === b.inventoryItemId) {
                        totalRequested += (ri.requestQty || 0);
                        if (r.status === RequestStatus.COMPLETED || r.status === RequestStatus.IN_TRANSIT) {
                            totalApproved += (ri.approvedQty || 0);
                        }
                    }
                });
            });
            const actualQty = totalApproved;
            const wasteQty = actualQty - b.budgetQty;
            const wastePercent = b.budgetQty > 0 ? Math.round((wasteQty / b.budgetQty) * 1000) / 10 : 0;
            const budgetOverPercent = b.budgetQty > 0 ? Math.round(((totalRequested - b.budgetQty) / b.budgetQty) * 1000) / 10 : 0;
            return {
                ...b,
                actualQty,
                actualTotal: actualQty * b.budgetUnitPrice,
                wasteQty,
                wastePercent,
                wasteValue: wasteQty * b.budgetUnitPrice,
                cumulativeRequested: totalRequested,
                cumulativeExported: actualQty,
                budgetOverPercent: Math.max(0, budgetOverPercent),
                stockBalance: (b.cumulativeImported || 0) - actualQty,
                autoAlert: budgetOverPercent > 0 ? 'Vượt ngân sách' : wastePercent > b.wasteThreshold ? 'Vượt định mức hao hụt' : undefined,
            };
        });
    }, [boqItems, requests]);

    const handleSaveBoq = async () => {
        if (!bName || !bUnit || !bBudgetQty || !bPrice) return;
        const budgetQty = Number(bBudgetQty);
        const budgetUnitPrice = Number(bPrice);

        const item: MaterialBudgetItem = {
            id: editingBoq?.id || crypto.randomUUID(),
            projectId: projectId || constructionSiteId || null,
            constructionSiteId: constructionSiteId || null,
            inventoryItemId: bInventoryItemId || undefined,
            materialCode: bMaterialCode || undefined,
            category: bCat, itemName: bName, unit: bUnit,
            budgetQty, budgetUnitPrice,
            budgetTotal: budgetQty * budgetUnitPrice,
            actualQty: 0,
            wasteThreshold: Number(bThreshold),
            notes: bNotes || undefined,
        };

        await boqService.upsert(item);
        setBoqItems(await boqService.list(effectiveId, constructionSiteId || null));
        toast.success(editingBoq ? 'Cập nhật BOQ' : 'Thêm mục BOQ thành công');
        resetBoqForm();
    };

    const handleDeleteBoq = async (id: string, name: string) => {
        const ok = await confirm({ targetName: name, title: 'Xoá mục BOQ' });
        if (!ok) return;
        try {
            await boqService.remove(id);
            setBoqItems(await boqService.list(effectiveId, constructionSiteId || null));
            toast.success('Xoá BOQ thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    // Stats using computed data
    const stats = useMemo(() => {
        const totalBudget = computedBoqItems.reduce((s, b) => s + (b.budgetTotal || 0), 0);
        const totalActual = computedBoqItems.reduce((s, b) => s + (b.actualTotal || 0), 0);
        const overWaste = computedBoqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold);
        const overBudget = computedBoqItems.filter(b => (b.budgetOverPercent || 0) > 0);
        const totalWasteValue = computedBoqItems.reduce((s, b) => s + Math.abs(b.wasteValue || 0), 0);
        const totalRequested = computedBoqItems.reduce((s, b) => s + (b.cumulativeRequested || 0) * (b.budgetUnitPrice || 0), 0);
        const pending = requests.filter(r => r.status === RequestStatus.PENDING).length;
        return { totalBudget, totalActual, diff: totalActual - totalBudget, overWaste: overWaste.length, overBudget: overBudget.length, totalWasteValue, totalRequested, pendingReq: pending, boqCount: computedBoqItems.length };
    }, [computedBoqItems, requests]);

    // Chart data for waste comparison
    const wasteChartData = useMemo(() => {
        return computedBoqItems.map(b => ({
            name: b.itemName.length > 8 ? b.itemName.slice(0, 8) + '…' : b.itemName,
            'Dự toán': b.budgetQty,
            'Thực tế': b.actualQty,
            waste: b.wastePercent || 0,
            threshold: b.wasteThreshold,
            isOver: (b.wastePercent || 0) > b.wasteThreshold,
        }));
    }, [computedBoqItems]);

    return (
        <div className="space-y-6">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Quản lý vật tư</h3>
                <AiInsightPanel module="material" siteId={constructionSiteId} />
            </div>
            {/* KPI Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Package size={10} /> Hạng mục</div>
                    <div className="text-2xl font-black text-slate-800">{stats.boqCount}</div>
                    <div className="text-[10px] text-slate-400">DT: {fmt(stats.totalBudget)} đ</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingUp size={10} /> Chi phí TT</div>
                    <div className={`text-xl font-black ${stats.diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(stats.totalActual)} đ</div>
                    <div className={`text-[10px] font-bold ${stats.diff > 0 ? 'text-red-400' : 'text-emerald-500'}`}>{stats.diff > 0 ? '+' : ''}{fmt(stats.diff)} đ</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><AlertTriangle size={10} /> Vượt hao hụt</div>
                    <div className={`text-2xl font-black ${stats.overWaste > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{stats.overWaste}</div>
                    <div className="text-[10px] text-slate-400">/ {stats.overBudget} vượt NS</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">💰 GT Hao hụt</div>
                    <div className={`text-xl font-black ${stats.totalWasteValue > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(stats.totalWasteValue)} đ</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={10} /> YC chờ duyệt</div>
                    <div className="text-2xl font-black text-amber-600">{stats.pendingReq}</div>
                    <div className="text-[10px] text-slate-400">{requests.length} phiếu tổng</div>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm">
                {[
                    { key: 'summary' as const, label: '🔗 Tổng hợp', count: computedBoqItems.length },
                    { key: 'boq' as const, label: '📋 BOQ', count: computedBoqItems.length },
                    { key: 'request' as const, label: '📦 Yêu cầu', count: requests.length },
                    { key: 'waste' as const, label: '📊 Hao hụt', count: stats.overWaste },
                    { key: 'dashboard' as const, label: '📈 Dashboard', count: 0 },
                ].map(t => (
                    <button key={t.key} onClick={() => setActiveSubTab(t.key)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-bold transition-all ${
                            activeSubTab === t.key ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                        }`}>
                        {t.label} {t.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeSubTab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
                    </button>
                ))}
            </div>

            {/* ===== SUMMARY TAB - Bảng tổng hợp 1 dòng ===== */}
            {activeSubTab === 'summary' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <div><h4 className="text-sm font-black text-slate-800">📊 Bảng tổng hợp vật tư</h4><p className="text-[10px] text-slate-400">Toàn bộ chỉ số trên 1 dòng — liên kết BOQ↔YC↔PO↔Kho</p></div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[1200px]">
                            <thead>
                                <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase tracking-wider">
                                    <th className="p-2.5 sticky left-0 bg-slate-50 z-10">Mã VT</th>
                                    <th className="p-2.5">Vật tư</th>
                                    <th className="p-2.5">ĐVT</th>
                                    <th className="p-2.5 text-right">Ngân sách</th>
                                    <th className="p-2.5 text-right">LK Yêu cầu</th>
                                    <th className="p-2.5 text-right text-amber-600">% Vượt NS</th>
                                    <th className="p-2.5 text-right">LK Nhập</th>
                                    <th className="p-2.5 text-right">LK Xuất</th>
                                    <th className="p-2.5 text-right">Tồn kho</th>
                                    <th className="p-2.5 text-right">HH (%)</th>
                                    <th className="p-2.5 text-right">Định mức</th>
                                    <th className="p-2.5 text-right text-red-500">GT Hao hụt</th>
                                    <th className="p-2.5">Cảnh báo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 text-xs">
                                {computedBoqItems.map(b => {
                                    const overBudget = (b.budgetOverPercent || 0) > 0;
                                    const overWaste = (b.wastePercent || 0) > b.wasteThreshold;
                                    const negStock = (b.stockBalance || 0) < 0;
                                    return (
                                        <tr key={b.id} className={`hover:bg-slate-50 ${overWaste ? 'bg-red-50/40' : overBudget ? 'bg-amber-50/40' : ''}`}>
                                            <td className="p-2.5 font-mono text-[10px] text-indigo-500 font-bold sticky left-0 bg-white z-10">{b.materialCode || '—'}</td>
                                            <td className="p-2.5 font-bold text-slate-800 max-w-[140px] truncate">{b.itemName}</td>
                                            <td className="p-2.5 text-slate-400">{b.unit}</td>
                                            <td className="p-2.5 text-right font-bold">{b.budgetQty.toLocaleString()}</td>
                                            <td className="p-2.5 text-right font-bold">{(b.cumulativeRequested || 0).toLocaleString()}</td>
                                            <td className={`p-2.5 text-right font-black ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {(b.budgetOverPercent || 0) > 0 ? '+' : ''}{(b.budgetOverPercent || 0).toFixed(1)}%
                                            </td>
                                            <td className="p-2.5 text-right">{(b.cumulativeImported || 0).toLocaleString()}</td>
                                            <td className="p-2.5 text-right">{(b.cumulativeExported || 0).toLocaleString()}</td>
                                            <td className={`p-2.5 text-right font-bold ${negStock ? 'text-red-600' : 'text-emerald-600'}`}>{(b.stockBalance || 0).toLocaleString()}</td>
                                            <td className={`p-2.5 text-right font-bold ${overWaste ? 'text-red-600' : 'text-slate-600'}`}>{(b.wastePercent || 0).toFixed(1)}%</td>
                                            <td className="p-2.5 text-right text-slate-400">{b.wasteThreshold}%</td>
                                            <td className={`p-2.5 text-right font-bold ${(b.wasteValue || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(Math.abs(b.wasteValue || 0))}</td>
                                            <td className="p-2.5">
                                                {b.autoAlert ? (
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                                        b.autoAlert.includes('Vượt') ? 'bg-red-100 text-red-700' : b.autoAlert.includes('Cận') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                                    }`}>
                                                        <AlertTriangle size={9} /> {b.autoAlert}
                                                    </span>
                                                ) : <span className="text-[9px] text-emerald-500 font-bold">✓ OK</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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
                    {computedBoqItems.length === 0 ? (
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
                                    {computedBoqItems.map(item => {
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
                                                        <button onClick={() => handleDeleteBoq(item.id, item.itemName)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
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

            {/* Material Request Tab — using MaterialRequest from Inventory module */}
            {activeSubTab === 'request' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Package size={16} className="text-purple-500" /> Đề xuất vật tư ({requests.length})</h3>
                        <button onClick={() => { setSelectedRequest(undefined); setReqModalOpen(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100">
                            <Plus size={12} /> Tạo đề xuất
                        </button>
                    </div>
                    {requests.length === 0 ? (
                        <div className="p-12 text-center">
                            <Package size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có phiếu đề xuất vật tư</p>
                            <p className="text-[10px] text-slate-300 mt-1">Tạo đề xuất mới để yêu cầu vật tư từ Kho Tổng</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50/80">
                                    <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                        <th className="text-left px-4 py-3">Mã phiếu</th>
                                        <th className="text-left px-4 py-3">Ngày tạo</th>
                                        <th className="text-left px-4 py-3">Vật tư</th>
                                        <th className="text-center px-4 py-3">Trạng thái</th>
                                        <th className="text-left px-4 py-3">Ghi chú</th>
                                        <th className="text-center px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {requests.sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || '')).map(req => {
                                        const stCfg = REQ_STATUS_MAP[req.status] || REQ_STATUS_MAP.PENDING;
                                        const reqUser = users.find(u => u.id === req.requesterId);
                                        const reqItems = (req.items || []) as any[];
                                        return (
                                            <tr key={req.id} className="hover:bg-slate-50/50 group">
                                                <td className="px-4 py-3">
                                                    <span className="font-mono font-bold text-indigo-600">{req.code}</span>
                                                </td>
                                                <td className="px-4 py-3 text-slate-500">
                                                    {req.createdDate ? new Date(req.createdDate).toLocaleDateString('vi-VN') : '—'}
                                                    <div className="text-[10px] text-slate-300 mt-0.5">{reqUser?.name || 'N/A'}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap gap-1">
                                                        {reqItems.slice(0, 3).map((ri: any, idx: number) => {
                                                            const inv = inventoryItems.find(i => i.id === ri.itemId);
                                                            return (
                                                                <span key={idx} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-50 border border-slate-100 text-slate-600 font-medium">
                                                                    {inv?.name || ri.itemId} ({ri.requestQty})
                                                                </span>
                                                            );
                                                        })}
                                                        {reqItems.length > 3 && <span className="text-[9px] text-slate-400">+{reqItems.length - 3}</span>}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-full text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                        {stCfg.icon} {stCfg.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">{req.note || '—'}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <button onClick={() => { setSelectedRequest(req); setReqModalOpen(true); }}
                                                        className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition">
                                                        <ArrowRight size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Waste Comparison Tab */}
            {activeSubTab === 'waste' && (
                <div className="space-y-4">
                    {computedBoqItems.length === 0 ? (
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
                                            {computedBoqItems.sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)).map(item => {
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
                            {/* Autocomplete: Chọn vật tư từ Kho */}
                            <div ref={acRef} className="relative">
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">🔍 Tìm vật tư từ Kho (gõ mã SKU hoặc tên)</label>
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                                    <input value={acQuery}
                                        onChange={e => { setAcQuery(e.target.value); setAcOpen(true); }}
                                        onFocus={() => acQuery && setAcOpen(true)}
                                        placeholder="VD: VT00040 hoặc Thép phi 22..."
                                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-indigo-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-indigo-50/30" />
                                </div>
                                {acOpen && acSuggestions.length > 0 && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                        {acSuggestions.map(item => (
                                            <button key={item.id} onClick={() => selectInventoryItem(item)}
                                                className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 flex items-center justify-between gap-2 border-b border-slate-50 last:border-b-0">
                                                <div>
                                                    <span className="text-xs font-bold text-slate-800">{item.name}</span>
                                                    <span className="text-[10px] text-slate-400 ml-2">({item.sku})</span>
                                                </div>
                                                <div className="text-[10px] text-right shrink-0">
                                                    <span className="text-slate-400">{item.unit}</span>
                                                    <span className="text-indigo-500 font-bold ml-2">{fmt(item.priceIn)} đ</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {bInventoryItemId && (
                                <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs flex items-center gap-2">
                                    <CheckCircle2 size={12} className="text-emerald-500" />
                                    <span className="font-bold text-emerald-700">Đã chọn: {bName}</span>
                                    <span className="text-emerald-500">({bMaterialCode})</span>
                                    <span className="text-emerald-400 ml-auto">{bCat} • {bUnit} • {fmt(Number(bPrice))} đ</span>
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn vị</label>
                                    <input value={bUnit} onChange={e => setBUnit(e.target.value)} placeholder="kg, m3..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">KL Dự toán *</label>
                                    <input type="number" value={bBudgetQty} onChange={e => setBBudgetQty(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-indigo-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn giá (VNĐ)</label>
                                    <input type="number" value={bPrice} onChange={e => setBPrice(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngưỡng hao hụt (%)</label>
                                    <input type="number" value={bThreshold} onChange={e => setBThreshold(e.target.value)} placeholder="5"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 text-blue-400">KL Thực xuất (tự động)</label>
                                    <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-400">
                                        Tự tính từ phiếu đề xuất đã duyệt
                                    </div>
                                </div>
                            </div>
                            {bBudgetQty && bPrice && (
                                <div className="px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-xs">
                                    <span className="text-indigo-400">Dự toán:</span>
                                    <span className="font-black text-indigo-700 ml-1">{fmt(Number(bBudgetQty) * Number(bPrice))} đ</span>
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

            {/* ===== DASHBOARD TAB ===== */}
            {activeSubTab === 'dashboard' && (
                <div className="space-y-6">
                    {/* Row 1: Pie + Bar */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Pie Chart - Budget by Category */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                            <h4 className="text-sm font-black text-slate-800 mb-4">🥧 Ngân sách theo nhóm VT</h4>
                            <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                    <Pie data={(() => {
                                        const catMap: Record<string, number> = {};
                                        computedBoqItems.forEach(b => { catMap[b.category] = (catMap[b.category] || 0) + (b.budgetTotal || 0); });
                                        return Object.entries(catMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
                                    })()} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                        {['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'].map((c, i) => <Cell key={i} fill={c} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: number) => fmt(v) + ' đ'} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Bar Chart - Top 10 Value */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                            <h4 className="text-sm font-black text-slate-800 mb-4">📊 Top giá trị DT cao nhất</h4>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={[...computedBoqItems].sort((a, b) => (b.budgetTotal || 0) - (a.budgetTotal || 0)).slice(0, 8).map(b => ({
                                    name: b.itemName.length > 10 ? b.itemName.slice(0, 10) + '…' : b.itemName,
                                    'Dự toán': (b.budgetTotal || 0) / 1e6,
                                    'Thực tế': (b.actualTotal || 0) / 1e6,
                                }))} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" tickFormatter={v => v + 'tr'} />
                                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                                    <Tooltip formatter={(v: number) => v.toFixed(0) + ' triệu'} />
                                    <Legend />
                                    <Bar dataKey="Dự toán" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                    <Bar dataKey="Thực tế" fill="#ec4899" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Row 2: Budget Overrun Ranking + Waste Alert Table */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Budget Overrun */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100"><h4 className="text-sm font-black text-slate-800">🔴 Vật tư VƯỢT ngân sách</h4></div>
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                                    <th className="p-2.5 text-left">Vật tư</th><th className="p-2.5 text-right">NS</th><th className="p-2.5 text-right">LK YC</th><th className="p-2.5 text-right">% Vượt</th>
                                </tr></thead>
                                <tbody className="divide-y divide-slate-50">
                                    {computedBoqItems.filter(b => (b.budgetOverPercent || 0) > 0).sort((a, b) => (b.budgetOverPercent || 0) - (a.budgetOverPercent || 0)).map(b => (
                                        <tr key={b.id} className="hover:bg-red-50/50">
                                            <td className="p-2.5 font-bold text-slate-800">{b.itemName}</td>
                                            <td className="p-2.5 text-right">{b.budgetQty.toLocaleString()}</td>
                                            <td className="p-2.5 text-right font-bold">{(b.cumulativeRequested || 0).toLocaleString()}</td>
                                            <td className="p-2.5 text-right font-black text-red-600">+{(b.budgetOverPercent || 0).toFixed(1)}%</td>
                                        </tr>
                                    ))}
                                    {computedBoqItems.filter(b => (b.budgetOverPercent || 0) > 0).length === 0 && (
                                        <tr><td colSpan={4} className="p-6 text-center text-slate-300 text-[10px] font-bold uppercase">Không có vật tư vượt NS</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {/* Waste Alert */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100"><h4 className="text-sm font-black text-slate-800">⚠️ Vật tư VƯỢT hao hụt</h4></div>
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                                    <th className="p-2.5 text-left">Vật tư</th><th className="p-2.5 text-right">HH%</th><th className="p-2.5 text-right">Định mức</th><th className="p-2.5 text-right">GT Hao hụt</th>
                                </tr></thead>
                                <tbody className="divide-y divide-slate-50">
                                    {computedBoqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold).sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)).map(b => (
                                        <tr key={b.id} className="hover:bg-amber-50/50">
                                            <td className="p-2.5 font-bold text-slate-800">{b.itemName}</td>
                                            <td className="p-2.5 text-right font-black text-red-600">{(b.wastePercent || 0).toFixed(1)}%</td>
                                            <td className="p-2.5 text-right text-slate-400">{b.wasteThreshold}%</td>
                                            <td className="p-2.5 text-right font-bold text-red-600">{fmt(Math.abs(b.wasteValue || 0))} đ</td>
                                        </tr>
                                    ))}
                                    {computedBoqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold).length === 0 && (
                                        <tr><td colSpan={4} className="p-6 text-center text-slate-300 text-[10px] font-bold uppercase">Tất cả trong định mức</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Request Modal — Integrated from Inventory Module */}
            {isReqModalOpen && (
                <RequestModal
                    isOpen={isReqModalOpen}
                    onClose={() => { setReqModalOpen(false); setSelectedRequest(undefined); }}
                    request={selectedRequest}
                    defaultSiteWarehouseId={resolvedWhId}
                />
            )}
        </div>
    );
};

export default MaterialTab;
