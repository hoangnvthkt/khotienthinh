import React, { useState, useMemo, useEffect } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    Plus, Edit2, Trash2, X, Save, FileText,
    CheckCircle2, AlertCircle, Clock, Ban
} from 'lucide-react';
import { CustomerContract, SubcontractorContract, HdContractStatus } from '../../types';
import { customerContractService, subcontractorContractService } from '../../lib/hdService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface ContractTabProps {
    constructionSiteId: string;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN') + ' đ';
};

// Hợp nhất CustomerContract + SubcontractorContract thành view thống nhất
interface ContractView {
    id: string;
    code: string;
    partyName: string;
    type: 'customer' | 'subcontractor';
    value: number;
    signedDate?: string;
    effectiveDate?: string;
    endDate?: string;
    status: HdContractStatus;
    note?: string;
}

const STATUS_CFG: Record<HdContractStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft:       { label: 'Nháp',          color: 'text-slate-600',  bg: 'bg-slate-50 border-slate-200',   icon: <Clock size={12} /> },
    negotiating: { label: 'Đàm phán',      color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200',   icon: <AlertCircle size={12} /> },
    signed:      { label: 'Đã ký',         color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200',     icon: <CheckCircle2 size={12} /> },
    active:      { label: 'Hiệu lực',      color: 'text-emerald-600',bg: 'bg-emerald-50 border-emerald-200',icon: <CheckCircle2 size={12} /> },
    completed:   { label: 'Hoàn thành',    color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', icon: <CheckCircle2 size={12} /> },
    expired:     { label: 'Hết hạn',       color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', icon: <AlertCircle size={12} /> },
    cancelled:   { label: 'Huỷ bỏ',        color: 'text-red-600',    bg: 'bg-red-50 border-red-200',       icon: <Ban size={12} /> },
};

const TYPE_CFG = {
    customer:      { label: 'HĐ Khách hàng', icon: '📋', color: 'text-blue-600 bg-blue-50 border-blue-200' },
    subcontractor: { label: 'Thầu phụ',       icon: '🏗️', color: 'text-orange-600 bg-orange-50 border-orange-200' },
};

const ContractTab: React.FC<ContractTabProps> = ({ constructionSiteId }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const [customerContracts, setCustomerContracts] = useState<CustomerContract[]>([]);
    const [subContracts, setSubContracts] = useState<SubcontractorContract[]>([]);
    const [loading, setLoading] = useState(true);

    const loadContracts = async () => {
        setLoading(true);
        try {
            const [cust, sub] = await Promise.all([
                customerContractService.listBySite(constructionSiteId),
                subcontractorContractService.listBySite(constructionSiteId),
            ]);
            setCustomerContracts(cust);
            setSubContracts(sub);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadContracts(); }, [constructionSiteId]);

    // Unified view
    const contracts: ContractView[] = useMemo(() => [
        ...customerContracts.map(c => ({
            id: c.id, code: c.code, partyName: c.customerName,
            type: 'customer' as const, value: c.value,
            signedDate: c.signedDate, effectiveDate: c.effectiveDate,
            endDate: c.endDate, status: c.status, note: c.note,
        })),
        ...subContracts.map(c => ({
            id: c.id, code: c.code, partyName: c.subcontractorName,
            type: 'subcontractor' as const, value: c.value,
            signedDate: c.signedDate, effectiveDate: c.effectiveDate,
            endDate: c.completionDate, status: c.status, note: c.note,
        })),
    ].sort((a, b) => (b.signedDate || '').localeCompare(a.signedDate || '')), [customerContracts, subContracts]);

    const [filterType, setFilterType] = useState<'all' | 'customer' | 'subcontractor'>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Form state — chỉ thêm Contract mới redirect sang module HD
    // Việc edit/tạo mới → dùng module HD đầy đủ (có upload file, tax code...)
    const filtered = useMemo(() => {
        if (filterType === 'all') return contracts;
        return contracts.filter(c => c.type === filterType);
    }, [contracts, filterType]);

    const stats = useMemo(() => ({
        total: contracts.length,
        custValue: customerContracts.reduce((s, c) => s + c.value, 0),
        subValue: subContracts.reduce((s, c) => s + c.value, 0),
        active: contracts.filter(c => c.status === 'active' || c.status === 'signed').length,
    }), [contracts, customerContracts, subContracts]);

    const handleDelete = async (id: string, type: 'customer' | 'subcontractor') => {
        const c = contracts.find(x => x.id === id);
        const ok = await confirm({ targetName: c?.code || 'hợp đồng này', title: 'Xoá hợp đồng' });
        if (!ok) return;
        try {
            if (type === 'customer') await customerContractService.remove(id);
            else await subcontractorContractService.remove(id);
            await loadContracts();
            toast.success('Xoá hợp đồng thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    return (
        <div className="space-y-6">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Hợp đồng</h3>
                <AiInsightPanel module="contract" siteId={constructionSiteId} />
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tổng HĐ</div>
                    <div className="text-2xl font-black text-slate-800 dark:text-white">{stats.total}</div>
                    <div className="text-[10px] text-emerald-500 font-bold mt-1">{stats.active} hiệu lực</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">📋 HĐ Khách hàng</div>
                    <div className="text-xl font-black text-blue-600">{fmt(stats.custValue)}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">🏗️ Thầu phụ</div>
                    <div className="text-xl font-black text-orange-600">{fmt(stats.subValue)}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Chênh lệch</div>
                    <div className={`text-xl font-black ${stats.custValue - stats.subValue >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {fmt(stats.custValue - stats.subValue)}
                    </div>
                </div>
            </div>

            {/* Contract List */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
                        <FileText size={16} className="text-blue-500" /> Danh sách hợp đồng
                    </h3>
                    <div className="flex items-center gap-2">
                        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
                            className="text-xs font-bold text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 bg-white outline-none">
                            <option value="all">Tất cả</option>
                            <option value="customer">📋 HĐ Khách hàng</option>
                            <option value="subcontractor">🏗️ Thầu phụ</option>
                        </select>
                        <a href="#/hd/customer"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all">
                            <Plus size={12} /> Thêm HĐ
                        </a>
                    </div>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-sm text-slate-400 font-bold">Đang tải...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-sm font-bold text-slate-400">Chưa có hợp đồng nào</p>
                        <p className="text-xs text-slate-300 mt-1">Vào <strong>Module HD</strong> để thêm hợp đồng cho dự án này</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50 dark:divide-slate-700">
                        {filtered.map(c => {
                            const stCfg = STATUS_CFG[c.status];
                            const tCfg = TYPE_CFG[c.type];
                            const isExpanded = expandedId === c.id;
                            return (
                                <div key={c.id}>
                                    <div className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors group cursor-pointer"
                                        onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <span className="text-lg shrink-0">{tCfg.icon}</span>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-slate-800 dark:text-white truncate flex items-center gap-2">
                                                    {c.code}
                                                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                        {stCfg.icon} {stCfg.label}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-400 truncate">{c.partyName}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <div className="text-right hidden md:block">
                                                <div className="text-sm font-black text-slate-800 dark:text-white">{fmt(c.value)}</div>
                                                <div className="text-[10px] text-slate-400">{c.signedDate ? new Date(c.signedDate).toLocaleDateString('vi-VN') : '—'}</div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleDelete(c.id, c.type); }}
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="px-5 pb-4 bg-slate-50/50 dark:bg-slate-700/30 border-t border-slate-100 dark:border-slate-700">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-3 text-xs">
                                                <div><span className="text-slate-400 block">Loại</span><span className="font-bold">{tCfg.label}</span></div>
                                                <div><span className="text-slate-400 block">Hiệu lực</span><span className="font-bold">{c.effectiveDate ? new Date(c.effectiveDate).toLocaleDateString('vi-VN') : '—'}</span></div>
                                                <div><span className="text-slate-400 block">Kết thúc</span><span className="font-bold">{c.endDate ? new Date(c.endDate).toLocaleDateString('vi-VN') : '—'}</span></div>
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

            {/* Hint */}
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <FileText size={14} className="text-blue-500 shrink-0" />
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                    Quản lý chi tiết hợp đồng (upload file, điều khoản, bảo lãnh...) tại <strong>Module Hợp Đồng (HD)</strong>.
                    Nhớ chọn đúng <em>Dự án</em> khi tạo hợp đồng ở đó.
                </p>
            </div>
        </div>
    );
};

export default ContractTab;
