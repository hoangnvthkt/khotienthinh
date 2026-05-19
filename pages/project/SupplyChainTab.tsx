import React, { useState, useMemo, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    Plus, Edit2, Trash2, X, Save, Truck, Star, Phone, Mail, MapPin,
    FileText, CheckCircle2, Clock, Ban, Send, Package, ChevronDown,
    ChevronUp, Users, DollarSign, ShoppingCart, AlertTriangle, FileSpreadsheet,
    Upload, Printer, QrCode, Loader2, RefreshCcw
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { ProjectVendor, PurchaseOrder, POStatus, PurchaseOrderItem, InventoryItem } from '../../types';
import { vendorService, poService } from '../../lib/projectService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import { loadXlsx } from '../../lib/loadXlsx';
import { buildPoReceiveUrl, createPoQrToken } from '../../lib/poQr';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import ExcelImportReviewModal from '../../components/ExcelImportReviewModal';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, parseExcelRows } from '../../lib/excelImport';

interface SupplyChainTabProps {
    constructionSiteId?: string;
    projectId?: string;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const PO_STATUS: Record<POStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
    sent: { label: 'Đã gửi', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Send size={12} /> },
    partial: { label: 'Giao 1 phần', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', icon: <Package size={12} /> },
    delivered: { label: 'Đã giao', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    cancelled: { label: 'Huỷ', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
};

const VENDOR_CATS = ['Xi măng', 'Thép', 'Cát & Đá', 'Gạch', 'Gỗ', 'Sơn', 'Ống/Phụ kiện nước', 'Dây & TB điện', 'VLXD khác'];

const createEmptyPoItem = (): PurchaseOrderItem => ({
    itemId: '',
    sku: '',
    name: '',
    unit: '',
    qty: 0,
    unitPrice: 0,
    neededDate: '',
    note: '',
});

const normalizePoItem = (item: Partial<PurchaseOrderItem>, inventoryItems: InventoryItem[]): PurchaseOrderItem => {
    const matched = inventoryItems.find(inv =>
        inv.id === item.itemId ||
        (!!item.sku && inv.sku.toLowerCase() === item.sku.toLowerCase()) ||
        (!!item.name && inv.name.toLowerCase() === item.name.toLowerCase())
    );

    return {
        itemId: item.itemId || matched?.id || '',
        sku: item.sku || matched?.sku || '',
        name: item.name || matched?.name || '',
        unit: item.unit || matched?.unit || '',
        qty: Number(item.qty) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        receivedQty: Number(item.receivedQty) || 0,
        neededDate: item.neededDate || '',
        note: item.note || '',
    };
};

const normalizePoImportDate = (value: string): string => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
        const [day, month, year] = text.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return text;
};

const SupplyChainTab: React.FC<SupplyChainTabProps> = ({ constructionSiteId, projectId }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const { items: inventoryItems, warehouses, loadModuleData } = useApp();
    const effectiveId = projectId || constructionSiteId || '';
    const [subTab, setSubTab] = useState<'vendor' | 'po'>('vendor');

    // Vendors
    const [vendors, setVendors] = useState<ProjectVendor[]>([]);
    // POs
    const [pos, setPos] = useState<PurchaseOrder[]>([]);

    useEffect(() => {
        loadModuleData('wms');
    }, [loadModuleData]);

    useEffect(() => {
        if (!effectiveId) return;
        vendorService.list(effectiveId, constructionSiteId || null).then(setVendors).catch(console.error);
        poService.list(effectiveId, constructionSiteId || null).then(setPos).catch(console.error);
    }, [effectiveId, constructionSiteId]);

    const [showVendorForm, setShowVendorForm] = useState(false);
    const [editingVendor, setEditingVendor] = useState<ProjectVendor | null>(null);
    const [showPoForm, setShowPoForm] = useState(false);
    const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);
    const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

    // Vendor Form
    const [vName, setVName] = useState('');
    const [vContact, setVContact] = useState('');
    const [vPhone, setVPhone] = useState('');
    const [vEmail, setVEmail] = useState('');
    const [vAddress, setVAddress] = useState('');
    const [vTax, setVTax] = useState('');
    const [vRating, setVRating] = useState(3);
    const [vCats, setVCats] = useState<string[]>([]);
    const [vNotes, setVNotes] = useState('');

    // PO Form
    const [pVendorId, setPVendorId] = useState('');
    const [pNum, setPNum] = useState('');
    const [pTargetWarehouseId, setPTargetWarehouseId] = useState('');
    const [pDate, setPDate] = useState(new Date().toISOString().split('T')[0]);
    const [pExpDate, setPExpDate] = useState('');
    const [pItems, setPItems] = useState<PurchaseOrderItem[]>([createEmptyPoItem()]);
    const [pNote, setPNote] = useState('');
    const [importingPo, setImportingPo] = useState(false);
    const [poImportMode, setPoImportMode] = useState<ExcelImportMode>('create');
    const [poImportPreview, setPoImportPreview] = useState<ExcelImportPreview<PurchaseOrderItem> | null>(null);
    const [printingPoId, setPrintingPoId] = useState<string | null>(null);
    const [savingPo, setSavingPo] = useState(false);
    const poSubmitLockRef = useRef(false);
    const poImportModeRef = useRef<ExcelImportMode>('create');

    // Vendor CRUD
    const resetVendorForm = () => {
        setEditingVendor(null); setShowVendorForm(false);
        setVName(''); setVContact(''); setVPhone(''); setVEmail('');
        setVAddress(''); setVTax(''); setVRating(3); setVCats([]); setVNotes('');
    };
    const openEditVendor = (v: ProjectVendor) => {
        setEditingVendor(v); setVName(v.name); setVContact(v.contact);
        setVPhone(v.phone); setVEmail(v.email || ''); setVAddress(v.address || '');
        setVTax(v.taxCode || ''); setVRating(v.rating); setVCats([...v.categories]);
        setVNotes(v.notes || ''); setShowVendorForm(true);
    };
    const handleSaveVendor = async () => {
        if (!vName || !vPhone) return;
        const vendorPosData = pos.filter(p => editingVendor ? p.vendorId === editingVendor.id : false);
        const v: ProjectVendor = {
            id: editingVendor?.id || crypto.randomUUID(), projectId: projectId || constructionSiteId || null, constructionSiteId: constructionSiteId || null,
            name: vName, contact: vContact, phone: vPhone, email: vEmail || undefined,
            address: vAddress || undefined, taxCode: vTax || undefined, rating: vRating,
            categories: vCats, totalOrders: vendorPosData.length,
            totalValue: vendorPosData.reduce((s, p) => s + p.totalAmount, 0),
            notes: vNotes || undefined, createdAt: editingVendor?.createdAt || new Date().toISOString(),
        };
        await vendorService.upsert(v);
        setVendors(await vendorService.list(effectiveId, constructionSiteId || null));
        toast.success(editingVendor ? 'Cập nhật NCC' : 'Thêm NCC thành công');
        resetVendorForm();
    };

    // PO CRUD
    const resetPoForm = () => {
        setEditingPo(null); setShowPoForm(false);
        setPVendorId(''); setPNum(''); setPDate(new Date().toISOString().split('T')[0]);
        setPTargetWarehouseId(''); setPExpDate(''); setPItems([createEmptyPoItem()]); setPNote('');
    };
    const openEditPo = (po: PurchaseOrder) => {
        setEditingPo(po); setPVendorId(po.vendorId); setPNum(po.poNumber);
        setPTargetWarehouseId(po.targetWarehouseId || '');
        setPDate(po.orderDate); setPExpDate(po.expectedDeliveryDate || '');
        setPItems(po.items.map(i => normalizePoItem(i, inventoryItems)));
        setPNote(po.note || ''); setShowPoForm(true);
    };
    const handleSavePo = async () => {
        if (poSubmitLockRef.current) return;
        if (!pVendorId || !pNum || !pTargetWarehouseId) {
            toast.warning('Thiếu thông tin PO', 'Vui lòng chọn nhà cung cấp, số PO và kho nhận.');
            return;
        }
        const validItems = pItems
            .map(i => normalizePoItem(i, inventoryItems))
            .filter(i => i.itemId && i.qty > 0);
        if (validItems.length === 0) {
            toast.warning('Chưa có vật tư', 'Vui lòng chọn ít nhất một vật tư WMS và nhập khối lượng đặt.');
            return;
        }
        const duplicatedSku = validItems.find((line, index) => validItems.some((other, otherIndex) => otherIndex !== index && other.itemId === line.itemId));
        if (duplicatedSku) {
            toast.warning('Vật tư bị trùng', `SKU ${duplicatedSku.sku} đang xuất hiện nhiều dòng trong PO.`);
            return;
        }
        const invalidReceivedQty = validItems.find(line => (Number(line.receivedQty) || 0) > (Number(line.qty) || 0));
        if (invalidReceivedQty) {
            toast.warning('Khối lượng đặt không hợp lệ', `SKU ${invalidReceivedQty.sku} có số đã nhận lớn hơn khối lượng đặt.`);
            return;
        }
        const totalAmount = validItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
        const vendor = vendors.find(v => v.id === pVendorId);
        poSubmitLockRef.current = true;
        setSavingPo(true);
        const poItem: PurchaseOrder = editingPo ? {
            ...editingPo, vendorId: pVendorId, vendorName: vendor?.name,
            poNumber: pNum, items: validItems, totalAmount, orderDate: pDate,
            expectedDeliveryDate: pExpDate || undefined, targetWarehouseId: pTargetWarehouseId,
            qrToken: editingPo.qrToken || createPoQrToken(),
            note: pNote || undefined,
        } : {
            id: crypto.randomUUID(), projectId: projectId || constructionSiteId || null, constructionSiteId: constructionSiteId || null, vendorId: pVendorId,
            vendorName: vendor?.name, poNumber: pNum, items: validItems,
            totalAmount, orderDate: pDate, expectedDeliveryDate: pExpDate || undefined,
            status: 'draft', targetWarehouseId: pTargetWarehouseId, qrToken: createPoQrToken(),
            receivedTransactionIds: [], note: pNote || undefined, createdAt: new Date().toISOString(),
        };
        try {
            if (!editingPo) {
                const ok = await confirm({
                    title: 'Xác nhận tạo PO',
                    targetName: pNum,
                    confirmText: 'Bạn có chắc chắn muốn tạo đơn hàng PO',
                    subtitle: `${validItems.length} dòng vật tư • Tổng ${fmt(totalAmount)} đ${vendor?.name ? ` • NCC: ${vendor.name}` : ''}`,
                    warningText: 'PO sẽ được lưu vào hệ thống và dùng để in QR nhận hàng từ nhà cung cấp.',
                    intent: 'success',
                    actionLabel: 'Xác nhận tạo',
                    cancelLabel: 'Kiểm tra lại',
                    countdownSeconds: 1,
                });
                if (!ok) return;
            }
            await poService.upsert(poItem);
            setPos(await poService.list(effectiveId, constructionSiteId || null));
            toast.success(editingPo ? 'Cập nhật PO' : 'Tạo đơn hàng thành công');
            resetPoForm();
        } catch (e: any) {
            logApiError('supplyChain.savePo', e);
            toast.error('Không thể lưu PO', getApiErrorMessage(e, 'Không thể lưu đơn hàng lên Supabase.'));
        } finally {
            poSubmitLockRef.current = false;
            setSavingPo(false);
        }
    };

    const updatePoStatus = async (id: string, status: POStatus) => {
        const po = pos.find(p => p.id === id);
        if (!po) return;
        const updated = {
            ...po, status,
            actualDeliveryDate: status === 'delivered' ? new Date().toISOString().split('T')[0] : po.actualDeliveryDate,
        };
        await poService.upsert(updated);
        setPos(await poService.list(effectiveId, constructionSiteId || null));
        toast.success(`Cập nhật trạng thái PO`);
    };

    const handleDeleteVendor = async (v: ProjectVendor) => {
        const ok = await confirm({ targetName: v.name, title: 'Xoá nhà cung cấp', warningText: 'Các đơn hàng liên quan cũng sẽ bị ảnh hưởng.' });
        if (!ok) return;
        try {
            await vendorService.remove(v.id);
            setVendors(await vendorService.list(effectiveId, constructionSiteId || null));
            toast.success('Xoá NCC thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const handleDeletePo = async (po: PurchaseOrder) => {
        const ok = await confirm({ targetName: po.poNumber, title: 'Xoá đơn hàng' });
        if (!ok) return;
        try {
            await poService.remove(po.id);
            setPos(await poService.list(effectiveId, constructionSiteId || null));
            toast.success('Xoá PO thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const updatePoItem = (index: number, patch: Partial<PurchaseOrderItem>) => {
        setPItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
    };

    const selectPoInventoryItem = (index: number, itemId: string) => {
        const selected = inventoryItems.find(item => item.id === itemId);
        updatePoItem(index, {
            itemId,
            sku: selected?.sku || '',
            name: selected?.name || '',
            unit: selected?.unit || '',
            unitPrice: selected?.priceIn || 0,
        });
    };

    const handleDownloadPoTemplate = async () => {
        const XLSX = await loadXlsx();
        const headers = [['Mã SKU *', 'Tên vật tư', 'ĐVT', 'Khối lượng đặt *', 'Đơn giá', 'Ngày cần', 'Ghi chú']];
        const sample = inventoryItems[0]
            ? [[inventoryItems[0].sku, inventoryItems[0].name, inventoryItems[0].unit, 10, inventoryItems[0].priceIn || 0, new Date().toISOString().split('T')[0], '']]
            : [];
        const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
        const wb = XLSX.utils.book_new();
        ws['!cols'] = [{ wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Nhap_moi');

        const updateWs = XLSX.utils.aoa_to_sheet([
            ['Mã SKU *', 'Khối lượng đặt', 'Đơn giá', 'Ngày cần', 'Ghi chú'],
            inventoryItems[0] ? [inventoryItems[0].sku, 20, inventoryItems[0].priceIn || 0, new Date().toISOString().split('T')[0], 'Cập nhật PO'] : ['STEEL-001', 20, 0, '', ''],
        ]);
        updateWs['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, updateWs, 'Cap_nhat');

        const guideWs = XLSX.utils.aoa_to_sheet([
            ['Chức năng', 'Cách dùng'],
            ['Nhập mới', 'Dùng sheet Nhap_moi để nạp danh sách vật tư vào PO đang tạo/sửa. SKU trùng trong PO sẽ báo lỗi.'],
            ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã SKU và cột muốn sửa. SKU phải đang có trong PO form.'],
            ['Ô trống', 'Trong chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
        ]);
        guideWs['!cols'] = [{ wch: 24 }, { wch: 100 }];
        XLSX.utils.book_append_sheet(wb, guideWs, 'Huong_dan');
        const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Vioo_PO_Template.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const buildPoImportPreview = (mode: ExcelImportMode, rows: Record<string, unknown>[]) => {
        const activeItems = pItems.map(item => normalizePoItem(item, inventoryItems)).filter(item => item.itemId);
        const inventoryBySku = (sku: string) => inventoryItems.find(item => item.sku.toLowerCase() === sku.trim().toLowerCase());
        return buildImportPreview<PurchaseOrderItem>({
            mode,
            keyLabel: 'Mã SKU',
            keyAliases: ['Mã SKU *', 'Mã SKU', 'SKU'],
            existingRecords: activeItems,
            getRecordKey: item => item.sku,
            validateKey: sku => inventoryBySku(sku) ? undefined : `SKU "${sku}" không tồn tại trong kho vật tư.`,
            createBaseRecord: sku => {
                const item = inventoryBySku(sku);
                return {
                    itemId: item?.id || '',
                    sku: item?.sku || sku,
                    name: item?.name || '',
                    unit: item?.unit || '',
                    qty: 0,
                    unitPrice: item?.priceIn || 0,
                    receivedQty: 0,
                    neededDate: '',
                    note: '',
                };
            },
            fields: [
                {
                    key: 'qty',
                    label: 'Khối lượng đặt',
                    aliases: ['Khối lượng đặt *', 'Khối lượng đặt', 'Số lượng', 'KL'],
                    requiredOnCreate: true,
                    normalize: value => Number(value) || 0,
                    validate: value => Number(value) > 0 ? undefined : 'Khối lượng đặt phải lớn hơn 0.',
                },
                {
                    key: 'unitPrice',
                    label: 'Đơn giá',
                    aliases: ['Đơn giá', 'Giá'],
                    normalize: value => Number(value) || 0,
                    validate: value => Number(value) >= 0 ? undefined : 'Đơn giá không hợp lệ.',
                },
                {
                    key: 'neededDate',
                    label: 'Ngày cần',
                    aliases: ['Ngày cần', 'Ngày giao', 'Ngày yêu cầu'],
                    normalize: value => normalizePoImportDate(value),
                    clearable: true,
                },
                {
                    key: 'note',
                    label: 'Ghi chú',
                    aliases: ['Ghi chú', 'Ghi chu', 'Note'],
                    clearable: true,
                },
            ],
        }, rows);
    };

    const openPoImport = (mode: ExcelImportMode) => {
        poImportModeRef.current = mode;
        setPoImportMode(mode);
    };

    const handleImportPoExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setImportingPo(true);
        try {
            const rows = await parseExcelRows(file, poImportModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
            const preview = buildPoImportPreview(poImportModeRef.current, rows);
            if (preview.totalRows === 0) {
                toast.warning('File Excel trống', 'Không có dòng vật tư hợp lệ để import.');
                return;
            }
            setPoImportPreview(preview);
        } catch (e: any) {
            logApiError('supplyChain.importPoExcel', e);
            toast.error('Không thể import Excel', getApiErrorMessage(e, 'Không thể đọc file Excel PO.'));
        } finally {
            setImportingPo(false);
        }
    };

    const handleConfirmPoImport = () => {
        if (!poImportPreview) return;
        const records = applyImportChanges(poImportPreview).map(item => normalizePoItem(item, inventoryItems));
        if (records.length === 0) {
            toast.warning('Không có dữ liệu cần ghi', 'File không có dòng PO hợp lệ để nạp.');
            return;
        }
        if (poImportPreview.mode === 'create') {
            setPItems(records);
        } else {
            setPItems(prev => prev.map(item => {
                const patch = records.find(record => record.sku.toLowerCase() === item.sku.toLowerCase());
                return patch ? normalizePoItem({ ...item, ...patch }, inventoryItems) : item;
            }));
        }
        toast.success(
            poImportPreview.mode === 'create' ? 'Đã nạp dòng PO' : 'Đã cập nhật dòng PO',
            `${records.length} dòng hợp lệ đã được đưa vào PO form.`
        );
        setPoImportPreview(null);
    };

    const escapeHtml = (value: unknown) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const handlePrintPo = async (po: PurchaseOrder) => {
        setPrintingPoId(po.id);
        try {
            const printablePo = await poService.ensureQrToken(po);
            if (!po.qrToken) {
                setPos(prev => prev.map(item => item.id === po.id ? printablePo : item));
            }
            const receiveUrl = buildPoReceiveUrl(printablePo.qrToken!);
            const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={132} level="H" includeMargin />);
            const targetWh = warehouses.find(w => w.id === printablePo.targetWarehouseId);
            const rowsHtml = printablePo.items.map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.sku)}</td>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(item.unit)}</td>
                    <td class="right">${Number(item.qty || 0).toLocaleString('vi-VN')}</td>
                    <td class="right">${Number(item.unitPrice || 0).toLocaleString('vi-VN')}</td>
                    <td>${escapeHtml(item.neededDate || printablePo.expectedDeliveryDate || '')}</td>
                    <td>${escapeHtml(item.note || '')}</td>
                </tr>
            `).join('');
            const html = `
                <!doctype html>
                <html>
                <head>
                    <meta charset="utf-8" />
                    <title>${escapeHtml(printablePo.poNumber)}</title>
                    <style>
                        body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
                        .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
                        h1 { margin: 0; font-size: 24px; letter-spacing: .02em; }
                        .meta { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13px; }
                        .label { color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 10px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 28px; font-size: 12px; }
                        th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
                        th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
                        .right { text-align: right; }
                        .qr { text-align: center; font-size: 10px; color: #64748b; font-weight: 700; }
                        .note { margin-top: 20px; font-size: 12px; color: #475569; }
                        @media print { body { margin: 18mm; } }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div>
                            <div class="label">Phiếu đặt hàng nhà cung cấp</div>
                            <h1>${escapeHtml(printablePo.poNumber)}</h1>
                            <div class="meta">
                                <div><div class="label">Nhà cung cấp</div>${escapeHtml(printablePo.vendorName || '')}</div>
                                <div><div class="label">Kho nhận</div>${escapeHtml(targetWh?.name || '')}</div>
                                <div><div class="label">Dự án/Công trường</div>${escapeHtml(printablePo.projectId || printablePo.constructionSiteId || '')}</div>
                                <div><div class="label">Ngày đặt</div>${escapeHtml(printablePo.orderDate)}</div>
                                <div><div class="label">Ngày cần</div>${escapeHtml(printablePo.expectedDeliveryDate || '')}</div>
                            </div>
                        </div>
                        <div class="qr">${qrSvg}<div>Quét QR để nhập kho</div></div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>STT</th>
                                <th>Mã hàng hoá</th>
                                <th>Tên hàng hoá</th>
                                <th>ĐVT</th>
                                <th>Khối lượng</th>
                                <th>Đơn giá</th>
                                <th>Ngày cần</th>
                                <th>Ghi chú</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                    ${printablePo.note ? `<div class="note"><strong>Ghi chú:</strong> ${escapeHtml(printablePo.note)}</div>` : ''}
                </body>
                </html>
            `;

            const printWindow = window.open('', '_blank', 'width=980,height=720');
            if (!printWindow) {
                toast.error('Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup in/PDF.');
                return;
            }
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 300);
        } catch (e: any) {
            logApiError('supplyChain.printPo', e);
            toast.error('Không thể in PO', getApiErrorMessage(e, 'Không thể tạo phiếu PO có QR.'));
        } finally {
            setPrintingPoId(null);
        }
    };

    // Stats
    const stats = useMemo(() => {
        const totalPo = pos.length;
        const totalValue = pos.reduce((s, p) => s + p.totalAmount, 0);
        const delivered = pos.filter(p => p.status === 'delivered').length;
        const pending = pos.filter(p => p.status === 'sent' || p.status === 'draft').length;
        return { vendorCount: vendors.length, totalPo, totalValue, delivered, pending };
    }, [vendors, pos]);

    const poTotalCalc = useMemo(() => pItems.reduce((s, i) => s + i.qty * i.unitPrice, 0), [pItems]);

    return (
        <div className="space-y-6">
            {poImportPreview && (
                <ExcelImportReviewModal
                    title={poImportPreview.mode === 'create' ? 'Preview nhập mới dòng PO' : 'Preview cập nhật dòng PO'}
                    preview={poImportPreview}
                    loading={importingPo}
                    onClose={() => setPoImportPreview(null)}
                    onConfirm={handleConfirmPoImport}
                />
            )}
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Cung ứng vật tư</h3>
                <AiInsightPanel module="supplychain" siteId={constructionSiteId} />
            </div>
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Users size={10} /> Nhà cung cấp</div>
                    <div className="text-2xl font-black text-slate-800">{stats.vendorCount}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><ShoppingCart size={10} /> Đơn hàng</div>
                    <div className="text-2xl font-black text-slate-800">{stats.totalPo}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Tổng: {fmt(stats.totalValue)} đ</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Truck size={10} /> Đã giao</div>
                    <div className="text-2xl font-black text-emerald-600">{stats.delivered}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Clock size={10} /> Chờ giao</div>
                    <div className="text-2xl font-black text-amber-600">{stats.pending}</div>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm overflow-x-auto [&::-webkit-scrollbar]:hidden">
                {[
                    { key: 'vendor' as const, label: '🏢 Nhà cung cấp', count: vendors.length },
                    { key: 'po' as const, label: '📄 Đơn hàng (PO)', count: pos.length },
                ].map(t => (
                    <button key={t.key} onClick={() => setSubTab(t.key)}
                        className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                            subTab === t.key ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                        }`}>
                        {t.label} {t.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${subTab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
                    </button>
                ))}
            </div>

            {/* Vendor Tab */}
            {subTab === 'vendor' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Users size={16} className="text-cyan-500" /> Danh sách NCC</h3>
                        <button onClick={() => { resetVendorForm(); setShowVendorForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-cyan-600 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100">
                            <Plus size={12} /> Thêm NCC
                        </button>
                    </div>
                    {vendors.length === 0 ? (
                        <div className="p-12 text-center">
                            <Users size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có nhà cung cấp</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {vendors.map(v => {
                                const vendorPos = pos.filter(p => p.vendorId === v.id);
                                const vendorValue = vendorPos.reduce((s, p) => s + p.totalAmount, 0);
                                return (
                                    <div key={v.id} className="px-5 py-4 hover:bg-slate-50/30 group">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-black shrink-0">
                                                    {v.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                        {v.name}
                                                        <span className="flex items-center gap-0.5">
                                                            {[1,2,3,4,5].map(s => (
                                                                <Star key={s} size={9} className={s <= v.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
                                                            ))}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                                                        {v.contact && <span className="flex items-center gap-0.5"><Users size={8} /> {v.contact}</span>}
                                                        <span className="flex items-center gap-0.5"><Phone size={8} /> {v.phone}</span>
                                                        {v.email && <span className="flex items-center gap-0.5"><Mail size={8} /> {v.email}</span>}
                                                    </div>
                                                    {v.categories.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {v.categories.map(c => (
                                                                <span key={c} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-600 border border-cyan-100">{c}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-right hidden md:block">
                                                    <div className="text-xs font-bold text-slate-700">{vendorPos.length} PO</div>
                                                    <div className="text-[10px] text-slate-400">{fmt(vendorValue)} đ</div>
                                                </div>
                                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                    <button onClick={() => openEditVendor(v)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                    <button onClick={() => handleDeleteVendor(v)}
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

            {/* PO Tab */}
            {subTab === 'po' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><FileText size={16} className="text-blue-500" /> Đơn đặt hàng (PO)</h3>
                        <div className="flex items-center gap-2">
                            <button onClick={handleDownloadPoTemplate}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100">
                                <FileSpreadsheet size={12} /> Mẫu Excel
                            </button>
                            <button onClick={() => { resetPoForm(); setPNum(`PO-${String(pos.length + 1).padStart(3, '0')}`); setShowPoForm(true); }}
                                disabled={vendors.length === 0 || inventoryItems.length === 0 || warehouses.length === 0}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                                <Plus size={12} /> Tạo PO
                            </button>
                        </div>
                    </div>
                    {vendors.length === 0 ? (
                        <div className="p-8 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-300" />
                            <p className="text-xs font-bold text-slate-400">Thêm NCC trước khi tạo đơn hàng</p>
                        </div>
                    ) : inventoryItems.length === 0 || warehouses.length === 0 ? (
                        <div className="p-8 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-300" />
                            <p className="text-xs font-bold text-slate-400">Cần có danh mục vật tư WMS và kho nhận trước khi tạo PO</p>
                        </div>
                    ) : pos.length === 0 ? (
                        <div className="p-12 text-center">
                            <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có đơn hàng</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {pos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(po => {
                                const stCfg = PO_STATUS[po.status];
                                const isExpanded = expandedPoId === po.id;
                                const targetWh = warehouses.find(w => w.id === po.targetWarehouseId);
                                return (
                                    <div key={po.id}>
                                        <div className="px-5 py-4 hover:bg-slate-50/30 group cursor-pointer"
                                            onClick={() => setExpandedPoId(isExpanded ? null : po.id)}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                                        <FileText size={14} className="text-blue-500" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                            {po.poNumber}
                                                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                                {stCfg.icon} {stCfg.label}
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                                            NCC: <span className="font-bold text-slate-500">{po.vendorName || '—'}</span>
                                                            {' • '}{new Date(po.orderDate).toLocaleDateString('vi-VN')}
                                                            {' • '}{po.items.length} mục
                                                            {targetWh && <>{' • '}Kho: <span className="font-bold text-slate-500">{targetWh.name}</span></>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <div className="text-right">
                                                        <div className="text-sm font-black text-slate-800">{fmt(po.totalAmount)} đ</div>
                                                        {po.expectedDeliveryDate && (
                                                            <div className="text-[9px] text-slate-400">
                                                                Giao: {new Date(po.expectedDeliveryDate).toLocaleDateString('vi-VN')}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Status actions */}
                                                    <div className="flex gap-1">
                                                        <button onClick={e => { e.stopPropagation(); handlePrintPo(po); }} title="In/PDF có QR"
                                                            disabled={printingPoId === po.id}
                                                            className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 disabled:opacity-50">
                                                            {printingPoId === po.id ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                                                        </button>
                                                        {po.status === 'draft' && (
                                                            <button onClick={e => { e.stopPropagation(); updatePoStatus(po.id, 'sent'); }} title="Gửi đơn"
                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent hover:border-amber-200"><Send size={13} /></button>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                        <button onClick={e => { e.stopPropagation(); openEditPo(po); }} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                        <button onClick={async e => { e.stopPropagation(); handleDeletePo(po); }}
                                                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                    </div>
                                                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Expanded items */}
                                        {isExpanded && (
                                            <div className="px-5 pb-4 bg-slate-50/30">
                                                <table className="w-full text-[11px]">
                                                    <thead>
                                                        <tr className="text-[9px] font-bold text-slate-400 uppercase">
                                                            <th className="text-left py-2 px-2">Vật tư</th>
                                                            <th className="text-center py-2 px-2">ĐVT</th>
                                                            <th className="text-right py-2 px-2">SL</th>
                                                            <th className="text-right py-2 px-2">Đã nhận</th>
                                                            <th className="text-right py-2 px-2">Đơn giá</th>
                                                            <th className="text-right py-2 px-2">Thành tiền</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {po.items.map((item, i) => (
                                                            <tr key={i}>
                                                                <td className="py-1.5 px-2 font-bold text-slate-700">
                                                                    {item.name}
                                                                    {item.sku && <div className="text-[9px] font-mono text-slate-400">{item.sku}</div>}
                                                                    {(item.neededDate || item.note) && <div className="text-[9px] text-slate-400 font-medium">{item.neededDate || ''}{item.neededDate && item.note ? ' • ' : ''}{item.note || ''}</div>}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-center text-slate-500">{item.unit}</td>
                                                                <td className="py-1.5 px-2 text-right text-slate-600">{item.qty.toLocaleString()}</td>
                                                                <td className="py-1.5 px-2 text-right text-emerald-600 font-bold">{(item.receivedQty || 0).toLocaleString()}</td>
                                                                <td className="py-1.5 px-2 text-right text-slate-500">{fmt(item.unitPrice)}</td>
                                                                <td className="py-1.5 px-2 text-right font-bold text-slate-700">{fmt(item.qty * item.unitPrice)} đ</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="font-black text-xs">
                                                            <td colSpan={5} className="py-2 px-2 text-right text-slate-600">TỔNG:</td>
                                                            <td className="py-2 px-2 text-right text-slate-800">{fmt(po.totalAmount)} đ</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                                {po.note && <div className="mt-2 px-2 text-[10px] text-slate-400 italic">💬 {po.note}</div>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Vendor Form Modal */}
            {showVendorForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingVendor ? <><Edit2 size={18} /> Sửa NCC</> : <><Plus size={18} /> Thêm NCC</>}
                            </span>
                            <button onClick={resetVendorForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên NCC *</label>
                                <input value={vName} onChange={e => setVName(e.target.value)} placeholder="VD: Công ty TNHH Xi măng ABC"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Người liên hệ</label>
                                    <input value={vContact} onChange={e => setVContact(e.target.value)} placeholder="Tên"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Điện thoại *</label>
                                    <input value={vPhone} onChange={e => setVPhone(e.target.value)} placeholder="0901..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Email</label>
                                    <input value={vEmail} onChange={e => setVEmail(e.target.value)} placeholder="email@..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mã số thuế</label>
                                    <input value={vTax} onChange={e => setVTax(e.target.value)} placeholder="MST"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Địa chỉ</label>
                                <input value={vAddress} onChange={e => setVAddress(e.target.value)} placeholder="Địa chỉ..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đánh giá</label>
                                <div className="flex gap-1">
                                    {[1,2,3,4,5].map(s => (
                                        <button key={s} onClick={() => setVRating(s)} className="p-1">
                                            <Star size={20} className={s <= vRating ? 'fill-amber-400 text-amber-400' : 'text-slate-200 hover:text-amber-300'} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại vật tư cung cấp</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {VENDOR_CATS.map(c => (
                                        <button key={c} onClick={() => setVCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${vCats.includes(c) ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={vNotes} onChange={e => setVNotes(e.target.value)} rows={2} placeholder="..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetVendorForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveVendor} disabled={!vName || !vPhone}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingVendor ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PO Form Modal */}
            {showPoForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingPo ? <><Edit2 size={18} /> Sửa PO</> : <><Plus size={18} /> Tạo đơn hàng</>}
                            </span>
                            <button onClick={savingPo ? undefined : resetPoForm} disabled={savingPo} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-50"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số PO</label>
                                    <input value={pNum} onChange={e => setPNum(e.target.value)} placeholder="PO-001"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nhà cung cấp *</label>
                                    <select value={pVendorId} onChange={e => setPVendorId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option value="">— Chọn NCC —</option>
                                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày đặt</label>
                                    <input type="date" value={pDate} onChange={e => setPDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày giao dự kiến</label>
                                    <input type="date" value={pExpDate} onChange={e => setPExpDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Kho nhận *</label>
                                    <select value={pTargetWarehouseId} onChange={e => setPTargetWarehouseId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option value="">— Chọn kho —</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                                    <span>Danh sách vật tư</span>
                                    <div className="flex items-center gap-2">
                                        <button onClick={handleDownloadPoTemplate}
                                            className="text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"><FileSpreadsheet size={10} /> Mẫu</button>
                                        <label onClick={() => openPoImport('create')} className={`text-blue-500 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer ${importingPo ? 'opacity-60 pointer-events-none' : ''}`}>
                                            {importingPo && poImportMode === 'create' ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} Nhập mới
                                            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportPoExcel} disabled={importingPo} />
                                        </label>
                                        <label onClick={() => openPoImport('update')} className={`text-violet-500 hover:text-violet-700 flex items-center gap-0.5 cursor-pointer ${importingPo ? 'opacity-60 pointer-events-none' : ''}`}>
                                            {importingPo && poImportMode === 'update' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCcw size={10} />} Cập nhật
                                            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportPoExcel} disabled={importingPo} />
                                        </label>
                                        <button onClick={() => setPItems([...pItems, createEmptyPoItem()])}
                                            className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5"><Plus size={10} /> Thêm dòng</button>
                                    </div>
                                </label>
                                <div className="space-y-2 mt-2">
                                    {pItems.map((item, i) => (
                                        <div key={i} className="grid grid-cols-12 gap-2 items-start rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                                            <select
                                                value={item.itemId}
                                                onChange={e => selectPoInventoryItem(i, e.target.value)}
                                                className="col-span-12 md:col-span-4 px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                            >
                                                <option value="">Chọn SKU vật tư...</option>
                                                {inventoryItems.map(inv => <option key={inv.id} value={inv.id}>{inv.sku} - {inv.name}</option>)}
                                            </select>
                                            <div className="col-span-4 md:col-span-1 px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 font-bold truncate">
                                                {item.unit || 'ĐVT'}
                                            </div>
                                            <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={item.qty || ''}
                                                onChange={e => updatePoItem(i, { qty: Number(e.target.value) || 0 })}
                                                placeholder="SL"
                                                className="col-span-4 md:col-span-1 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <input
                                                type="number"
                                                min={0}
                                                value={item.unitPrice || ''}
                                                onChange={e => updatePoItem(i, { unitPrice: Number(e.target.value) || 0 })}
                                                placeholder="Đơn giá"
                                                className="col-span-4 md:col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <input
                                                type="date"
                                                value={item.neededDate || ''}
                                                onChange={e => updatePoItem(i, { neededDate: e.target.value })}
                                                className="col-span-6 md:col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <input
                                                value={item.note || ''}
                                                onChange={e => updatePoItem(i, { note: e.target.value })}
                                                placeholder="Ghi chú"
                                                className="col-span-5 md:col-span-1 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <button
                                                onClick={() => setPItems(pItems.length > 1 ? pItems.filter((_, j) => j !== i) : [createEmptyPoItem()])}
                                                className="col-span-1 h-9 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {poTotalCalc > 0 && (
                                <div className="px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-xs flex items-center justify-between">
                                    <span className="text-blue-400">Tổng giá trị:</span>
                                    <span className="font-black text-blue-700 text-sm">{fmt(poTotalCalc)} đ</span>
                                </div>
                            )}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={pNote} onChange={e => setPNote(e.target.value)} rows={2} placeholder="..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetPoForm} disabled={savingPo} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">Huỷ</button>
                            <button onClick={handleSavePo} disabled={savingPo || !pVendorId || !pNum || !pTargetWarehouseId}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                {savingPo ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {savingPo ? (editingPo ? 'Đang lưu...' : 'Đang tạo...') : (editingPo ? 'Lưu' : 'Tạo')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupplyChainTab;
