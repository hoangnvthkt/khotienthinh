import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    Search, Plus, Filter, Trash2, Edit3, MoreHorizontal, QrCode,
    Landmark, Tag, Calendar, DollarSign, MapPin, User, X, Check,
    AlertTriangle, CheckCircle, Wrench, Ban, Package
} from 'lucide-react';
import { Asset, AssetStatus, ASSET_STATUS_LABELS, ASSET_CATEGORY_LABELS, AssetCategoryType } from '../../types';
import ScannerModal from '../../components/ScannerModal';

const AssetCatalog: React.FC = () => {
    const {
        assets, assetCategories, warehouses, users, user,
        addAsset, updateAsset, removeAsset,
        addAssetCategory, updateAssetCategory, removeAssetCategory,
    } = useApp();
    const toast = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [isScannerOpen, setScannerOpen] = useState(false);

    // Form state
    const [form, setForm] = useState({
        code: '', name: '', categoryId: '', brand: '', model: '', serialNumber: '',
        originalValue: 0, purchaseDate: new Date().toISOString().split('T')[0],
        depreciationYears: 5, residualValue: 0, warehouseId: '', locationNote: '', note: '',
    });

    const resetForm = () => {
        setForm({
            code: '', name: '', categoryId: assetCategories[0]?.id || '', brand: '', model: '', serialNumber: '',
            originalValue: 0, purchaseDate: new Date().toISOString().split('T')[0],
            depreciationYears: 5, residualValue: 0, warehouseId: '', locationNote: '', note: '',
        });
    };

    const openAdd = () => {
        resetForm();
        const nextCode = `TS-${String(assets.length + 1).padStart(3, '0')}`;
        setForm(prev => ({ ...prev, code: nextCode, categoryId: assetCategories[0]?.id || '' }));
        setEditingAsset(null);
        setShowAddModal(true);
    };

    const openEdit = (asset: Asset) => {
        setForm({
            code: asset.code, name: asset.name, categoryId: asset.categoryId,
            brand: asset.brand || '', model: asset.model || '', serialNumber: asset.serialNumber || '',
            originalValue: asset.originalValue, purchaseDate: asset.purchaseDate.split('T')[0],
            depreciationYears: asset.depreciationYears, residualValue: asset.residualValue,
            warehouseId: asset.warehouseId || '', locationNote: asset.locationNote || '', note: asset.note || '',
        });
        setEditingAsset(asset);
        setShowAddModal(true);
    };

    const handleSave = () => {
        if (!form.name.trim() || !form.code.trim()) {
            toast.error('Lỗi', 'Vui lòng nhập mã tài sản và tên tài sản');
            return;
        }
        const now = new Date().toISOString();
        if (editingAsset) {
            updateAsset({
                ...editingAsset, ...form,
                originalValue: Number(form.originalValue),
                depreciationYears: Number(form.depreciationYears),
                residualValue: Number(form.residualValue),
                updatedAt: now,
            });
            toast.success('Cập nhật thành công', `Tài sản ${form.name} đã được cập nhật`);
        } else {
            addAsset({
                id: `ast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                ...form,
                originalValue: Number(form.originalValue),
                depreciationYears: Number(form.depreciationYears),
                residualValue: Number(form.residualValue),
                status: AssetStatus.AVAILABLE,
                createdAt: now,
                updatedAt: now,
            });
            toast.success('Thêm thành công', `Tài sản ${form.name} đã được thêm vào danh mục`);
        }
        setShowAddModal(false);
    };

    const handleDelete = (id: string) => {
        removeAsset(id);
        setDeleteConfirm(null);
        toast.success('Đã xóa', 'Tài sản đã được xóa khỏi danh mục');
    };

    const handleScanResult = (code: string) => {
        setSearchTerm(code);
    };

    const filteredAssets = useMemo(() => {
        return assets.filter(a => {
            const matchSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                a.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (a.serialNumber || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchCat = filterCategory === 'all' || a.categoryId === filterCategory;
            const matchStatus = filterStatus === 'all' || a.status === filterStatus;
            return matchSearch && matchCat && matchStatus;
        });
    }, [assets, searchTerm, filterCategory, filterStatus]);

    const getStatusConfig = (status: AssetStatus) => {
        switch (status) {
            case AssetStatus.AVAILABLE: return { color: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: CheckCircle };
            case AssetStatus.IN_USE: return { color: 'bg-blue-50 text-blue-600 border-blue-100', icon: User };
            case AssetStatus.MAINTENANCE: return { color: 'bg-amber-50 text-amber-600 border-amber-100', icon: Wrench };
            case AssetStatus.BROKEN: return { color: 'bg-red-50 text-red-600 border-red-100', icon: AlertTriangle };
            case AssetStatus.DISPOSED: return { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Ban };
        }
    };

    const getDepreciation = (asset: Asset) => {
        const purchaseDate = new Date(asset.purchaseDate);
        const now = new Date();
        const monthsUsed = Math.max(0, (now.getFullYear() - purchaseDate.getFullYear()) * 12 + (now.getMonth() - purchaseDate.getMonth()));
        const totalMonths = asset.depreciationYears * 12;
        const depreciable = asset.originalValue - asset.residualValue;
        const monthlyDep = depreciable / totalMonths;
        const accumulated = Math.min(depreciable, monthlyDep * monthsUsed);
        const remaining = asset.originalValue - accumulated;
        const percentUsed = Math.min(100, (monthsUsed / totalMonths) * 100);
        return { accumulated, remaining, percentUsed, monthsUsed };
    };

    const totalValue = assets.reduce((sum, a) => sum + a.originalValue, 0);
    const totalRemaining = assets.reduce((sum, a) => sum + getDepreciation(a).remaining, 0);
    const inUseCount = assets.filter(a => a.status === AssetStatus.IN_USE).length;
    const availableCount = assets.filter(a => a.status === AssetStatus.AVAILABLE).length;

    const getCategoryName = (catId: string) => assetCategories.find(c => c.id === catId)?.name || 'Chưa phân loại';

    return (
        <div className="space-y-6">
            <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScanResult} />

            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <Landmark className="text-rose-500" size={24} /> Danh mục Tài sản
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Quản lý tài sản cố định của doanh nghiệp</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => setScannerOpen(true)} className="flex items-center px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-xl hover:bg-slate-700 transition text-[10px] font-black uppercase tracking-widest">
                        <QrCode className="w-4 h-4 mr-2" /> Quét QR
                    </button>
                    <button onClick={openAdd} className="flex items-center px-6 py-2 bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-xl hover:shadow-lg transition text-[10px] font-black uppercase tracking-widest shadow-lg shadow-rose-500/20">
                        <Plus className="w-4 h-4 mr-2" /> Thêm tài sản
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center"><Landmark size={18} className="text-rose-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Tổng tài sản</p>
                            <p className="text-xl font-black text-slate-800 dark:text-white">{assets.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center"><User size={18} className="text-blue-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Đang sử dụng</p>
                            <p className="text-xl font-black text-blue-600">{inUseCount} <span className="text-xs text-slate-400 font-medium">/ {availableCount} sẵn sàng</span></p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center"><DollarSign size={18} className="text-emerald-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Nguyên giá</p>
                            <p className="text-lg font-black text-slate-800 dark:text-white">{(totalValue / 1e6).toFixed(1)}M</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center"><Calendar size={18} className="text-amber-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Giá trị còn lại</p>
                            <p className="text-lg font-black text-amber-600">{(totalRemaining / 1e6).toFixed(1)}M</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input type="text" placeholder="Tìm theo tên, mã TS, serial..."
                        className="w-full pl-10 pr-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-rose-500 font-medium bg-slate-50/50 dark:bg-slate-800"
                        value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                    className="px-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold uppercase tracking-tighter">
                    <option value="all">Tất cả loại</option>
                    {assetCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="px-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold uppercase tracking-tighter">
                    <option value="all">Tất cả trạng thái</option>
                    {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
            </div>

            {/* Asset Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                                <th className="p-4">Mã TS</th>
                                <th className="p-4">Tên tài sản</th>
                                <th className="p-4">Loại</th>
                                <th className="p-4 text-right">Nguyên giá</th>
                                <th className="p-4 text-right">Còn lại</th>
                                <th className="p-4 text-center">Trạng thái</th>
                                <th className="p-4">Người sử dụng</th>
                                <th className="p-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                            {filteredAssets.map(asset => {
                                const cfg = getStatusConfig(asset.status);
                                const StatusIcon = cfg.icon;
                                const dep = getDepreciation(asset);
                                return (
                                    <tr key={asset.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                        <td className="p-4 font-mono text-slate-400 font-bold text-xs">{asset.code}</td>
                                        <td className="p-4 cursor-pointer hover:text-rose-500" onClick={() => setDetailAsset(asset)}>
                                            <div className="font-black text-slate-800 dark:text-white truncate max-w-[200px]">{asset.name}</div>
                                            {asset.brand && <div className="text-[10px] text-slate-400">{asset.brand} {asset.model || ''}</div>}
                                        </td>
                                        <td className="p-4 text-slate-500 font-medium text-xs">{getCategoryName(asset.categoryId)}</td>
                                        <td className="p-4 text-right font-black text-slate-800 dark:text-white">{asset.originalValue.toLocaleString('vi-VN')}đ</td>
                                        <td className="p-4 text-right">
                                            <div className="font-bold text-slate-700 dark:text-slate-300">{Math.round(dep.remaining).toLocaleString('vi-VN')}đ</div>
                                            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 mt-1">
                                                <div className="h-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500" style={{ width: `${100 - dep.percentUsed}%` }} />
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase border ${cfg.color}`}>
                                                <StatusIcon size={10} /> {ASSET_STATUS_LABELS[asset.status]}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs text-slate-500">{asset.assignedToName || <span className="text-slate-300 italic">—</span>}</td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => openEdit(asset)} className="p-2 text-slate-300 hover:text-blue-600 transition-colors"><Edit3 size={14} /></button>
                                                {deleteConfirm === asset.id ? (
                                                    <div className="flex gap-1">
                                                        <button onClick={() => handleDelete(asset.id)} className="p-1.5 bg-red-500 text-white rounded-lg text-[9px] font-bold">Xóa</button>
                                                        <button onClick={() => setDeleteConfirm(null)} className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg text-[9px] font-bold">Hủy</button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setDeleteConfirm(asset.id)} className="p-2 text-slate-300 hover:text-red-600 transition-colors"><Trash2 size={14} /></button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredAssets.map(asset => {
                        const cfg = getStatusConfig(asset.status);
                        const StatusIcon = cfg.icon;
                        return (
                            <div key={asset.id} className="p-4 space-y-2" onClick={() => setDetailAsset(asset)}>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="text-[10px] font-mono text-slate-400 font-bold">{asset.code}</div>
                                        <div className="font-black text-slate-800 dark:text-white text-sm">{asset.name}</div>
                                    </div>
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase border ${cfg.color}`}>
                                        <StatusIcon size={10} /> {ASSET_STATUS_LABELS[asset.status]}
                                    </span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">{getCategoryName(asset.categoryId)}</span>
                                    <span className="font-black text-slate-800 dark:text-white">{asset.originalValue.toLocaleString('vi-VN')}đ</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {filteredAssets.length === 0 && (
                    <div className="p-20 text-center">
                        <Landmark size={48} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                        <p className="text-slate-400 font-bold">Chưa có tài sản nào</p>
                        <p className="text-sm text-slate-300 mt-1">Nhấn "Thêm tài sản" để bắt đầu</p>
                    </div>
                )}
            </div>

            {/* ===================== ADD/EDIT MODAL ===================== */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">{editingAsset ? 'Cập nhật tài sản' : 'Thêm tài sản mới'}</h3>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mã tài sản *</label>
                                    <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-mono font-bold outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Loại tài sản</label>
                                    <select value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-rose-500">
                                        {assetCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Tên tài sản *</label>
                                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-rose-500"
                                    placeholder="VD: Máy xúc CAT 320D2" />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Nhãn hiệu</label>
                                    <input value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" placeholder="CAT" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Model</label>
                                    <input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" placeholder="320D2" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Số Serial</label>
                                    <input value={form.serialNumber} onChange={e => setForm(p => ({ ...p, serialNumber: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-mono outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Nguyên giá (VNĐ)</label>
                                    <input type="number" value={form.originalValue} onChange={e => setForm(p => ({ ...p, originalValue: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-black outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ngày mua</label>
                                    <input type="date" value={form.purchaseDate} onChange={e => setForm(p => ({ ...p, purchaseDate: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Thời gian khấu hao (năm)</label>
                                    <input type="number" value={form.depreciationYears} onChange={e => setForm(p => ({ ...p, depreciationYears: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Giá trị thanh lý dự kiến</label>
                                    <input type="number" value={form.residualValue} onChange={e => setForm(p => ({ ...p, residualValue: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Kho lưu trữ</label>
                                    <select value={form.warehouseId} onChange={e => setForm(p => ({ ...p, warehouseId: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500">
                                        <option value="">Không chỉ định</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Vị trí chi tiết</label>
                                    <input value={form.locationNote} onChange={e => setForm(p => ({ ...p, locationNote: e.target.value }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" placeholder="Khu A, Bãi xe" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} rows={2}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500 resize-none" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setShowAddModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Hủy</button>
                            <button onClick={handleSave} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white font-bold text-sm shadow-lg shadow-rose-500/20 hover:shadow-xl transition-all">
                                {editingAsset ? 'Cập nhật' : 'Thêm tài sản'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===================== DETAIL MODAL ===================== */}
            {detailAsset && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setDetailAsset(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-[10px] font-mono text-slate-400 font-bold">{detailAsset.code}</span>
                                    <h3 className="text-lg font-black text-slate-800 dark:text-white">{detailAsset.name}</h3>
                                </div>
                                <button onClick={() => setDetailAsset(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            {(() => {
                                const dep = getDepreciation(detailAsset);
                                const cfg = getStatusConfig(detailAsset.status);
                                const StatusIcon = cfg.icon;
                                return (
                                    <>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black uppercase border ${cfg.color}`}>
                                                <StatusIcon size={12} /> {ASSET_STATUS_LABELS[detailAsset.status]}
                                            </span>
                                            <span className="text-xs text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1 rounded-lg font-bold">{getCategoryName(detailAsset.categoryId)}</span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {detailAsset.brand && (
                                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                    <p className="text-[9px] text-slate-400 font-bold uppercase">Nhãn hiệu</p>
                                                    <p className="text-sm font-bold text-slate-800 dark:text-white">{detailAsset.brand} {detailAsset.model || ''}</p>
                                                </div>
                                            )}
                                            {detailAsset.serialNumber && (
                                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                    <p className="text-[9px] text-slate-400 font-bold uppercase">Serial Number</p>
                                                    <p className="text-sm font-mono font-bold text-slate-800 dark:text-white">{detailAsset.serialNumber}</p>
                                                </div>
                                            )}
                                            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                <p className="text-[9px] text-slate-400 font-bold uppercase">Nguyên giá</p>
                                                <p className="text-sm font-black text-slate-800 dark:text-white">{detailAsset.originalValue.toLocaleString('vi-VN')}đ</p>
                                            </div>
                                            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                <p className="text-[9px] text-slate-400 font-bold uppercase">Ngày mua</p>
                                                <p className="text-sm font-bold text-slate-800 dark:text-white">{new Date(detailAsset.purchaseDate).toLocaleDateString('vi-VN')}</p>
                                            </div>
                                        </div>

                                        <div className="bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20 p-4 rounded-xl border border-rose-100 dark:border-rose-900/30">
                                            <p className="text-[10px] text-rose-500 font-black uppercase mb-2">Khấu hao</p>
                                            <div className="flex justify-between text-sm mb-2">
                                                <span className="text-slate-500">Đã khấu hao ({dep.monthsUsed} tháng)</span>
                                                <span className="font-black text-rose-600">{Math.round(dep.accumulated).toLocaleString('vi-VN')}đ</span>
                                            </div>
                                            <div className="w-full bg-white dark:bg-slate-800 rounded-full h-3">
                                                <div className="h-3 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all" style={{ width: `${dep.percentUsed}%` }} />
                                            </div>
                                            <div className="flex justify-between text-xs mt-2">
                                                <span className="text-slate-400">{dep.percentUsed.toFixed(1)}% đã khấu hao</span>
                                                <span className="font-black text-emerald-600">Còn lại: {Math.round(dep.remaining).toLocaleString('vi-VN')}đ</span>
                                            </div>
                                        </div>

                                        {detailAsset.assignedToName && (
                                            <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-center gap-3">
                                                <User size={16} className="text-blue-500" />
                                                <div>
                                                    <p className="text-[9px] text-blue-400 font-bold uppercase">Đang được sử dụng bởi</p>
                                                    <p className="text-sm font-black text-blue-600">{detailAsset.assignedToName}</p>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button onClick={() => { setDetailAsset(null); openEdit(detailAsset); }}
                                className="px-4 py-2 rounded-xl bg-blue-500 text-white font-bold text-xs hover:bg-blue-600 transition-colors flex items-center gap-2">
                                <Edit3 size={13} /> Chỉnh sửa
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetCatalog;
