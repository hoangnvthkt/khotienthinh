import React, { useState, useMemo } from 'react';
import {
    Plus, Edit2, Trash2, X, Save, FileText, Paperclip,
    CheckCircle2, AlertCircle, Clock, Ban
} from 'lucide-react';
import { ProjectContract, ContractType, ContractStatus } from '../../types';

interface ContractTabProps {
    constructionSiteId: string;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN') + ' đ';
};

const STATUS_CFG: Record<ContractStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
    active: { label: 'Hiệu lực', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    completed: { label: 'Hoàn thành', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', icon: <CheckCircle2 size={12} /> },
    terminated: { label: 'Huỷ bỏ', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
};

const TYPE_CFG: Record<ContractType, { label: string; icon: string; color: string }> = {
    main: { label: 'HĐ Chính (A)', icon: '📋', color: 'text-blue-600 bg-blue-50 border-blue-200' },
    subcontract: { label: 'Thầu phụ', icon: '🏗️', color: 'text-orange-600 bg-orange-50 border-orange-200' },
};

const ContractTab: React.FC<ContractTabProps> = ({ constructionSiteId }) => {
    const [contracts, setContracts] = useState<ProjectContract[]>(() => {
        const saved = localStorage.getItem(`contracts_${constructionSiteId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<ProjectContract | null>(null);
    const [filterType, setFilterType] = useState<ContractType | 'all'>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Form state
    const [fNum, setFNum] = useState('');
    const [fType, setFType] = useState<ContractType>('main');
    const [fParty, setFParty] = useState('');
    const [fValue, setFValue] = useState('');
    const [fSignDate, setFSignDate] = useState('');
    const [fStartDate, setFStartDate] = useState('');
    const [fEndDate, setFEndDate] = useState('');
    const [fStatus, setFStatus] = useState<ContractStatus>('active');
    const [fTerms, setFTerms] = useState('');
    const [fNote, setFNote] = useState('');

    const save = (list: ProjectContract[]) => {
        setContracts(list);
        localStorage.setItem(`contracts_${constructionSiteId}`, JSON.stringify(list));
    };

    const resetForm = () => {
        setEditing(null);
        setFNum(''); setFType('main'); setFParty(''); setFValue('');
        setFSignDate(''); setFStartDate(''); setFEndDate('');
        setFStatus('active'); setFTerms(''); setFNote('');
        setShowForm(false);
    };

    const openEdit = (c: ProjectContract) => {
        setEditing(c);
        setFNum(c.contractNumber); setFType(c.type); setFParty(c.partyName);
        setFValue(String(c.value)); setFSignDate(c.signDate); setFStartDate(c.startDate);
        setFEndDate(c.endDate); setFStatus(c.status); setFTerms(c.paymentTerms || '');
        setFNote(c.note || '');
        setShowForm(true);
    };

    const handleSave = () => {
        if (!fNum || !fParty || !fValue) return;
        if (editing) {
            save(contracts.map(c => c.id === editing.id ? {
                ...editing, contractNumber: fNum, type: fType, partyName: fParty,
                value: Number(fValue), signDate: fSignDate, startDate: fStartDate,
                endDate: fEndDate, status: fStatus, paymentTerms: fTerms, note: fNote,
            } : c));
        } else {
            const nc: ProjectContract = {
                id: crypto.randomUUID(), constructionSiteId,
                contractNumber: fNum, type: fType, partyName: fParty,
                value: Number(fValue), signDate: fSignDate, startDate: fStartDate,
                endDate: fEndDate, status: fStatus, paymentTerms: fTerms, note: fNote,
                createdAt: new Date().toISOString(),
            };
            save([...contracts, nc]);
        }
        resetForm();
    };

    const handleDelete = (id: string) => {
        if (confirm('Xoá hợp đồng này?')) save(contracts.filter(c => c.id !== id));
    };

    const filtered = useMemo(() => {
        let list = contracts;
        if (filterType !== 'all') list = list.filter(c => c.type === filterType);
        return list.sort((a, b) => b.signDate.localeCompare(a.signDate));
    }, [contracts, filterType]);

    const stats = useMemo(() => {
        const mainContracts = contracts.filter(c => c.type === 'main');
        const subContracts = contracts.filter(c => c.type === 'subcontract');
        return {
            total: contracts.length,
            mainValue: mainContracts.reduce((s, c) => s + c.value, 0),
            subValue: subContracts.reduce((s, c) => s + c.value, 0),
            active: contracts.filter(c => c.status === 'active').length,
        };
    }, [contracts]);

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tổng HĐ</div>
                    <div className="text-2xl font-black text-slate-800">{stats.total}</div>
                    <div className="text-[10px] text-emerald-500 font-bold mt-1">{stats.active} hiệu lực</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">📋 HĐ Chính</div>
                    <div className="text-xl font-black text-blue-600">{fmt(stats.mainValue)}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">🏗️ Thầu phụ</div>
                    <div className="text-xl font-black text-orange-600">{fmt(stats.subValue)}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Chênh lệch</div>
                    <div className={`text-xl font-black ${stats.mainValue - stats.subValue >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {fmt(stats.mainValue - stats.subValue)}
                    </div>
                </div>
            </div>

            {/* Contract List */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                        <FileText size={16} className="text-blue-500" /> Danh sách hợp đồng
                    </h3>
                    <div className="flex items-center gap-2">
                        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
                            className="text-xs font-bold text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 bg-white outline-none">
                            <option value="all">Tất cả</option>
                            <option value="main">📋 HĐ Chính</option>
                            <option value="subcontract">🏗️ Thầu phụ</option>
                        </select>
                        <button onClick={() => { resetForm(); setShowForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all">
                            <Plus size={12} /> Thêm HĐ
                        </button>
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-sm font-bold text-slate-400">Chưa có hợp đồng nào</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {filtered.map(c => {
                            const stCfg = STATUS_CFG[c.status];
                            const tCfg = TYPE_CFG[c.type];
                            const isExpanded = expandedId === c.id;
                            return (
                                <div key={c.id}>
                                    <div className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/50 transition-colors group cursor-pointer"
                                        onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <span className="text-lg shrink-0">{tCfg.icon}</span>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-2">
                                                    {c.contractNumber}
                                                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                        {stCfg.icon} {stCfg.label}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-400 truncate">{c.partyName}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <div className="text-right hidden md:block">
                                                <div className="text-sm font-black text-slate-800">{fmt(c.value)}</div>
                                                <div className="text-[10px] text-slate-400">{c.signDate ? new Date(c.signDate).toLocaleDateString('vi-VN') : '—'}</div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={e => { e.stopPropagation(); openEdit(c); }}
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50"><Edit2 size={13} /></button>
                                                <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="px-5 pb-4 bg-slate-50/50 border-t border-slate-100">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-3 text-xs">
                                                <div><span className="text-slate-400 block">Loại</span><span className="font-bold">{tCfg.label}</span></div>
                                                <div><span className="text-slate-400 block">Thời hạn</span><span className="font-bold">{c.startDate ? `${new Date(c.startDate).toLocaleDateString('vi-VN')} → ${new Date(c.endDate).toLocaleDateString('vi-VN')}` : '—'}</span></div>
                                                <div><span className="text-slate-400 block">Điều khoản TT</span><span className="font-bold">{c.paymentTerms || '—'}</span></div>
                                                <div><span className="text-slate-400 block">Ghi chú</span><span className="font-bold">{c.note || '—'}</span></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Contract Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={resetForm}>
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editing ? <><Edit2 size={18} /> Sửa hợp đồng</> : <><Plus size={18} /> Thêm hợp đồng</>}
                            </span>
                            <button onClick={resetForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số hợp đồng</label>
                                    <input value={fNum} onChange={e => setFNum(e.target.value)} placeholder="VD: HĐ-2026/001"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại</label>
                                    <div className="flex gap-2">
                                        <button onClick={() => setFType('main')} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${fType === 'main' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>📋 HĐ Chính</button>
                                        <button onClick={() => setFType('subcontract')} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${fType === 'subcontract' ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-slate-200 text-slate-500'}`}>🏗️ Thầu phụ</button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đối tác</label>
                                    <input value={fParty} onChange={e => setFParty(e.target.value)} placeholder="Tên CĐT / Nhà thầu"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Giá trị (VNĐ)</label>
                                    <input type="number" value={fValue} onChange={e => setFValue(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày ký</label>
                                    <input type="date" value={fSignDate} onChange={e => setFSignDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Bắt đầu</label>
                                    <input type="date" value={fStartDate} onChange={e => setFStartDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Kết thúc</label>
                                    <input type="date" value={fEndDate} onChange={e => setFEndDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Trạng thái</label>
                                    <select value={fStatus} onChange={e => setFStatus(e.target.value as ContractStatus)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none">
                                        {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Điều khoản TT</label>
                                    <input value={fTerms} onChange={e => setFTerms(e.target.value)} placeholder="VD: Thanh toán 3 đợt"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={fNote} onChange={e => setFNote(e.target.value)} placeholder="Ghi chú thêm..."
                                    rows={2} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSave} disabled={!fNum || !fParty || !fValue}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editing ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ContractTab;
