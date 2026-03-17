import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    Wrench, Plus, Search, Filter, Calendar, DollarSign, X, FileText,
    Upload, Download, CheckCircle, Clock, AlertTriangle, Paperclip,
    Eye, Trash2, FileSpreadsheet, Building2, Hash
} from 'lucide-react';
import { AssetMaintenance as MaintenanceType, MaintenanceAttachment, AssetStatus } from '../../types';
import * as XLSX from 'xlsx';

const TYPE_LABELS: Record<string, string> = { scheduled: 'Bảo trì định kỳ', repair: 'Sửa chữa', inspection: 'Kiểm tra' };
const STATUS_LABELS: Record<string, string> = { planned: 'Lên kế hoạch', in_progress: 'Đang thực hiện', completed: 'Hoàn thành' };

const AssetMaintenancePage: React.FC = () => {
    const { assets, assetMaintenances, users, user, addAssetMaintenance, updateAssetMaintenance } = useApp();
    const toast = useToast();

    const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'planned' | 'in_progress' | 'completed'>('all');
    const [filterType, setFilterType] = useState<'all' | 'scheduled' | 'repair' | 'inspection'>('all');
    const [viewDetail, setViewDetail] = useState<MaintenanceType | null>(null);

    // Create form state
    const [form, setForm] = useState({
        assetId: '', type: 'repair' as 'scheduled' | 'repair' | 'inspection',
        description: '', cost: 0, vendor: '', invoiceNumber: '',
        startDate: new Date().toISOString().split('T')[0], endDate: '',
        status: 'in_progress' as 'planned' | 'in_progress' | 'completed', note: '',
    });
    const [attachments, setAttachments] = useState<MaintenanceAttachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const excelInputRef = useRef<HTMLInputElement>(null);

    const resetForm = () => {
        setForm({
            assetId: '', type: 'repair', description: '', cost: 0, vendor: '', invoiceNumber: '',
            startDate: new Date().toISOString().split('T')[0], endDate: '',
            status: 'in_progress', note: '',
        });
        setAttachments([]);
    };

    // Stats
    const stats = useMemo(() => {
        const totalCost = assetMaintenances.reduce((sum, m) => sum + m.cost, 0);
        const inProgress = assetMaintenances.filter(m => m.status === 'in_progress').length;
        const completed = assetMaintenances.filter(m => m.status === 'completed').length;
        return { total: assetMaintenances.length, totalCost, inProgress, completed };
    }, [assetMaintenances]);

    // Filtered list
    const filteredList = useMemo(() => {
        return assetMaintenances.filter(m => {
            if (filterStatus !== 'all' && m.status !== filterStatus) return false;
            if (filterType !== 'all' && m.type !== filterType) return false;
            if (searchTerm) {
                const asset = assets.find(a => a.id === m.assetId);
                const q = searchTerm.toLowerCase();
                if (!m.description.toLowerCase().includes(q) &&
                    !(asset?.name || '').toLowerCase().includes(q) &&
                    !(asset?.code || '').toLowerCase().includes(q) &&
                    !(m.vendor || '').toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }, [assetMaintenances, filterStatus, filterType, searchTerm, assets]);

    const getAsset = (id: string) => assets.find(a => a.id === id);

    // Handle file attachment
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                const att: MaintenanceAttachment = {
                    id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                    name: file.name, url: reader.result as string,
                    type: file.type, size: file.size,
                    uploadedAt: new Date().toISOString(),
                };
                setAttachments(prev => [...prev, att]);
            };
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

    // Save maintenance
    const handleSave = () => {
        if (!form.assetId || !form.description.trim()) {
            toast.error('Lỗi', 'Vui lòng chọn tài sản và nhập mô tả');
            return;
        }
        const m: MaintenanceType = {
            id: `mt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            assetId: form.assetId, type: form.type, description: form.description,
            cost: Number(form.cost), vendor: form.vendor || undefined,
            invoiceNumber: form.invoiceNumber || undefined,
            startDate: form.startDate, endDate: form.endDate || undefined,
            status: form.status, performedBy: user.id, performedByName: user.name,
            note: form.note || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
        };
        addAssetMaintenance(m);
        const asset = getAsset(form.assetId);
        toast.success('Thành công', `Đã ghi nhận bảo trì cho ${asset?.name || form.assetId}`);
        resetForm();
        setActiveTab('list');
    };

    // Import Excel
    const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const wb = XLSX.read(evt.target?.result, { type: 'binary' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json<any>(ws);
                let imported = 0;
                data.forEach((row: any) => {
                    const assetCode = String(row['Mã TS'] || row['ma_ts'] || '').trim();
                    const asset = assets.find(a => a.code === assetCode);
                    if (!asset) return;
                    const m: MaintenanceType = {
                        id: `mt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${imported}`,
                        assetId: asset.id,
                        type: (row['Loại'] || row['type'] || 'repair').toLowerCase().includes('định kỳ') ? 'scheduled' : (row['Loại'] || row['type'] || '').toLowerCase().includes('kiểm tra') ? 'inspection' : 'repair',
                        description: String(row['Mô tả'] || row['description'] || 'Bảo trì nhập từ Excel'),
                        cost: Number(row['Chi phí'] || row['cost'] || 0),
                        vendor: String(row['Đơn vị'] || row['vendor'] || ''),
                        invoiceNumber: String(row['Số HĐ'] || row['invoice'] || ''),
                        startDate: row['Ngày'] || row['date'] || new Date().toISOString().split('T')[0],
                        status: 'completed',
                        performedBy: user.id, performedByName: user.name,
                        note: String(row['Ghi chú'] || row['note'] || ''),
                    };
                    addAssetMaintenance(m);
                    imported++;
                });
                toast.success('Import thành công', `Đã nhập ${imported} bản ghi bảo trì`);
            } catch {
                toast.error('Lỗi import', 'File Excel không hợp lệ');
            }
        };
        reader.readAsBinaryString(file);
        if (excelInputRef.current) excelInputRef.current.value = '';
    };

    // Update status
    const handleComplete = (m: MaintenanceType) => {
        updateAssetMaintenance({ ...m, status: 'completed', endDate: new Date().toISOString().split('T')[0] });
        toast.success('Hoàn thành', 'Đã cập nhật trạng thái bảo trì');
    };

    const formatCurrency = (v: number) => v.toLocaleString('vi-VN') + 'đ';
    const formatFileSize = (bytes: number) => bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <Wrench className="text-orange-500" size={24} /> Bảo trì / Sửa chữa
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Quản lý bảo trì, sửa chữa tài sản với chi phí, hoá đơn đính kèm</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => excelInputRef.current?.click()}
                        className="px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 text-xs font-black uppercase flex items-center gap-1.5 hover:bg-emerald-100 transition-colors">
                        <FileSpreadsheet size={14} /> Import Excel
                    </button>
                    <input ref={excelInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelImport} />
                    <button onClick={() => { resetForm(); setActiveTab('create'); }}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-black uppercase flex items-center gap-1.5 shadow-lg shadow-orange-500/20">
                        <Plus size={14} /> Tạo mới
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center"><Wrench size={18} className="text-orange-500" /></div>
                        <div><p className="text-[10px] text-slate-400 font-bold uppercase">Tổng lần BT</p><p className="text-xl font-black text-orange-600">{stats.total}</p></div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center"><DollarSign size={18} className="text-red-500" /></div>
                        <div><p className="text-[10px] text-slate-400 font-bold uppercase">Tổng chi phí</p><p className="text-xl font-black text-red-600">{formatCurrency(stats.totalCost)}</p></div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center"><Clock size={18} className="text-amber-500" /></div>
                        <div><p className="text-[10px] text-slate-400 font-bold uppercase">Đang BT</p><p className="text-xl font-black text-amber-600">{stats.inProgress}</p></div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center"><CheckCircle size={18} className="text-emerald-500" /></div>
                        <div><p className="text-[10px] text-slate-400 font-bold uppercase">Hoàn thành</p><p className="text-xl font-black text-emerald-600">{stats.completed}</p></div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm w-fit">
                <button onClick={() => setActiveTab('list')}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'list' ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-orange-500'}`}>
                    <Wrench size={13} className="inline mr-1.5" /> Danh sách
                </button>
                <button onClick={() => setActiveTab('create')}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'create' ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-orange-500'}`}>
                    <Plus size={13} className="inline mr-1.5" /> Tạo mới
                </button>
            </div>

            {/* ==================== LIST TAB ==================== */}
            {activeTab === 'list' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" placeholder="Tìm tài sản, mô tả, đơn vị..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 font-medium" />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(['all', 'planned', 'in_progress', 'completed'] as const).map(s => (
                                <button key={s} onClick={() => setFilterStatus(s)}
                                    className={`px-3 py-2 rounded-lg text-[10px] font-bold ${filterStatus === s ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                                    {s === 'all' ? 'Tất cả' : STATUS_LABELS[s]}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(['all', 'scheduled', 'repair', 'inspection'] as const).map(t => (
                                <button key={t} onClick={() => setFilterType(t)}
                                    className={`px-3 py-2 rounded-lg text-[10px] font-bold ${filterType === t ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                                    {t === 'all' ? 'Tất cả loại' : TYPE_LABELS[t]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-800">
                                        <th className="text-left p-4 text-[10px] font-black text-slate-400 uppercase">Tài sản</th>
                                        <th className="text-left p-4 text-[10px] font-black text-slate-400 uppercase">Loại</th>
                                        <th className="text-left p-4 text-[10px] font-black text-slate-400 uppercase">Mô tả</th>
                                        <th className="text-right p-4 text-[10px] font-black text-slate-400 uppercase">Chi phí</th>
                                        <th className="text-left p-4 text-[10px] font-black text-slate-400 uppercase">Đơn vị</th>
                                        <th className="text-left p-4 text-[10px] font-black text-slate-400 uppercase">Ngày</th>
                                        <th className="text-center p-4 text-[10px] font-black text-slate-400 uppercase">Trạng thái</th>
                                        <th className="text-center p-4 text-[10px] font-black text-slate-400 uppercase">Đính kèm</th>
                                        <th className="text-center p-4 text-[10px] font-black text-slate-400 uppercase"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filteredList.length === 0 ? (
                                        <tr><td colSpan={9} className="p-12 text-center text-slate-300">
                                            <Wrench size={40} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                            <p className="font-bold">Chưa có bản ghi bảo trì</p>
                                        </td></tr>
                                    ) : (
                                        filteredList.map(m => {
                                            const asset = getAsset(m.assetId);
                                            return (
                                                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                    <td className="p-4">
                                                        <div className="text-[10px] font-mono text-slate-400">{asset?.code}</div>
                                                        <div className="font-bold text-slate-800 dark:text-white text-sm">{asset?.name || m.assetId}</div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${m.type === 'repair' ? 'bg-red-100 text-red-600 dark:bg-red-950/40' : m.type === 'inspection' ? 'bg-blue-100 text-blue-600 dark:bg-blue-950/40' : 'bg-orange-100 text-orange-600 dark:bg-orange-950/40'}`}>
                                                            {TYPE_LABELS[m.type]}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 max-w-[200px]">
                                                        <div className="text-sm text-slate-700 dark:text-slate-300 truncate">{m.description}</div>
                                                        {m.invoiceNumber && <div className="text-[9px] text-slate-400">HĐ: {m.invoiceNumber}</div>}
                                                    </td>
                                                    <td className="p-4 text-right font-black text-red-600">{formatCurrency(m.cost)}</td>
                                                    <td className="p-4 text-xs text-slate-500">{m.vendor || '—'}</td>
                                                    <td className="p-4 text-xs text-slate-500">{new Date(m.startDate).toLocaleDateString('vi-VN')}</td>
                                                    <td className="p-4 text-center">
                                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${m.status === 'completed' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40' : m.status === 'in_progress' ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/40' : 'bg-slate-100 text-slate-500'}`}>
                                                            {STATUS_LABELS[m.status]}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        {(m.attachments?.length || 0) > 0 && (
                                                            <span className="text-[9px] font-bold text-blue-500 flex items-center justify-center gap-0.5"><Paperclip size={10} />{m.attachments!.length}</span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center gap-1 justify-center">
                                                            <button onClick={() => setViewDetail(m)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500"><Eye size={14} /></button>
                                                            {m.status !== 'completed' && (
                                                                <button onClick={() => handleComplete(m)} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/20 text-slate-400 hover:text-emerald-500" title="Đánh dấu hoàn thành"><CheckCircle size={14} /></button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== CREATE TAB ==================== */}
            {activeTab === 'create' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2"><Plus size={16} className="text-orange-500" /> Tạo bản ghi bảo trì / sửa chữa</h3>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left column */}
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Tài sản *</label>
                                <select value={form.assetId} onChange={e => setForm(f => ({ ...f, assetId: e.target.value }))}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500">
                                    <option value="">Chọn tài sản...</option>
                                    {assets.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Loại *</label>
                                    <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="repair">Sửa chữa</option>
                                        <option value="scheduled">Bảo trì định kỳ</option>
                                        <option value="inspection">Kiểm tra</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Trạng thái</label>
                                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="planned">Lên kế hoạch</option>
                                        <option value="in_progress">Đang thực hiện</option>
                                        <option value="completed">Hoàn thành</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mô tả *</label>
                                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                                    placeholder="Mô tả nội dung bảo trì / sửa chữa..." />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ngày bắt đầu</label>
                                    <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 font-bold" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ngày kết thúc</label>
                                    <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 font-bold" />
                                </div>
                            </div>
                        </div>

                        {/* Right column */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Chi phí (VNĐ)</label>
                                    <input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 font-bold" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Số hoá đơn</label>
                                    <input type="text" value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                                        placeholder="VD: HD-2026-001"
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 font-bold" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Đơn vị sửa chữa / Nhà cung cấp</label>
                                <input type="text" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                                    placeholder="VD: Cty TNHH ABC"
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 font-bold" />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                                    placeholder="Ghi chú thêm..." />
                            </div>

                            {/* Attachments */}
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Hoá đơn / Chứng từ đính kèm</label>
                                <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={handleFileUpload} />
                                <button onClick={() => fileInputRef.current?.click()}
                                    className="w-full p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-center hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/10 transition-colors group">
                                    <Upload size={20} className="mx-auto text-slate-300 group-hover:text-orange-400 mb-1" />
                                    <p className="text-xs font-bold text-slate-400 group-hover:text-orange-500">Kéo thả hoặc click để tải lên</p>
                                    <p className="text-[9px] text-slate-300">Hình ảnh, PDF, Word, Excel</p>
                                </button>
                                {attachments.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {attachments.map(att => (
                                            <div key={att.id} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded-xl">
                                                <Paperclip size={12} className="text-blue-500 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{att.name}</p>
                                                    <p className="text-[9px] text-slate-400">{formatFileSize(att.size)}</p>
                                                </div>
                                                <button onClick={() => removeAttachment(att.id)} className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                        <button onClick={() => setActiveTab('list')} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-bold text-sm">Hủy</button>
                        <button onClick={handleSave} disabled={!form.assetId || !form.description.trim()}
                            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-sm shadow-lg shadow-orange-500/20 disabled:opacity-50">
                            <CheckCircle size={14} className="inline mr-1.5" /> Lưu bản ghi
                        </button>
                    </div>
                </div>
            )}

            {/* ===================== DETAIL MODAL ===================== */}
            {viewDetail && (() => {
                const asset = getAsset(viewDetail.assetId);
                return (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setViewDetail(null)}>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                <div>
                                    <p className="text-[10px] font-mono text-slate-400">{asset?.code}</p>
                                    <h3 className="text-lg font-black text-slate-800 dark:text-white">Chi tiết bảo trì</h3>
                                </div>
                                <button onClick={() => setViewDetail(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-400 font-bold uppercase">Tài sản</p>
                                        <p className="text-sm font-black text-slate-800 dark:text-white">{asset?.name}</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-400 font-bold uppercase">Loại</p>
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">{TYPE_LABELS[viewDetail.type]}</p>
                                    </div>
                                    <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-xl border border-red-100 dark:border-red-900/30">
                                        <p className="text-[9px] text-red-400 font-bold uppercase">Chi phí</p>
                                        <p className="text-sm font-black text-red-600">{formatCurrency(viewDetail.cost)}</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-400 font-bold uppercase">Trạng thái</p>
                                        <p className="text-sm font-bold">{STATUS_LABELS[viewDetail.status]}</p>
                                    </div>
                                </div>
                                {viewDetail.vendor && (
                                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl flex items-center gap-2">
                                        <Building2 size={14} className="text-slate-400" />
                                        <div>
                                            <p className="text-[9px] text-slate-400 font-bold uppercase">Đơn vị sửa chữa</p>
                                            <p className="text-sm font-bold">{viewDetail.vendor}</p>
                                        </div>
                                    </div>
                                )}
                                {viewDetail.invoiceNumber && (
                                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl flex items-center gap-2">
                                        <Hash size={14} className="text-slate-400" />
                                        <div>
                                            <p className="text-[9px] text-slate-400 font-bold uppercase">Số hoá đơn</p>
                                            <p className="text-sm font-bold font-mono">{viewDetail.invoiceNumber}</p>
                                        </div>
                                    </div>
                                )}
                                <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Mô tả</p><p className="text-sm text-slate-700 dark:text-slate-300">{viewDetail.description}</p></div>
                                <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                                    <div>📅 Bắt đầu: <span className="font-bold">{new Date(viewDetail.startDate).toLocaleDateString('vi-VN')}</span></div>
                                    {viewDetail.endDate && <div>📅 Kết thúc: <span className="font-bold">{new Date(viewDetail.endDate).toLocaleDateString('vi-VN')}</span></div>}
                                </div>
                                {viewDetail.note && <div className="text-xs text-slate-400 italic">Ghi chú: {viewDetail.note}</div>}
                                {/* Attachments */}
                                {viewDetail.attachments && viewDetail.attachments.length > 0 && (
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">Hoá đơn / Chứng từ</p>
                                        <div className="space-y-2">
                                            {viewDetail.attachments.map(att => (
                                                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"
                                                    className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/20 p-2 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/20 transition-colors border border-blue-100 dark:border-blue-900/30">
                                                    {att.type.startsWith('image/') ? (
                                                        <img src={att.url} alt={att.name} className="w-10 h-10 rounded-lg object-cover" />
                                                    ) : (
                                                        <FileText size={16} className="text-blue-500 shrink-0" />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold text-blue-700 dark:text-blue-400 truncate">{att.name}</p>
                                                        <p className="text-[9px] text-blue-400">{formatFileSize(att.size)}</p>
                                                    </div>
                                                    <Download size={12} className="text-blue-400" />
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default AssetMaintenancePage;
