import React, { useState, useMemo, useEffect } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    Plus, Edit2, Trash2, X, Save, FileText, CheckCircle2, Clock,
    Send, CreditCard, ChevronDown, ChevronUp, AlertTriangle, Users,
    TrendingUp, DollarSign, Percent
} from 'lucide-react';
import { ProjectContract, AcceptanceRecord, AcceptanceStatus } from '../../types';
import { contractService, acceptanceService } from '../../lib/projectService';

interface SubcontractTabProps {
    constructionSiteId: string;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN') + ' đ';
};

const STATUS_CFG: Record<AcceptanceStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
    submitted: { label: 'Đã gửi', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Send size={12} /> },
    approved: { label: 'Đã duyệt', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    paid: { label: 'Đã TT', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', icon: <CreditCard size={12} /> },
};

const SubcontractTab: React.FC<SubcontractTabProps> = ({ constructionSiteId }) => {
    const [contracts, setContracts] = useState<ProjectContract[]>([]);
    const [acceptances, setAcceptances] = useState<AcceptanceRecord[]>([]);

    useEffect(() => {
        contractService.list(constructionSiteId)
            .then(all => setContracts(all.filter(c => c.type === 'subcontract')))
            .catch(console.error);
        acceptanceService.list(constructionSiteId).then(setAcceptances).catch(console.error);
    }, [constructionSiteId]);

    const [expandedContractId, setExpandedContractId] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<AcceptanceRecord | null>(null);
    const [formContractId, setFormContractId] = useState('');

    // Form state
    const [fPeriod, setFPeriod] = useState('');
    const [fDesc, setFDesc] = useState('');
    const [fStart, setFStart] = useState('');
    const [fEnd, setFEnd] = useState('');
    const [fValue, setFValue] = useState('');
    const [fRetention, setFRetention] = useState('5');
    const [fStatus, setFStatus] = useState<AcceptanceStatus>('draft');
    const [fNote, setFNote] = useState('');
    const [fApprovedBy, setFApprovedBy] = useState('');

    const resetForm = () => {
        setEditing(null);
        setFormContractId('');
        setFPeriod(''); setFDesc(''); setFStart(''); setFEnd('');
        setFValue(''); setFRetention('5'); setFStatus('draft');
        setFNote(''); setFApprovedBy('');
        setShowForm(false);
    };

    const openNewAcceptance = (contractId: string) => {
        resetForm();
        setFormContractId(contractId);
        const existingCount = acceptances.filter(a => a.contractId === contractId).length;
        setFPeriod(String(existingCount + 1));
        setShowForm(true);
    };

    const openEditAcceptance = (a: AcceptanceRecord) => {
        setEditing(a);
        setFormContractId(a.contractId);
        setFPeriod(String(a.periodNumber)); setFDesc(a.description);
        setFStart(a.periodStart); setFEnd(a.periodEnd);
        setFValue(String(a.approvedValue)); setFRetention(String(a.retentionPercent));
        setFStatus(a.status); setFNote(a.note || ''); setFApprovedBy(a.approvedBy || '');
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formContractId || !fValue || !fDesc) return;
        const value = Number(fValue);
        const retention = Number(fRetention);
        const retentionAmount = Math.round(value * retention / 100);
        const payableAmount = value - retentionAmount;

        const item: AcceptanceRecord = editing ? {
            ...editing,
            periodNumber: Number(fPeriod), description: fDesc,
            periodStart: fStart, periodEnd: fEnd, approvedValue: value,
            retentionPercent: retention, retentionAmount, payableAmount,
            status: fStatus, note: fNote || undefined,
            approvedBy: fApprovedBy || undefined,
            approvedAt: fStatus === 'approved' && editing.status !== 'approved' ? new Date().toISOString() : editing.approvedAt,
            paidAt: fStatus === 'paid' && editing.status !== 'paid' ? new Date().toISOString() : editing.paidAt,
        } : {
            id: crypto.randomUUID(), contractId: formContractId, constructionSiteId,
            periodNumber: Number(fPeriod), description: fDesc,
            periodStart: fStart, periodEnd: fEnd, approvedValue: value,
            retentionPercent: retention, retentionAmount, payableAmount,
            status: fStatus, note: fNote || undefined,
            approvedBy: fApprovedBy || undefined,
            approvedAt: fStatus === 'approved' ? new Date().toISOString() : undefined,
            paidAt: fStatus === 'paid' ? new Date().toISOString() : undefined,
            createdAt: new Date().toISOString(),
        };
        await acceptanceService.upsert(item);
        setAcceptances(await acceptanceService.list(constructionSiteId));
        resetForm();
    };

    const handleDeleteAcceptance = async (id: string) => {
        if (!confirm('Xoá biên bản nghiệm thu này?')) return;
        await acceptanceService.remove(id);
        setAcceptances(await acceptanceService.list(constructionSiteId));
    };

    const updateAcceptanceStatus = async (id: string, status: AcceptanceStatus) => {
        const record = acceptances.find(a => a.id === id);
        if (!record) return;
        const updated = {
            ...record, status,
            approvedAt: status === 'approved' ? new Date().toISOString() : record.approvedAt,
            paidAt: status === 'paid' ? new Date().toISOString() : record.paidAt,
        };
        await acceptanceService.upsert(updated);
        setAcceptances(await acceptanceService.list(constructionSiteId));
    };

    // Stats per contract
    const getContractStats = (contractId: string) => {
        const records = acceptances.filter(a => a.contractId === contractId);
        const totalAccepted = records.reduce((s, a) => s + a.approvedValue, 0);
        const totalPaid = records.filter(a => a.status === 'paid').reduce((s, a) => s + (a.payableAmount || a.approvedValue), 0);
        const totalRetention = records.reduce((s, a) => s + (a.retentionAmount || 0), 0);
        const remaining = totalAccepted - totalPaid - totalRetention;
        return { records, count: records.length, totalAccepted, totalPaid, totalRetention, remaining };
    };

    // Overall stats
    const overallStats = useMemo(() => {
        const totalContractValue = contracts.reduce((s, c) => s + c.value, 0);
        const totalAccepted = acceptances.reduce((s, a) => s + a.approvedValue, 0);
        const totalPaid = acceptances.filter(a => a.status === 'paid').reduce((s, a) => s + (a.payableAmount || a.approvedValue), 0);
        const totalRetention = acceptances.reduce((s, a) => s + (a.retentionAmount || 0), 0);
        const acceptPercent = totalContractValue > 0 ? Math.round(totalAccepted / totalContractValue * 100) : 0;
        return { totalContractValue, totalAccepted, totalPaid, totalRetention, acceptPercent, subCount: contracts.length };
    }, [contracts, acceptances]);

    const computedRetentionAmount = useMemo(() => {
        const v = Number(fValue) || 0;
        const r = Number(fRetention) || 0;
        return Math.round(v * r / 100);
    }, [fValue, fRetention]);

    return (
        <div className="space-y-6">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Nhà thầu phụ</h3>
                <AiInsightPanel module="subcontract" siteId={constructionSiteId} />
            </div>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Users size={10} /> Nhà thầu phụ
                    </div>
                    <div className="text-2xl font-black text-slate-800">{overallStats.subCount}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Tổng HĐ: {fmt(overallStats.totalContractValue)}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <TrendingUp size={10} /> Đã nghiệm thu
                    </div>
                    <div className="text-xl font-black text-emerald-600">{fmt(overallStats.totalAccepted)}</div>
                    <div className="text-[10px] text-emerald-500 font-bold mt-1">{overallStats.acceptPercent}% giá trị HĐ</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <DollarSign size={10} /> Đã thanh toán
                    </div>
                    <div className="text-xl font-black text-violet-600">{fmt(overallStats.totalPaid)}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Percent size={10} /> Giữ lại BH
                    </div>
                    <div className="text-xl font-black text-amber-600">{fmt(overallStats.totalRetention)}</div>
                </div>
            </div>

            {/* Subcontract List */}
            {contracts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                    <Users size={40} className="mx-auto mb-3 text-slate-200" />
                    <p className="text-sm font-bold text-slate-400 mb-1">Chưa có hợp đồng thầu phụ</p>
                    <p className="text-xs text-slate-300">Vào tab <span className="font-bold text-blue-500">📋 Hợp đồng</span> để thêm HĐ thầu phụ trước</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {contracts.map(contract => {
                        const stats = getContractStats(contract.id);
                        const isExpanded = expandedContractId === contract.id;
                        const payPercent = contract.value > 0 ? Math.round(stats.totalPaid / contract.value * 100) : 0;

                        return (
                            <div key={contract.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                {/* Contract Header */}
                                <div className="p-5 cursor-pointer hover:bg-slate-50/50 transition-colors"
                                    onClick={() => setExpandedContractId(isExpanded ? null : contract.id)}>
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white text-lg shrink-0">
                                                🏗️
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-2">
                                                    {contract.contractNumber}
                                                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold border ${contract.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                                                        {contract.status === 'active' ? 'Hiệu lực' : contract.status}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-400">{contract.partyName}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="text-right hidden md:block">
                                                <div className="text-sm font-black text-slate-800">{fmt(contract.value)}</div>
                                                <div className="text-[10px] text-slate-400">{stats.count} đợt NT</div>
                                            </div>
                                            {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                                        </div>
                                    </div>

                                    {/* Progress bars */}
                                    <div className="mt-3 grid grid-cols-3 gap-3 text-[10px]">
                                        <div>
                                            <div className="flex justify-between text-slate-400 mb-1">
                                                <span>Nghiệm thu</span>
                                                <span className="font-bold text-emerald-500">{fmt(stats.totalAccepted)}</span>
                                            </div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, contract.value > 0 ? stats.totalAccepted / contract.value * 100 : 0)}%` }} />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-slate-400 mb-1">
                                                <span>Đã TT</span>
                                                <span className="font-bold text-violet-500">{payPercent}%</span>
                                            </div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.min(100, payPercent)}%` }} />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-slate-400 mb-1">
                                                <span>Giữ lại BH</span>
                                                <span className="font-bold text-amber-500">{fmt(stats.totalRetention)}</span>
                                            </div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${Math.min(100, contract.value > 0 ? stats.totalRetention / contract.value * 100 : 0)}%` }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded: Acceptance Records */}
                                {isExpanded && (
                                    <div className="border-t border-slate-100">
                                        {/* Payment summary row */}
                                        <div className="px-5 py-3 bg-gradient-to-r from-slate-50/50 to-white grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                                            <div><span className="text-slate-400 block text-[10px]">Giá trị HĐ</span><span className="font-black text-slate-800">{fmt(contract.value)}</span></div>
                                            <div><span className="text-slate-400 block text-[10px]">Đã NT</span><span className="font-black text-emerald-600">{fmt(stats.totalAccepted)}</span></div>
                                            <div><span className="text-slate-400 block text-[10px]">Đã TT</span><span className="font-black text-violet-600">{fmt(stats.totalPaid)}</span></div>
                                            <div><span className="text-slate-400 block text-[10px]">Giữ lại</span><span className="font-black text-amber-600">{fmt(stats.totalRetention)}</span></div>
                                            <div><span className="text-slate-400 block text-[10px]">Còn lại</span><span className="font-black text-red-500">{fmt(stats.remaining)}</span></div>
                                        </div>

                                        {/* Acceptance Records Header */}
                                        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                                            <span className="text-xs font-black text-slate-600 flex items-center gap-1">
                                                <CheckCircle2 size={12} className="text-emerald-500" /> Biên bản nghiệm thu
                                            </span>
                                            <button onClick={() => openNewAcceptance(contract.id)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-all">
                                                <Plus size={12} /> Tạo đợt NT
                                            </button>
                                        </div>

                                        {/* Records List */}
                                        {stats.records.length === 0 ? (
                                            <div className="px-5 py-8 text-center text-sm text-slate-300">
                                                Chưa có biên bản nghiệm thu nào
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-slate-50">
                                                {stats.records.sort((a, b) => a.periodNumber - b.periodNumber).map(record => {
                                                    const stCfg = STATUS_CFG[record.status];
                                                    return (
                                                        <div key={record.id} className="px-5 py-3.5 hover:bg-slate-50/30 transition-colors group">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 flex items-center justify-center shrink-0">
                                                                        <span className="text-xs font-black text-emerald-600">#{record.periodNumber}</span>
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="text-xs font-bold text-slate-700 truncate flex items-center gap-2">
                                                                            {record.description}
                                                                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                                                {stCfg.icon} {stCfg.label}
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                                                            {record.periodStart && record.periodEnd ? `${new Date(record.periodStart).toLocaleDateString('vi-VN')} → ${new Date(record.periodEnd).toLocaleDateString('vi-VN')}` : '—'}
                                                                            {record.approvedBy && <span className="ml-2">• Duyệt: {record.approvedBy}</span>}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-3 shrink-0">
                                                                    <div className="text-right">
                                                                        <div className="text-sm font-black text-slate-800">{fmt(record.approvedValue)}</div>
                                                                        <div className="text-[9px] text-slate-400">
                                                                            TT: {fmt(record.payableAmount || record.approvedValue)} | BH: {fmt(record.retentionAmount || 0)}
                                                                        </div>
                                                                    </div>
                                                                    {/* Status action buttons */}
                                                                    <div className="flex gap-1">
                                                                        {record.status === 'draft' && (
                                                                            <button onClick={() => updateAcceptanceStatus(record.id, 'submitted')}
                                                                                title="Gửi duyệt"
                                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent hover:border-amber-200">
                                                                                <Send size={13} />
                                                                            </button>
                                                                        )}
                                                                        {record.status === 'submitted' && (
                                                                            <button onClick={() => updateAcceptanceStatus(record.id, 'approved')}
                                                                                title="Phê duyệt"
                                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-200">
                                                                                <CheckCircle2 size={13} />
                                                                            </button>
                                                                        )}
                                                                        {record.status === 'approved' && (
                                                                            <button onClick={() => updateAcceptanceStatus(record.id, 'paid')}
                                                                                title="Đã thanh toán"
                                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-400 hover:text-violet-600 hover:bg-violet-50 border border-transparent hover:border-violet-200">
                                                                                <CreditCard size={13} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        <button onClick={() => openEditAcceptance(record)}
                                                                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                                        <button onClick={() => handleDeleteAcceptance(record.id)}
                                                                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
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
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Acceptance Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editing ? <><Edit2 size={18} /> Sửa nghiệm thu</> : <><Plus size={18} /> Tạo biên bản NT</>}
                            </span>
                            <button onClick={resetForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Contract info */}
                            <div className="px-3 py-2 rounded-xl bg-orange-50 border border-orange-100 text-xs">
                                <span className="text-orange-500 font-bold">HĐ: </span>
                                <span className="font-bold text-slate-700">
                                    {contracts.find(c => c.id === formContractId)?.contractNumber} — {contracts.find(c => c.id === formContractId)?.partyName}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đợt NT</label>
                                    <input type="number" value={fPeriod} onChange={e => setFPeriod(e.target.value)} placeholder="1"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Trạng thái</label>
                                    <select value={fStatus} onChange={e => setFStatus(e.target.value as AcceptanceStatus)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none">
                                        {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                                <input value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="VD: Nghiệm thu đợt 1 - Phần móng"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Từ ngày</label>
                                    <input type="date" value={fStart} onChange={e => setFStart(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đến ngày</label>
                                    <input type="date" value={fEnd} onChange={e => setFEnd(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Giá trị nghiệm thu (VNĐ)</label>
                                    <input type="number" value={fValue} onChange={e => setFValue(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">% Giữ lại BH</label>
                                    <input type="number" value={fRetention} onChange={e => setFRetention(e.target.value)} placeholder="5" min={0} max={100}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                            </div>

                            {/* Auto-calc preview */}
                            {fValue && (
                                <div className="px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-xs grid grid-cols-3 gap-2">
                                    <div><span className="text-emerald-400 block">Giá trị NT</span><span className="font-black text-emerald-700">{fmt(Number(fValue))}</span></div>
                                    <div><span className="text-amber-400 block">Giữ lại BH</span><span className="font-black text-amber-600">- {fmt(computedRetentionAmount)}</span></div>
                                    <div><span className="text-violet-400 block">Thanh toán</span><span className="font-black text-violet-700">{fmt(Number(fValue) - computedRetentionAmount)}</span></div>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Người duyệt</label>
                                <input value={fApprovedBy} onChange={e => setFApprovedBy(e.target.value)} placeholder="Tên người duyệt"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={fNote} onChange={e => setFNote(e.target.value)} rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSave} disabled={!fDesc || !fValue}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editing ? 'Lưu' : 'Tạo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubcontractTab;
