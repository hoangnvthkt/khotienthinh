import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useToast } from '../../context/ToastContext';
import {
    Search, Plus, Filter, Trash2, Edit3, MoreHorizontal, QrCode,
    Landmark, Tag, Calendar, DollarSign, MapPin, User, X, Check,
    AlertTriangle, CheckCircle, Wrench, Ban, Package, Shield, XCircle, FileWarning,
    Upload, Download, FileSpreadsheet, Table2, CheckCircle2, Loader2
} from 'lucide-react';
import { Asset, AssetStatus, ASSET_STATUS_LABELS, ASSET_CATEGORY_LABELS, AssetCategoryType } from '../../types';
import ScannerModal from '../../components/ScannerModal';
import * as XLSX from 'xlsx';
import { usePermission } from '../../hooks/usePermission';

const AssetCatalog: React.FC = () => {
    const navigate = useNavigate();
    const {
        assets, assetCategories, warehouses, users, user,
        addAsset, updateAsset, removeAsset,
        addAssetCategory, updateAssetCategory, removeAssetCategory,
    } = useApp();
  useModuleData('ts');
    const toast = useToast();
    const { canManage } = usePermission();
    const canCRUD = canManage('/ts/catalog');

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [disposeConfirm, setDisposeConfirm] = useState<Asset | null>(null);
    const [disposeReason, setDisposeReason] = useState('');
    const [isScannerOpen, setScannerOpen] = useState(false);

    // Excel Import state
    const [showImportModal, setShowImportModal] = useState(false);
    const [importRows, setImportRows] = useState<Array<Record<string, any>>>([]);
    const [importErrors, setImportErrors] = useState<Record<number, string>>({});
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form state
    const [form, setForm] = useState({
        code: '', name: '', categoryId: '', brand: '', model: '', serialNumber: '',
        originalValue: 0, purchaseDate: new Date().toISOString().split('T')[0],
        depreciationYears: 5, warrantyMonths: 12, residualValue: 0, warehouseId: '', locationNote: '', note: '',
    });

    const resetForm = () => {
        setForm({
            code: '', name: '', categoryId: assetCategories[0]?.id || '', brand: '', model: '', serialNumber: '',
            originalValue: 0, purchaseDate: new Date().toISOString().split('T')[0],
            depreciationYears: 5, warrantyMonths: 12, residualValue: 0, warehouseId: '', locationNote: '', note: '',
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
            depreciationYears: asset.depreciationYears, warrantyMonths: asset.warrantyMonths || 0, residualValue: asset.residualValue,
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
                warrantyMonths: Number(form.warrantyMonths),
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
                warrantyMonths: Number(form.warrantyMonths),
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

    const handleDispose = () => {
        if (!disposeConfirm) return;
        updateAsset({
            ...disposeConfirm,
            status: AssetStatus.DISPOSED,
            assignedToUserId: undefined,
            assignedToName: undefined,
            assignedDate: undefined,
            note: `${disposeConfirm.note ? disposeConfirm.note + '\n' : ''}[XUẤT HUỶ ${new Date().toLocaleDateString('vi-VN')}] ${disposeReason}`.trim(),
            updatedAt: new Date().toISOString(),
        });
        toast.success('Xuất huỷ thành công', `Tài sản ${disposeConfirm.name} đã được xuất huỷ. Lịch sử vẫn được lưu lại.`);
        setDisposeConfirm(null);
        setDisposeReason('');
    };

    const handleScanResult = (code: string) => {
        setSearchTerm(code);
    };

    // ========== EXCEL IMPORT ==========
    const EXCEL_COLUMNS = [
        'Mã TS', 'Tên tài sản', 'Loại tài sản', 'Nhãn hiệu', 'Model',
        'Số Serial', 'Nguyên giá', 'Ngày mua (DD/MM/YYYY)', 'Khấu hao (năm)',
        'Bảo hành (tháng)', 'Giá trị thanh lý', 'Kho', 'Vị trí', 'Ghi chú',
    ];

    const downloadTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([
            EXCEL_COLUMNS,
            ['TS-001', 'Máy xúc CAT 320D', 'Máy móc', 'CAT', '320D', 'SN12345', '500000000', '17/03/2026', '10', '24', '50000000', '', '', ''],
        ]);
        // column widths
        ws['!cols'] = EXCEL_COLUMNS.map(() => ({ wch: 18 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Mẫu nhập tài sản');
        const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Mau_nhap_tai_san.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success('Tải mẫu', 'File mẫu Excel đã được tải về');
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const jsonRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

                // validate & map
                const errors: Record<number, string> = {};
                const mapped = jsonRows.map((row, i) => {
                    const errs: string[] = [];
                    const code = String(row['Mã TS'] || '').trim();
                    const name = String(row['Tên tài sản'] || '').trim();
                    const catName = String(row['Loại tài sản'] || '').trim();
                    const originalValue = Number(row['Nguyên giá']) || 0;

                    if (!code) errs.push('Thiếu mã TS');
                    if (!name) errs.push('Thiếu tên');
                    if (originalValue <= 0) errs.push('Nguyên giá phải > 0');
                    // Check duplicate code in existing assets
                    if (code && assets.some(a => a.code === code)) errs.push('Mã đã tồn tại');

                    // Parse date DD/MM/YYYY
                    let purchaseDate = new Date().toISOString().split('T')[0];
                    const rawDate = String(row['Ngày mua (DD/MM/YYYY)'] || '').trim();
                    if (rawDate) {
                        const parts = rawDate.split('/');
                        if (parts.length === 3) {
                            purchaseDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                        } else {
                            // try parsing as Excel serial number or ISO date
                            const d = new Date(rawDate);
                            if (!isNaN(d.getTime())) purchaseDate = d.toISOString().split('T')[0];
                        }
                    }

                    // Find category
                    const cat = assetCategories.find(c => c.name.toLowerCase() === catName.toLowerCase());
                    if (catName && !cat) errs.push(`Loại "${catName}" không tồn tại`);

                    if (errs.length > 0) errors[i] = errs.join('; ');

                    return {
                        _rowIndex: i,
                        code,
                        name,
                        categoryId: cat?.id || assetCategories[0]?.id || '',
                        categoryName: catName || assetCategories[0]?.name || '',
                        brand: String(row['Nhãn hiệu'] || '').trim(),
                        model: String(row['Model'] || '').trim(),
                        serialNumber: String(row['Số Serial'] || '').trim(),
                        originalValue,
                        purchaseDate,
                        depreciationYears: Number(row['Khấu hao (năm)']) || 5,
                        warrantyMonths: Number(row['Bảo hành (tháng)']) || 0,
                        residualValue: Number(row['Giá trị thanh lý']) || 0,
                        warehouseId: (() => {
                            const wName = String(row['Kho'] || '').trim();
                            return warehouses.find(w => w.name.toLowerCase() === wName.toLowerCase())?.id || '';
                        })(),
                        locationNote: String(row['Vị trí'] || '').trim(),
                        note: String(row['Ghi chú'] || '').trim(),
                    };
                });

                setImportRows(mapped);
                setImportErrors(errors);
                setShowImportModal(true);
            } catch (err) {
                toast.error('Lỗi đọc file', 'File Excel không hợp lệ. Vui lòng dùng file mẫu.');
            }
        };
        reader.readAsArrayBuffer(file);
        // Reset input so same file can be re-selected
        e.target.value = '';
    };

    const handleBulkImport = () => {
        const validRows = importRows.filter((_, i) => !importErrors[i]);
        if (validRows.length === 0) {
            toast.error('Không có dữ liệu hợp lệ', 'Vui lòng kiểm tra lại file Excel');
            return;
        }
        setImporting(true);
        const now = new Date().toISOString();
        validRows.forEach(row => {
            addAsset({
                id: `ast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                code: row.code,
                name: row.name,
                categoryId: row.categoryId,
                brand: row.brand,
                model: row.model,
                serialNumber: row.serialNumber,
                originalValue: row.originalValue,
                purchaseDate: row.purchaseDate,
                depreciationYears: row.depreciationYears,
                warrantyMonths: row.warrantyMonths,
                residualValue: row.residualValue,
                warehouseId: row.warehouseId,
                locationNote: row.locationNote,
                note: row.note,
                status: AssetStatus.AVAILABLE,
                createdAt: now,
                updatedAt: now,
            });
        });
        toast.success('Nhập thành công', `Đã nhập ${validRows.length} tài sản từ file Excel`);
        setShowImportModal(false);
        setImportRows([]);
        setImportErrors({});
        setImporting(false);
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

    const getWarrantyInfo = (asset: Asset) => {
        const warrantyMonths = asset.warrantyMonths || 0;
        if (warrantyMonths <= 0) return { hasWarranty: false, percentRemaining: 0, daysRemaining: 0, expiryDate: '', label: 'Không BH', barColor: 'bg-slate-300 dark:bg-slate-600', textColor: 'text-slate-400' };
        const purchase = new Date(asset.purchaseDate);
        const expiry = new Date(purchase);
        expiry.setMonth(expiry.getMonth() + warrantyMonths);
        const now = new Date();
        const totalMs = expiry.getTime() - purchase.getTime();
        const elapsedMs = now.getTime() - purchase.getTime();
        const remainingMs = expiry.getTime() - now.getTime();
        const daysRemaining = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
        const percentRemaining = Math.max(0, Math.min(100, ((totalMs - elapsedMs) / totalMs) * 100));
        const expiryDate = expiry.toLocaleDateString('vi-VN');

        let barColor: string, textColor: string, label: string;
        if (daysRemaining <= 0) {
            barColor = 'bg-slate-300 dark:bg-slate-600'; textColor = 'text-slate-400'; label = 'Hết bảo hành';
        } else if (percentRemaining <= 15) {
            barColor = 'bg-gradient-to-r from-red-500 to-red-600'; textColor = 'text-red-500'; label = `${daysRemaining} ngày`;
        } else if (percentRemaining <= 35) {
            barColor = 'bg-gradient-to-r from-orange-500 to-amber-500'; textColor = 'text-orange-500'; label = `${daysRemaining} ngày`;
        } else if (percentRemaining <= 60) {
            barColor = 'bg-gradient-to-r from-amber-400 to-yellow-400'; textColor = 'text-amber-500'; label = `${Math.floor(daysRemaining / 30)} tháng`;
        } else {
            barColor = 'bg-gradient-to-r from-emerald-400 to-green-500'; textColor = 'text-emerald-500'; label = `${Math.floor(daysRemaining / 30)} tháng`;
        }

        return { hasWarranty: true, percentRemaining, daysRemaining, expiryDate, label, barColor, textColor };
    };

    const activeAssets = assets.filter(a => a.status !== AssetStatus.DISPOSED);
    const totalValue = activeAssets.reduce((sum, a) => sum + a.originalValue, 0);
    const totalRemaining = activeAssets.reduce((sum, a) => sum + getDepreciation(a).remaining, 0);
    const inUseCount = activeAssets.filter(a => a.status === AssetStatus.IN_USE).length;
    const availableCount = activeAssets.filter(a => a.status === AssetStatus.AVAILABLE).length;
    const disposedCount = assets.filter(a => a.status === AssetStatus.DISPOSED).length;

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
                    {canCRUD && (
                    <>
                    <button onClick={downloadTemplate} className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition text-[10px] font-black uppercase tracking-widest">
                        <Download className="w-4 h-4 mr-2" /> Tải mẫu
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition text-[10px] font-black uppercase tracking-widest">
                        <Upload className="w-4 h-4 mr-2" /> Nhập Excel
                    </button>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
                    <button onClick={openAdd} className="flex items-center px-6 py-2 bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-xl hover:shadow-lg transition text-[10px] font-black uppercase tracking-widest shadow-lg shadow-rose-500/20">
                        <Plus className="w-4 h-4 mr-2" /> Thêm tài sản
                    </button>
                    </>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center"><Landmark size={18} className="text-rose-500" /></div>
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Tồn kho</p>
                            <p className="text-xl font-black text-slate-800 dark:text-white">{activeAssets.length}</p>
                            {disposedCount > 0 && <div className="text-[9px] text-slate-400 font-bold">{disposedCount} đã xuất huỷ</div>}
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
                                <th className="p-4 text-center">Bảo hành</th>
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
                                const warranty = getWarrantyInfo(asset);
                                return (
                                    <tr key={asset.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                        <td className="p-4 font-mono text-slate-400 font-bold text-xs">{asset.code}</td>
                                        <td className="p-4 cursor-pointer hover:text-rose-500" onClick={() => navigate(`/ts/asset/${asset.id}`)}>
                                            <div className="font-black text-slate-800 dark:text-white truncate max-w-[200px]">{asset.name}</div>
                                            {asset.brand && <div className="text-[10px] text-slate-400">{asset.brand} {asset.model || ''}</div>}
                                        </td>
                                        <td className="p-4 text-slate-500 font-medium text-xs">{getCategoryName(asset.categoryId)}</td>
                                        <td className="p-4 text-right font-black text-slate-800 dark:text-white">{asset.originalValue.toLocaleString('vi-VN')}đ</td>
                                        <td className="p-4">
                                            <div className="w-28 mx-auto">
                                                <div className="flex items-center justify-between mb-1">
                                                    <Shield size={10} className={warranty.textColor} />
                                                    <span className={`text-[9px] font-black ${warranty.textColor}`}>{warranty.label}</span>
                                                </div>
                                                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
                                                    <div className={`h-2 rounded-full transition-all ${warranty.barColor}`} style={{ width: `${warranty.percentRemaining}%` }} />
                                                </div>
                                                {warranty.hasWarranty && <div className="text-[8px] text-slate-400 text-right mt-0.5">đến {warranty.expiryDate}</div>}
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
                                                {asset.status !== AssetStatus.DISPOSED && canCRUD && (
                                                    <button onClick={() => openEdit(asset)} className="p-2 text-slate-300 hover:text-blue-600 transition-colors" title="Sửa"><Edit3 size={14} /></button>
                                                )}
                                                {asset.status !== AssetStatus.DISPOSED && asset.status !== AssetStatus.IN_USE && canCRUD && (
                                                    <button onClick={() => { setDisposeConfirm(asset); setDisposeReason(''); }} className="p-2 text-slate-300 hover:text-orange-600 transition-colors" title="Xuất huỷ">
                                                        <XCircle size={14} />
                                                    </button>
                                                )}
                                                {canCRUD && (deleteConfirm === asset.id ? (
                                                    <div className="flex gap-1">
                                                        <button onClick={() => handleDelete(asset.id)} className="p-1.5 bg-red-500 text-white rounded-lg text-[9px] font-bold">Xóa</button>
                                                        <button onClick={() => setDeleteConfirm(null)} className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg text-[9px] font-bold">Hủy</button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setDeleteConfirm(asset.id)} className="p-2 text-slate-300 hover:text-red-600 transition-colors" title="Xoá vĩnh viễn"><Trash2 size={14} /></button>
                                                ))}
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
                            <div key={asset.id} className="p-4 space-y-2" onClick={() => navigate(`/ts/asset/${asset.id}`)}>
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
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Khấu hao (năm)</label>
                                    <input type="number" value={form.depreciationYears} onChange={e => setForm(p => ({ ...p, depreciationYears: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Bảo hành (tháng)</label>
                                    <input type="number" min={0} value={form.warrantyMonths} onChange={e => setForm(p => ({ ...p, warrantyMonths: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 font-bold outline-none focus:ring-2 focus:ring-rose-500" placeholder="12" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Giá trị thanh lý</label>
                                    <input type="number" value={form.residualValue} onChange={e => setForm(p => ({ ...p, residualValue: Number(e.target.value) }))}
                                        className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500" />
                                </div>
                            </div>
                            {/* Warranty Preview */}
                            {form.warrantyMonths > 0 && form.purchaseDate && (() => {
                                const expiry = new Date(form.purchaseDate);
                                expiry.setMonth(expiry.getMonth() + Number(form.warrantyMonths));
                                const now = new Date();
                                const purchase = new Date(form.purchaseDate);
                                const totalMs = expiry.getTime() - purchase.getTime();
                                const elapsedMs = now.getTime() - purchase.getTime();
                                const pct = Math.max(0, Math.min(100, ((totalMs - elapsedMs) / totalMs) * 100));
                                const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                const isExpired = daysLeft <= 0;
                                const barColor = isExpired ? 'bg-slate-300' : pct <= 15 ? 'bg-gradient-to-r from-red-500 to-red-600' : pct <= 35 ? 'bg-gradient-to-r from-orange-500 to-amber-500' : pct <= 60 ? 'bg-gradient-to-r from-amber-400 to-yellow-400' : 'bg-gradient-to-r from-emerald-400 to-green-500';
                                return (
                                    <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/20 dark:to-blue-950/20 p-3 rounded-xl border border-sky-100 dark:border-sky-900/30 -mt-1">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[10px] font-black text-sky-600 dark:text-sky-400 uppercase flex items-center gap-1"><Shield size={11} /> Bảo hành</span>
                                            <span className="text-[10px] font-bold text-slate-500">
                                                {isExpired ? 'Đã hết hạn' : `Còn ${daysLeft > 30 ? Math.floor(daysLeft / 30) + ' tháng ' + (daysLeft % 30) + ' ngày' : daysLeft + ' ngày'}`}
                                            </span>
                                        </div>
                                        <div className="w-full bg-white dark:bg-slate-800 rounded-full h-2.5">
                                            <div className={`h-2.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                                        </div>
                                        <div className="flex justify-between mt-1 text-[9px] text-slate-400">
                                            <span>Mua: {new Date(form.purchaseDate).toLocaleDateString('vi-VN')}</span>
                                            <span>Hết BH: {expiry.toLocaleDateString('vi-VN')}</span>
                                        </div>
                                    </div>
                                );
                            })()}
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
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
                                const warranty = getWarrantyInfo(detailAsset);
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

                                        {/* Warranty Section */}
                                        {warranty.hasWarranty && (
                                            <div className={`p-4 rounded-xl border ${warranty.daysRemaining <= 0 ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' : warranty.percentRemaining <= 15 ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30' : 'bg-sky-50 dark:bg-sky-950/20 border-sky-100 dark:border-sky-900/30'}`}>
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className={`text-[10px] font-black uppercase flex items-center gap-1 ${warranty.textColor}`}>
                                                        <Shield size={12} /> Bảo hành
                                                    </p>
                                                    <span className={`text-xs font-black ${warranty.textColor}`}>
                                                        {warranty.daysRemaining <= 0 ? 'Đã hết hạn' : `Còn ${warranty.label}`}
                                                    </span>
                                                </div>
                                                <div className="w-full bg-white dark:bg-slate-800 rounded-full h-3 mb-2">
                                                    <div className={`h-3 rounded-full transition-all ${warranty.barColor}`} style={{ width: `${warranty.percentRemaining}%` }} />
                                                </div>
                                                <div className="flex justify-between text-[10px] text-slate-400">
                                                    <span>Thời hạn: {detailAsset.warrantyMonths} tháng</span>
                                                    <span>Hết hạn: {warranty.expiryDate}</span>
                                                </div>
                                            </div>
                                        )}

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

            {/* ===================== EXCEL IMPORT PREVIEW MODAL ===================== */}
            {showImportModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center">
                                    <FileSpreadsheet size={20} className="text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-800 dark:text-white">Xem trước dữ liệu nhập</h3>
                                    <p className="text-xs text-slate-400">
                                        {importRows.length} dòng •{' '}
                                        <span className="text-emerald-500 font-bold">{importRows.length - Object.keys(importErrors).length} hợp lệ</span>
                                        {Object.keys(importErrors).length > 0 && (
                                            <> • <span className="text-red-500 font-bold">{Object.keys(importErrors).length} lỗi</span></>
                                        )}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>

                        {/* Table */}
                        <div className="flex-1 overflow-auto p-4">
                            <table className="w-full text-left border-collapse min-w-[900px]">
                                <thead>
                                    <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-slate-500 text-[9px] uppercase font-black tracking-widest sticky top-0">
                                        <th className="p-3 w-8">#</th>
                                        <th className="p-3">Mã TS</th>
                                        <th className="p-3">Tên tài sản</th>
                                        <th className="p-3">Loại</th>
                                        <th className="p-3 text-right">Nguyên giá</th>
                                        <th className="p-3">Ngày mua</th>
                                        <th className="p-3">Nhãn hiệu</th>
                                        <th className="p-3">KH (năm)</th>
                                        <th className="p-3">BH (tháng)</th>
                                        <th className="p-3">Trạng thái</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {importRows.map((row, i) => {
                                        const hasError = !!importErrors[i];
                                        return (
                                            <tr key={i} className={hasError ? 'bg-red-50/50 dark:bg-red-950/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}>
                                                <td className="p-3 text-slate-400 font-mono text-[10px]">{i + 1}</td>
                                                <td className="p-3 font-mono font-bold text-slate-600 dark:text-slate-300">{row.code || '—'}</td>
                                                <td className="p-3 font-bold text-slate-800 dark:text-white max-w-[200px] truncate">{row.name || '—'}</td>
                                                <td className="p-3 text-slate-500">{row.categoryName || '—'}</td>
                                                <td className="p-3 text-right font-bold text-slate-800 dark:text-white">{row.originalValue > 0 ? row.originalValue.toLocaleString('vi-VN') + 'đ' : '—'}</td>
                                                <td className="p-3 text-slate-500">{row.purchaseDate ? new Date(row.purchaseDate).toLocaleDateString('vi-VN') : '—'}</td>
                                                <td className="p-3 text-slate-500">{row.brand || '—'}</td>
                                                <td className="p-3 text-slate-500 text-center">{row.depreciationYears}</td>
                                                <td className="p-3 text-slate-500 text-center">{row.warrantyMonths}</td>
                                                <td className="p-3">
                                                    {hasError ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black text-red-600 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800" title={importErrors[i]}>
                                                            <XCircle size={10} /> {importErrors[i]}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                                                            <CheckCircle2 size={10} /> OK
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {importRows.length === 0 && (
                                <div className="p-16 text-center">
                                    <FileSpreadsheet size={48} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                                    <p className="text-slate-400 font-bold">Không có dữ liệu</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="text-xs text-slate-400">
                                Chỉ nhập <strong className="text-emerald-600">{importRows.length - Object.keys(importErrors).length}</strong> dòng hợp lệ — bỏ qua {Object.keys(importErrors).length} dòng lỗi
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setShowImportModal(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Huỷ</button>
                                <button onClick={handleBulkImport} disabled={importing || importRows.length - Object.keys(importErrors).length === 0}
                                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-sm shadow-lg shadow-blue-500/20 hover:shadow-xl transition-all disabled:opacity-50 flex items-center gap-2">
                                    {importing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                    Nhập {importRows.length - Object.keys(importErrors).length} tài sản
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===================== DISPOSE CONFIRM MODAL ===================== */}
            {disposeConfirm && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center">
                                <FileWarning size={20} className="text-orange-500" />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-white">Xuất huỷ tài sản</h3>
                                <p className="text-xs text-slate-400">Tài sản sẽ bị loại khỏi tồn kho</p>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Asset Info */}
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-[10px] text-slate-400 font-black uppercase">Mã TS</span>
                                    <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">{disposeConfirm.code}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[10px] text-slate-400 font-black uppercase">Tên</span>
                                    <span className="text-xs font-black text-slate-800 dark:text-white">{disposeConfirm.name}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[10px] text-slate-400 font-black uppercase">Nguyên giá</span>
                                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{disposeConfirm.originalValue.toLocaleString('vi-VN')}đ</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[10px] text-slate-400 font-black uppercase">Giá trị còn lại</span>
                                    <span className="text-xs font-bold text-emerald-600">{Math.round(getDepreciation(disposeConfirm).remaining).toLocaleString('vi-VN')}đ</span>
                                </div>
                            </div>

                            {/* Warning */}
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-3 rounded-xl flex gap-2">
                                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                                    Tài sản sẽ chuyển sang trạng thái <strong>"Đã thanh lý"</strong> và bị trừ khỏi tồn kho. Toàn bộ lịch sử (cấp phát, bảo trì, khấu hao) vẫn được lưu lại.
                                </p>
                            </div>

                            {/* Reason */}
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Lý do xuất huỷ</label>
                                <textarea
                                    value={disposeReason}
                                    onChange={e => setDisposeReason(e.target.value)}
                                    rows={2}
                                    placeholder="VD: Hết khấu hao, hỏng không sửa được..."
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                                />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setDisposeConfirm(null)} className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Huỷ</button>
                            <button onClick={handleDispose} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-sm shadow-lg shadow-orange-500/20 hover:shadow-xl transition-all flex items-center gap-2">
                                <XCircle size={16} /> Xác nhận xuất huỷ
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetCatalog;
