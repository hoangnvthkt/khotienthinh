import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useToast } from '../../context/ToastContext';
import {
    Search, Plus, Filter, Trash2, Edit3, MoreHorizontal, QrCode,
    Landmark, Tag, Calendar, DollarSign, MapPin, User, X, Check,
    AlertTriangle, CheckCircle, Wrench, Ban, Package, Shield, XCircle, FileWarning,
    Upload, Download, FileSpreadsheet, Table2, CheckCircle2, Loader2, ChevronDown, ChevronRight, Layers, LayoutGrid, ArrowLeftRight
} from 'lucide-react';
import { Asset, AssetStatus, ASSET_STATUS_LABELS, ASSET_CATEGORY_LABELS, AssetCategoryType, AssetLocationStock, AssetTransfer } from '../../types';
import ScannerModal from '../../components/ScannerModal';
import { usePermission } from '../../hooks/usePermission';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { loadXlsx } from '../../lib/loadXlsx';
import Pagination from '../../components/Pagination';
import { usePagination } from '../../hooks/usePagination';

const AssetCatalog: React.FC = () => {
    const navigate = useNavigate();
    const {
        assets, assetCategories, warehouses, users, user,
        assetLocationStocks, assetTransfers,
        suppliers, units,
        addAssetWithInitialStock, updateAsset, removeAsset,
        addAssetCategory, updateAssetCategory, removeAssetCategory, addAssetTransfer,
        transferAssetStock,
        addSupplier, addUnit
    } = useApp();
  useModuleData('ts');
    const toast = useToast();
    const { canManage } = usePermission();
    const canCRUD = canManage('/ts/catalog');

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterAssetType, setFilterAssetType] = useState('all');
    const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
    const [activeTab, setActiveTab] = useState<'info'|'components'|'distribution'>('info');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [disposeConfirm, setDisposeConfirm] = useState<Asset | null>(null);
    const [disposeReason, setDisposeReason] = useState('');
    const [isScannerOpen, setScannerOpen] = useState(false);

    // Batch Transfer State
    const [showBatchTransfer, setShowBatchTransfer] = useState(false);
    const [transferFromStock, setTransferFromStock] = useState<AssetLocationStock | null>(null);
    const [tForm, setTForm] = useState({
        qty: 0,
        toWarehouseId: '',
        userId: '',
        reason: '',
        date: new Date().toISOString().split('T')[0]
    });

    // Excel Import state
    const [showImportModal, setShowImportModal] = useState(false);
    const [importRows, setImportRows] = useState<Array<Record<string, any>>>([]);
    const [importErrors, setImportErrors] = useState<Record<number, string>>({});
    const [importWarnings, setImportWarnings] = useState<Record<number, string[]>>({});
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form state
    const [form, setForm] = useState({
        code: '', name: '', categoryId: '', brand: '', model: '', serialNumber: '',
        originalValue: 0, purchaseDate: new Date().toISOString().split('T')[0],
        depreciationYears: 5, warrantyMonths: 12, residualValue: 0, warehouseId: '', locationNote: '', note: '',
        assetType: 'single' as 'single' | 'batch' | 'bundle', quantity: 1, unit: 'Cái', parentId: '',
        supplierId: ''
    });

    const resetForm = () => {
        setForm({
            code: '', name: '', categoryId: assetCategories[0]?.id || '', brand: '', model: '', serialNumber: '',
            originalValue: 0, purchaseDate: new Date().toISOString().split('T')[0],
            depreciationYears: 5, warrantyMonths: 12, residualValue: 0, warehouseId: '', locationNote: '', note: '',
            assetType: 'single' as 'single' | 'batch' | 'bundle', quantity: 1, unit: 'Cái', parentId: '',
            supplierId: ''
        });
    };

    const openAdd = async () => {
        resetForm();
        let nextCode = `TS-${String(assets.length + 1).padStart(3, '0')}`;
        if (isSupabaseConfigured) {
            const { data, error } = await supabase.rpc('next_asset_code');
            if (!error && data) nextCode = data;
        }
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
            assetType: asset.assetType || 'single', quantity: asset.quantity || 1, unit: asset.unit || 'Cái', parentId: asset.parentId || '',
            supplierId: asset.supplierId || ''
        });
        setEditingAsset(asset);
        setShowAddModal(true);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.code.trim()) {
            toast.error('Lỗi', 'Vui lòng nhập mã tài sản và tên tài sản');
            return;
        }
        const now = new Date().toISOString();
        const resolvedSupplierName = suppliers.find(s => s.id === form.supplierId)?.name || undefined;
        try {
          if (editingAsset) {
            await updateAsset({
                ...editingAsset, ...form,
                originalValue: Number(form.originalValue),
                depreciationYears: Number(form.depreciationYears),
                warrantyMonths: Number(form.warrantyMonths),
                residualValue: Number(form.residualValue),
                supplierId: form.supplierId || undefined,
                supplierName: resolvedSupplierName,
                updatedAt: now,
            });
            toast.success('Cập nhật thành công', `Tài sản ${form.name} đã được cập nhật`);
          } else {
            await addAssetWithInitialStock({
                id: `ast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                ...form,
                originalValue: Number(form.originalValue),
                depreciationYears: Number(form.depreciationYears),
                warrantyMonths: Number(form.warrantyMonths),
                residualValue: Number(form.residualValue),
                supplierId: form.supplierId || undefined,
                supplierName: resolvedSupplierName,
                status: AssetStatus.AVAILABLE,
                createdAt: now,
                updatedAt: now,
            });
            toast.success('Thêm thành công', `Tài sản ${form.name} đã được thêm vào danh mục`);
          }
          setShowAddModal(false);
        } catch (err: any) {
          toast.error('Lỗi lưu tài sản', err?.message || 'Không thể lưu tài sản');
        }
    };

    // Quick-add Supplier states & handler
    const [showAddSupplier, setShowAddSupplier] = useState(false);
    const [newSupplierForm, setNewSupplierForm] = useState({ name: '', contactPerson: '', phone: '' });
    const handleQuickAddSupplier = () => {
        if (!newSupplierForm.name.trim()) { toast.error('Lỗi', 'Vui lòng nhập tên nhà cung cấp'); return; }
        const s = { id: `sup-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, name: newSupplierForm.name.trim(), contactPerson: newSupplierForm.contactPerson.trim(), phone: newSupplierForm.phone.trim(), debt: 0 };
        addSupplier(s);
        setForm(p => ({ ...p, supplierId: s.id }));
        setShowAddSupplier(false);
        setNewSupplierForm({ name: '', contactPerson: '', phone: '' });
        toast.success('Thêm NCC thành công', `${s.name} đã được thêm vào danh sách nhà cung cấp`);
    };

    // Quick-add Unit states & handler
    const [showAddUnit, setShowAddUnit] = useState(false);
    const [newUnitName, setNewUnitName] = useState('');
    const handleQuickAddUnit = () => {
        if (!newUnitName.trim()) { toast.error('Lỗi', 'Vui lòng nhập tên đơn vị'); return; }
        addUnit(newUnitName.trim());
        setForm(p => ({ ...p, unit: newUnitName.trim() }));
        setShowAddUnit(false);
        setNewUnitName('');
        toast.success('Thêm đơn vị thành công', `"đơn vị được thêm vào danh sách`);
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

    const handleBatchTransfer = async () => {
        if (!transferFromStock || !detailAsset) return;
        if (tForm.qty <= 0 || tForm.qty > transferFromStock.qty) {
            toast.error('Lỗi', 'Số lượng xuất kho không hợp lệ');
            return;
        }
        if (!tForm.toWarehouseId && !tForm.userId) {
            toast.error('Lỗi', 'Vui lòng chọn kho hoặc người nhận');
            return;
        }

        if (isSupabaseConfigured) {
            try {
                await transferAssetStock({
                    assetId: detailAsset.id,
                    fromStockId: transferFromStock.id,
                    qty: tForm.qty,
                    toWarehouseId: tForm.toWarehouseId || undefined,
                    toUserId: tForm.userId || undefined,
                    reason: tForm.reason,
                    date: tForm.date,
                });
                toast.success('Thành công', 'Đã điều chuyển lô tài sản thành công');
                setShowBatchTransfer(false);
                setTransferFromStock(null);
            } catch (err: any) {
                toast.error('Lỗi điều chuyển', err?.message || 'Không thể điều chuyển tài sản');
            }
            return;
        }

        const nowIso = new Date().toISOString();
        const oldStock = { ...transferFromStock, qty: transferFromStock.qty - tForm.qty, updatedAt: nowIso };
        
        let targetStock = assetLocationStocks.find(s => 
            s.assetId === detailAsset.id &&
            s.warehouseId === (tForm.toWarehouseId || undefined) &&
            s.assignedToUserId === (tForm.userId || undefined)
        );

        let newStock: AssetLocationStock;
        if (targetStock) {
            newStock = { ...targetStock, qty: targetStock.qty + tForm.qty, updatedAt: nowIso };
        } else {
            newStock = {
                id: `stock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                assetId: detailAsset.id,
                warehouseId: tForm.toWarehouseId || undefined,
                qty: tForm.qty,
                assignedToUserId: tForm.userId || undefined,
                assignedToName: users.find(u => u.id === tForm.userId)?.name || undefined,
                updatedAt: nowIso
            };
        }
        
        const getWarehouseName = (wId?: string) => wId ? warehouses.find(w => w.id === wId)?.name || 'Kho khác' : 'Không xác định';

        const transferLog: AssetTransfer = {
            id: `tfr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            code: `DC-${Date.now().toString().slice(-6)}`,
            assetId: detailAsset.id,
            assetCode: detailAsset.code,
            assetName: detailAsset.name,
            qty: tForm.qty,
            fromWarehouseId: oldStock.warehouseId,
            fromLocationLabel: oldStock.assignedToName || getWarehouseName(oldStock.warehouseId),
            toWarehouseId: newStock.warehouseId,
            toLocationLabel: newStock.assignedToName || getWarehouseName(newStock.warehouseId),
            receivedByUserId: newStock.assignedToUserId,
            receivedByName: newStock.assignedToName,
            date: tForm.date,
            reason: tForm.reason,
            status: 'completed',
            performedBy: user.id,
            performedByName: user.name || user.username,
            createdAt: nowIso
        };

        addAssetTransfer(transferLog, [oldStock, newStock]);
        toast.success('Thành công', 'Đã điều chuyển lô tài sản thành công');
        setShowBatchTransfer(false);
        setTransferFromStock(null);
    };

    const openBatchTransfer = (stock: AssetLocationStock) => {
        setTransferFromStock(stock);
        setTForm(prev => ({ ...prev, qty: stock.qty, toWarehouseId: '', userId: '', reason: '' }));
        setShowBatchTransfer(true);
    };

    const handleScanResult = (code: string) => {
        setSearchTerm(code);
    };

    // ========== EXCEL IMPORT ==========
    const EXCEL_COLUMNS = [
        'Mã TS', 'Tên tài sản', 'Loại tài sản', 'Loại hình (Đơn/Lô/Bộ)', 'Số lượng', 'Đơn vị tính',
        'Nhãn hiệu', 'Model', 'Số Serial', 'Nguyên giá', 'Ngày mua (DD/MM/YYYY)', 'Khấu hao (năm)',
        'Bảo hành (tháng)', 'Giá trị thanh lý', 'Kho', 'Vị trí', 'Nhà cung cấp', 'Ghi chú',
    ];

    const downloadTemplate = async () => {
        const XLSX = await loadXlsx();
        const ws = XLSX.utils.aoa_to_sheet([
            EXCEL_COLUMNS,
            ['TS-001', 'Máy xúc CAT 320D', 'Máy móc', 'Đơn', '1', 'Cái', 'CAT', '320D', 'SN12345', '500000000', '17/03/2026', '10', '24', '50000000', '', '', '', ''],
            ['TS-002', 'Gạch xây', 'Vật tư', 'Lô', '1000', 'Viên', '', '', '', '1500', '17/03/2026', '1', '0', '0', '', '', '', ''],
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
        reader.onload = async (evt) => {
            try {
                const XLSX = await loadXlsx();
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const jsonRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

                // validate & map
                const errors: Record<number, string> = {};
                const warnings: Record<number, string[]> = {};
                const mapped = jsonRows.map((row, i) => {
                    const errs: string[] = [];
                    const warns: string[] = [];
                    
                    const code = String(row['Mã TS'] || '').trim();
                    const name = String(row['Tên tài sản'] || '').trim();
                    const catName = String(row['Loại tài sản'] || '').trim();
                    const originalValue = Number(row['Nguyên giá']) || 0;
                    
                    const assetTypeStr = String(row['Loại hình (Đơn/Lô/Bộ)'] || '').trim().toLowerCase();
                    let assetType: 'single' | 'batch' | 'bundle' = 'single';
                    if (assetTypeStr === 'lô') assetType = 'batch';
                    else if (assetTypeStr === 'bộ') assetType = 'bundle';
                    
                    const quantity = Math.max(1, Number(row['Số lượng']) || 1);
                    const unit = String(row['Đơn vị tính'] || '').trim() || 'Cái';
                    
                    const supplierNameInput = String(row['Nhà cung cấp'] || '').trim();
                    const supplier = supplierNameInput ? suppliers.find(s => s.name.toLowerCase() === supplierNameInput.toLowerCase()) : undefined;

                    if (!code) errs.push('Thiếu mã TS');
                    if (!name) errs.push('Thiếu tên');
                    if (originalValue <= 0) warns.push('Nguyên giá = 0 (nên cập nhật sau)');
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
                    if (warns.length > 0) warnings[i] = warns;

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
                        assetType,
                        quantity,
                        unit,
                        supplierId: supplier?.id || '',
                        supplierName: supplier?.name || supplierNameInput || '',
                    };
                });

                setImportRows(mapped);
                setImportErrors(errors);
                setImportWarnings(warnings);
                setShowImportModal(true);
            } catch (err) {
                toast.error('Lỗi đọc file', 'File Excel không hợp lệ. Vui lòng dùng file mẫu.');
            }
        };
        reader.readAsArrayBuffer(file);
        // Reset input so same file can be re-selected
        e.target.value = '';
    };

    const handleBulkImport = async () => {
        const validRows = importRows.filter((_, i) => !importErrors[i]);
        if (validRows.length === 0) {
            toast.error('Không có dữ liệu hợp lệ', 'Vui lòng kiểm tra lại file Excel');
            return;
        }
        setImporting(true);
        const now = new Date().toISOString();
        try {
          for (const row of validRows) {
            await addAssetWithInitialStock({
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
                assetType: row.assetType,
                quantity: row.quantity,
                unit: row.unit,
                supplierId: row.supplierId || undefined,
                supplierName: row.supplierName || undefined,
                status: AssetStatus.AVAILABLE,
                createdAt: now,
                updatedAt: now,
            });
          }
          toast.success('Nhập thành công', `Đã nhập ${validRows.length} tài sản từ file Excel`);
          setShowImportModal(false);
          setImportRows([]);
          setImportErrors({});
          setImportWarnings({});
        } catch (err: any) {
          toast.error('Lỗi nhập Excel', err?.message || 'Không thể nhập danh sách tài sản');
        } finally {
          setImporting(false);
        }
    };

    const filteredAssets = useMemo(() => {
        let list = assets;
        if (searchTerm) {
            list = list.filter(a => 
                a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                a.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (a.serialNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
            );
        } else {
             list = list.filter(a => !a.parentId);
        }
        
        return list.filter(a => {
            const matchCat = filterCategory === 'all' || a.categoryId === filterCategory;
            const matchStatus = filterStatus === 'all' || a.status === filterStatus;
            const matchType = filterAssetType === 'all' || a.assetType === filterAssetType;
            return matchCat && matchStatus && matchType;
        });
    }, [assets, searchTerm, filterCategory, filterStatus, filterAssetType]);

    const {
        paginatedItems: paginatedAssets,
        currentPage,
        totalPages,
        totalItems,
        pageSize,
        setPage,
        setPageSize,
        startIndex,
        endIndex,
    } = usePagination<Asset>(filteredAssets, 25);

    const toggleBundle = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expandedBundles);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedBundles(next);
    };

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

    const renderAssetRow = (asset: Asset, level: number = 0) => {
        const cfg = getStatusConfig(asset.status);
        const StatusIcon = cfg.icon;
        const dep = getDepreciation(asset);
        const warranty = getWarrantyInfo(asset);
        const isBundle = asset.assetType === 'bundle';
        const isBatch = asset.assetType === 'batch';
        const isExpanded = expandedBundles.has(asset.id);
        const children = assets.filter(a => a.parentId === asset.id);

        return (
            <React.Fragment key={asset.id}>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                    <td className="p-4 font-mono text-slate-400 font-bold text-xs">
                        <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 1.5}rem` }}>
                            {isBundle && (
                                <button onClick={(e) => toggleBundle(asset.id, e)} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition text-slate-400">
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                            )}
                            {!isBundle && level > 0 && <span className="w-5" />}
                            {asset.code}
                        </div>
                    </td>
                    <td className="p-4 cursor-pointer hover:text-rose-500" onClick={() => navigate(`/ts/asset/${asset.id}`)}>
                        <div className="font-black text-slate-800 dark:text-white flex items-center gap-2">
                            {isBatch && <span title="Tài sản Lô"><Layers size={14} className="text-amber-500 shrink-0" /></span>}
                            {isBundle && <span title="Tài sản Bộ"><LayoutGrid size={14} className="text-sky-500 shrink-0" /></span>}
                            <span className="truncate max-w-[200px]">{asset.name}</span>
                        </div>
                        {isBatch && <div className="text-[10px] text-amber-600 font-bold mt-0.5">SL: {asset.quantity} {asset.unit}</div>}
                        {asset.brand && <div className="text-[10px] text-slate-400 mt-0.5">{asset.brand} {asset.model || ''}</div>}
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
                    <td className="p-4 text-xs text-slate-500">
                        {isBatch ? (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">Quản lý lô</span>
                        ) : (
                            asset.assignedToName || <span className="text-slate-300 italic">—</span>
                        )}
                    </td>
                    <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                            {asset.status !== AssetStatus.DISPOSED && canCRUD && (
                                <button onClick={(e) => { e.stopPropagation(); openEdit(asset); }} className="p-2 text-slate-300 hover:text-blue-600 transition-colors" title="Sửa"><Edit3 size={14} /></button>
                            )}
                            {asset.status !== AssetStatus.DISPOSED && asset.status !== AssetStatus.IN_USE && canCRUD && (
                                <button onClick={(e) => { e.stopPropagation(); setDisposeConfirm(asset); setDisposeReason(''); }} className="p-2 text-slate-300 hover:text-orange-600 transition-colors" title="Xuất huỷ">
                                    <XCircle size={14} />
                                </button>
                            )}
                            {canCRUD && (deleteConfirm === asset.id ? (
                                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                    <button onClick={() => handleDelete(asset.id)} className="p-1.5 bg-red-500 text-white rounded-lg text-[9px] font-bold">Xóa</button>
                                    <button onClick={() => setDeleteConfirm(null)} className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg text-[9px] font-bold">Hủy</button>
                                </div>
                            ) : (
                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(asset.id); }} className="p-2 text-slate-300 hover:text-red-600 transition-colors" title="Xoá vĩnh viễn"><Trash2 size={14} /></button>
                            ))}
                        </div>
                    </td>
                </tr>
                {isBundle && isExpanded && children.map(child => renderAssetRow(child, level + 1))}
            </React.Fragment>
        );
    };

    const renderMobileCard = (asset: Asset, level: number = 0) => {
        const cfg = getStatusConfig(asset.status);
        const StatusIcon = cfg.icon;
        const isBundle = asset.assetType === 'bundle';
        const isBatch = asset.assetType === 'batch';
        const isExpanded = expandedBundles.has(asset.id);
        const children = assets.filter(a => a.parentId === asset.id);

        return (
            <React.Fragment key={asset.id}>
                <div className="p-4 space-y-2 border-l-4 border-transparent" style={{ marginLeft: `${level * 1}rem`, borderLeftColor: level > 0 ? '#e2e8f0' : 'transparent' }} onClick={() => navigate(`/ts/asset/${asset.id}`)}>
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="text-[10px] font-mono text-slate-400 font-bold flex items-center gap-1">
                                {isBundle && (
                                    <button onClick={(e) => toggleBundle(asset.id, e)} className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 mr-1">
                                        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                    </button>
                                )}
                                {asset.code}
                            </div>
                            <div className="font-black text-slate-800 dark:text-white text-sm flex items-center gap-1">
                                {isBatch && <Layers size={12} className="text-amber-500" />}
                                {isBundle && <LayoutGrid size={12} className="text-sky-500" />}
                                {asset.name}
                            </div>
                            {isBatch && <div className="text-[10px] text-amber-600 font-bold">SL: {asset.quantity} {asset.unit}</div>}
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase border ${cfg.color}`}>
                            <StatusIcon size={10} /> {ASSET_STATUS_LABELS[asset.status]}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs mt-2">
                        <span className="text-slate-400">{getCategoryName(asset.categoryId)}</span>
                        <span className="font-black text-slate-800 dark:text-white">{asset.originalValue.toLocaleString('vi-VN')}đ</span>
                    </div>
                </div>
                {isBundle && isExpanded && children.map(child => renderMobileCard(child, level + 1))}
            </React.Fragment>
        );
    };

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
                <select value={filterAssetType} onChange={e => setFilterAssetType(e.target.value)}
                    className="px-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold uppercase tracking-tighter w-40">
                    <option value="all">Tất cả loại TS</option>
                    <option value="single">Tài sản đơn</option>
                    <option value="batch">Tài sản lô</option>
                    <option value="bundle">Tài sản bộ</option>
                </select>
                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                    className="px-4 py-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800 font-bold uppercase tracking-tighter">
                    <option value="all">Tất cả danh mục</option>
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
                            {paginatedAssets.map(asset => renderAssetRow(asset, 0))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {paginatedAssets.map(asset => renderMobileCard(asset, 0))}
                </div>

                {filteredAssets.length === 0 && (
                    <div className="p-20 text-center">
                        <Landmark size={48} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                        <p className="text-slate-400 font-bold">Chưa có tài sản nào</p>
                        <p className="text-sm text-slate-300 mt-1">Nhấn "Thêm tài sản" để bắt đầu</p>
                    </div>
                )}

                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    startIndex={startIndex}
                    endIndex={endIndex}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    pageSizeOptions={[25, 50, 100]}
                />
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
                            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 mb-4">
                                {(['single', 'batch', 'bundle'] as const).map((type) => (
                                    <button key={type} onClick={() => setForm(p => ({ ...p, assetType: type }))}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${form.assetType === type ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                        {type === 'single' ? 'Tài sản Đơn' : type === 'batch' ? 'Tài sản Lô' : 'Tài sản Bộ (Cha)'}
                                    </button>
                                ))}
                            </div>
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
                            
                            {form.assetType === 'batch' && (
                                <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-xl border border-amber-100 dark:border-amber-900/30">
                                    <label className="text-[10px] font-black text-amber-700 dark:text-amber-500 uppercase block mb-1">Số lượng lô xuất phát</label>
                                    <input type="number" min={1} value={form.quantity} onChange={e => setForm(p => ({...p, quantity: Math.max(1, Number(e.target.value))}))}
                                        className="w-full px-3 py-2.5 text-sm border border-amber-200 dark:border-amber-800 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 bg-white dark:bg-slate-800" />
                                </div>
                            )}

                            {form.assetType === 'single' && (
                                <div className="bg-sky-50 dark:bg-sky-950/20 p-4 rounded-xl border border-sky-100 dark:border-sky-900/30">
                                    <label className="text-[10px] font-black text-sky-700 dark:text-sky-500 uppercase block mb-1">Thuộc tài sản cha (Nếu có)</label>
                                    <select value={form.parentId} onChange={e => setForm(p => ({...p, parentId: e.target.value}))}
                                        className="w-full px-3 py-2.5 text-sm border border-sky-200 dark:border-sky-800 rounded-xl outline-none focus:ring-2 focus:ring-sky-500 bg-white dark:bg-slate-800">
                                        <option value="">Không thuộc bộ nào</option>
                                        {assets.filter(a => a.assetType === 'bundle').map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                                    </select>
                                </div>
                            )}
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

                            {/* === ĐƠN VỊ TÍNH === */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[10px] font-black text-slate-500 uppercase">Đơn vị tính</label>
                                    <button type="button" onClick={() => { setShowAddUnit(v => !v); setShowAddSupplier(false); }}
                                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-0.5 transition-colors">
                                        <span className="text-base leading-none">+</span> Thêm mới
                                    </button>
                                </div>
                                <select value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500">
                                    <option value="">-- Chọn đơn vị --</option>
                                    {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                </select>
                                {showAddUnit && (
                                    <div className="mt-2 p-3 bg-rose-50 dark:bg-rose-950/20 rounded-xl border border-rose-100 dark:border-rose-900/30 flex gap-2 items-center">
                                        <input value={newUnitName} onChange={e => setNewUnitName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleQuickAddUnit()}
                                            placeholder="Tên đơn vị mới..."
                                            className="flex-1 px-3 py-2 text-sm border border-rose-200 dark:border-rose-800 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 bg-white dark:bg-slate-800" />
                                        <button type="button" onClick={handleQuickAddUnit}
                                            className="px-3 py-2 bg-rose-500 text-white text-xs font-bold rounded-lg hover:bg-rose-600 shrink-0">Lưu</button>
                                        <button type="button" onClick={() => { setShowAddUnit(false); setNewUnitName(''); }}
                                            className="px-3 py-2 border border-slate-200 dark:border-slate-700 text-slate-500 text-xs font-bold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0">Hủy</button>
                                    </div>
                                )}
                            </div>

                            {/* === NHÀ CUNG CẤP === */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[10px] font-black text-slate-500 uppercase">Nhà cung cấp</label>
                                    <button type="button" onClick={() => { setShowAddSupplier(v => !v); setShowAddUnit(false); }}
                                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-0.5 transition-colors">
                                        <span className="text-base leading-none">+</span> Thêm mới
                                    </button>
                                </div>
                                <select value={form.supplierId} onChange={e => setForm(p => ({ ...p, supplierId: e.target.value }))}
                                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500">
                                    <option value="">-- Chọn nhà cung cấp --</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` — ${s.phone}` : ''}</option>)}
                                </select>
                                {showAddSupplier && (
                                    <div className="mt-2 p-3 bg-sky-50 dark:bg-sky-950/20 rounded-xl border border-sky-100 dark:border-sky-900/30 space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                            <input value={newSupplierForm.name} onChange={e => setNewSupplierForm(p => ({ ...p, name: e.target.value }))}
                                                placeholder="Tên NCC *"
                                                className="col-span-3 sm:col-span-1 px-3 py-2 text-sm border border-sky-200 dark:border-sky-800 rounded-lg outline-none focus:ring-2 focus:ring-sky-400 bg-white dark:bg-slate-800" />
                                            <input value={newSupplierForm.contactPerson} onChange={e => setNewSupplierForm(p => ({ ...p, contactPerson: e.target.value }))}
                                                placeholder="Người liên hệ"
                                                className="col-span-3 sm:col-span-1 px-3 py-2 text-sm border border-sky-200 dark:border-sky-800 rounded-lg outline-none focus:ring-2 focus:ring-sky-400 bg-white dark:bg-slate-800" />
                                            <input value={newSupplierForm.phone} onChange={e => setNewSupplierForm(p => ({ ...p, phone: e.target.value }))}
                                                placeholder="Số điện thoại"
                                                className="col-span-3 sm:col-span-1 px-3 py-2 text-sm border border-sky-200 dark:border-sky-800 rounded-lg outline-none focus:ring-2 focus:ring-sky-400 bg-white dark:bg-slate-800" />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => { setShowAddSupplier(false); setNewSupplierForm({ name: '', contactPerson: '', phone: '' }); }}
                                                className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-500 text-xs font-bold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">Hủy</button>
                                            <button type="button" onClick={handleQuickAddSupplier}
                                                className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded-lg hover:bg-sky-600">✓ Lưu NCC</button>
                                        </div>
                                    </div>
                                )}
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
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{detailAsset.code}</span>
                                        {detailAsset.assetType === 'batch' && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">LÔ</span>}
                                        {detailAsset.assetType === 'bundle' && <span className="text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded font-bold">BỘ</span>}
                                    </div>
                                    <h3 className="text-xl font-black text-slate-800 dark:text-white mt-1">{detailAsset.name}</h3>
                                </div>
                                <button onClick={() => { setDetailAsset(null); setActiveTab('info'); }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                            <div className="flex gap-6 -mb-6">
                                <button onClick={() => setActiveTab('info')} className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'info' ? 'border-rose-500 text-rose-500' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Thông tin chung</button>
                                {detailAsset.assetType === 'bundle' && (
                                    <button onClick={() => setActiveTab('components')} className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'components' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Thành phần ({assets.filter(a => a.parentId === detailAsset.id).length})</button>
                                )}
                                {detailAsset.assetType === 'batch' && (
                                    <button onClick={() => setActiveTab('distribution')} className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'distribution' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Phân bổ ({assetLocationStocks.filter(s => s.assetId === detailAsset.id).reduce((sum,s)=>sum+s.qty,0)} {detailAsset.unit})</button>
                                )}
                            </div>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/30 dark:bg-slate-900/50">
                            {activeTab === 'info' && (() => {
                                const dep = getDepreciation(detailAsset);
                                const warranty = getWarrantyInfo(detailAsset);
                                const cfg = getStatusConfig(detailAsset.status);
                                const StatusIcon = cfg.icon;
                                return (
                                    <div className="space-y-4">
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
                                    </div>
                                );
                            })()}

                            {activeTab === 'components' && detailAsset.assetType === 'bundle' && (
                                <div className="space-y-3 mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                                    {assets.filter(a => a.parentId === detailAsset.id).length === 0 ? (
                                        <p className="text-center text-sm text-slate-400 py-4">Chưa có thành phần nào</p>
                                    ) : (
                                        assets.filter(a => a.parentId === detailAsset.id).map(child => (
                                            <div key={child.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 flex justify-between items-center cursor-pointer hover:border-sky-500 transition-colors" onClick={() => setDetailAsset(child)}>
                                                <div>
                                                    <span className="text-[10px] text-slate-400 font-mono font-bold mr-2">{child.code}</span>
                                                    <span className="font-bold text-slate-800 dark:text-white text-sm">{child.name}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase border border-slate-200 text-slate-500">
                                                        {ASSET_STATUS_LABELS[child.status]}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {activeTab === 'distribution' && detailAsset.assetType === 'batch' && (
                                <div className="space-y-3 mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                                    {assetLocationStocks.filter(s => s.assetId === detailAsset.id).length === 0 ? (
                                        <p className="text-center text-sm text-slate-400 py-4">Chưa có phân bổ kho</p>
                                    ) : (
                                        assetLocationStocks.filter(s => s.assetId === detailAsset.id).map(stock => {
                                            const warehouse = warehouses.find(w => w.id === stock.warehouseId);
                                            return (
                                            <div key={stock.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex justify-between items-center items-start">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <MapPin size={14} className="text-amber-500" />
                                                        <span className="font-bold text-slate-800 dark:text-white text-sm">{warehouse?.name || 'Vị trí khác'}</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 pl-5">
                                                        {stock.note || 'Không có ghi chú'}
                                                    </div>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-2">
                                                    <div>
                                                        <span className="text-xs text-slate-500 mr-2">Tồn:</span>
                                                        <span className="text-lg font-black text-amber-600">{stock.qty} {detailAsset.unit}</span>
                                                    </div>
                                                    {stock.qty > 0 && canCRUD && (
                                                        <button onClick={() => openBatchTransfer(stock)} className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 border border-amber-200">
                                                            <ArrowLeftRight size={12} /> Điều chuyển / Cấp phát
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0 bg-white dark:bg-slate-900 rounded-b-2xl">
                            <button onClick={() => { setDetailAsset(null); openEdit(detailAsset); }}
                                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-xs shadow-lg shadow-blue-500/20 hover:shadow-xl transition-all flex items-center gap-2">
                                <Edit3 size={14} /> Chỉnh sửa
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===================== BATCH TRANSFER MODAL ===================== */}
            {showBatchTransfer && transferFromStock && detailAsset && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <ArrowLeftRight size={18} className="text-amber-500" /> Điều chuyển lô / Cấp phát
                            </h3>
                            <button onClick={() => setShowBatchTransfer(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-xl border border-amber-100 dark:border-amber-900/30">
                                <p className="text-[10px] uppercase font-bold text-amber-600 mb-1">Từ vị trí / Người dùng hiện tại</p>
                                <p className="text-sm font-bold text-slate-800 dark:text-white">{transferFromStock.assignedToName || warehouses.find(w => w.id === transferFromStock.warehouseId)?.name || 'Không xác định'}</p>
                                <p className="text-xs text-slate-500 mt-1">Tồn khả dụng: <strong className="text-amber-600">{transferFromStock.qty} {detailAsset.unit}</strong></p>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Số lượng chuyển *</label>
                                <input type="number" min={1} max={transferFromStock.qty} value={tForm.qty} onChange={e => setTForm(p => ({ ...p, qty: Number(e.target.value) }))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-amber-500 font-black" />
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Đến kho</label>
                                <select value={tForm.toWarehouseId} onChange={e => setTForm(p => ({ ...p, toWarehouseId: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-amber-500">
                                    <option value="">Không chọn kho</option>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Người nhận (nếu có)</label>
                                <select value={tForm.userId} onChange={e => setTForm(p => ({ ...p, userId: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-amber-500">
                                    <option value="">Không có người nhận</option>
                                    {users.map(u => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Lý do / Ghi chú</label>
                                <input value={tForm.reason} onChange={e => setTForm(p => ({ ...p, reason: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-amber-500" placeholder="VD: Cấp phát công trường" />
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={() => setShowBatchTransfer(false)} className="px-5 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800">Hủy</button>
                            <button onClick={handleBatchTransfer} className="px-5 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-500/30 transition-all flex items-center gap-2">
                                <ArrowLeftRight size={14} /> Xác nhận
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
                                        {Object.keys(importWarnings).length > 0 && (
                                            <> • <span className="text-amber-500 font-bold">{Object.keys(importWarnings).length} cảnh báo (sẽ được nhập)</span></>
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
                                        <th className="p-3 text-center">Loại hình</th>
                                        <th className="p-3 text-right">Nguyên giá</th>
                                        <th className="p-3">Ngày mua</th>
                                        <th className="p-3">Nhà cung cấp</th>
                                        <th className="p-3 text-center">Trạng thái</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {importRows.map((row, i) => {
                                        const hasError = !!importErrors[i];
                                        const rowWarns = importWarnings[i];
                                        return (
                                            <tr key={i} className={hasError ? 'bg-red-50/50 dark:bg-red-950/10' : rowWarns ? 'bg-amber-50/30 dark:bg-amber-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}>
                                                <td className="p-3 text-slate-400 font-mono text-[10px]">{i + 1}</td>
                                                <td className="p-3 font-mono font-bold text-slate-600 dark:text-slate-300">{row.code || '—'}</td>
                                                <td className="p-3 font-bold text-slate-800 dark:text-white max-w-[200px] truncate">{row.name || '—'}</td>
                                                <td className="p-3 text-slate-500">{row.categoryName || '—'}</td>
                                                <td className="p-3 text-center">
                                                    {row.assetType === 'batch' ? <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold">LÔ (x{row.quantity} {row.unit})</span> :
                                                     row.assetType === 'bundle' ? <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded text-[10px] font-bold">BỘ</span> :
                                                     <span className="text-[10px] text-slate-400">Đơn ({row.unit})</span>}
                                                </td>
                                                <td className="p-3 text-right font-bold text-slate-800 dark:text-white">{row.originalValue > 0 ? row.originalValue.toLocaleString('vi-VN') + 'đ' : <span className="text-amber-500 font-bold">0đ</span>}</td>
                                                <td className="p-3 text-slate-500">{row.purchaseDate ? new Date(row.purchaseDate).toLocaleDateString('vi-VN') : '—'}</td>
                                                <td className="p-3 text-slate-500 truncate max-w-[150px]" title={row.supplierName}>{row.supplierName || '—'}</td>
                                                <td className="p-3 text-center">
                                                    {hasError ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black text-red-600 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800" title={importErrors[i]}>
                                                            <XCircle size={10} /> {importErrors[i]}
                                                        </span>
                                                    ) : rowWarns ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black text-amber-600 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800" title={rowWarns.join('; ')}>
                                                            <AlertTriangle size={10} /> CẢNH BÁO
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
