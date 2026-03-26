
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
    Download, FileSpreadsheet, Calendar, Filter,
    CheckCircle2, Clock, ArrowDownLeft, ArrowUpRight,
    Package, Info, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';
import { TransactionType, TransactionStatus, Role } from '../types';
import * as XLSX from 'xlsx';

// ========================
// MISA Export Utility
// ========================

/**
 * Tạo file Excel chuẩn format "Nhập khẩu chứng từ Nhập kho" của MISA SME
 * Columns: Ngày CT | Số CT | Diễn giải | Mã kho | Mã VT | Tên VT | ĐVT | Số lượng | Đơn giá | Thành tiền | Mã NCC | Ghi chú
 */
function buildMisaImportSheet(rows: MisaImportRow[]) {
    // Header dòng 1 — Tiêu đề bảng chuẩn MISA
    const headers = [
        'Ngày chứng từ',
        'Số chứng từ',
        'Diễn giải',
        'Mã kho',
        'Tên kho',
        'Mã vật tư',
        'Tên vật tư',
        'ĐVT (kho)',
        'ĐVT (mua)',
        'Số lượng (kho)',
        'Số lượng (mua)',
        'Đơn giá (theo đ.vị mua)',
        'Thành tiền',
        'Mã nhà cung cấp',
        'Tên nhà cung cấp',
        'Ghi chú',
    ];

    const data = rows.map(r => [
        r.date,
        r.docNo,
        r.description,
        r.warehouseCode,
        r.warehouseName,
        r.itemCode,
        r.itemName,
        r.unit,
        r.purchaseUnit || r.unit,
        r.quantity,
        r.accountingQty ?? r.quantity,
        r.unitPrice,
        r.totalAmount,
        r.supplierCode || '',
        r.supplierName || '',
        r.note || '',
    ]);

    const sheetData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Style header row
    const colWidths = [14, 14, 30, 10, 20, 14, 30, 8, 8, 12, 12, 16, 16, 14, 25, 30];
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    return ws;
}

/**
 * Tạo file Excel chuẩn format "Nhập khẩu chứng từ Xuất kho" của MISA SME
 */
function buildMisaExportSheet(rows: MisaExportRow[]) {
    const headers = [
        'Ngày chứng từ',
        'Số chứng từ',
        'Diễn giải',
        'Mã kho xuất',
        'Tên kho xuất',
        'Mã kho nhận',
        'Tên kho nhận',
        'Mã vật tư',
        'Tên vật tư',
        'ĐVT',
        'Số lượng',
        'Đơn giá xuất',
        'Thành tiền',
        'Lý do xuất',
        'Ghi chú',
    ];

    const data = rows.map(r => [
        r.date,
        r.docNo,
        r.description,
        r.sourceWarehouseCode,
        r.sourceWarehouseName,
        r.targetWarehouseCode || '',
        r.targetWarehouseName || '',
        r.itemCode,
        r.itemName,
        r.unit,
        r.quantity,
        r.unitPrice,
        r.totalAmount,
        r.reason || '',
        r.note || '',
    ]);

    const sheetData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const colWidths = [14, 14, 30, 10, 20, 10, 20, 14, 30, 8, 10, 14, 14, 20, 30];
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    return ws;
}

// ========================
// Types
// ========================
interface MisaImportRow {
    date: string;
    docNo: string;
    description: string;
    warehouseCode: string;
    warehouseName: string;
    itemCode: string;
    itemName: string;
    unit: string;
    purchaseUnit?: string;
    quantity: number;
    accountingQty?: number;
    unitPrice: number;
    totalAmount: number;
    supplierCode?: string;
    supplierName?: string;
    note?: string;
}

interface MisaExportRow {
    date: string;
    docNo: string;
    description: string;
    sourceWarehouseCode: string;
    sourceWarehouseName: string;
    targetWarehouseCode?: string;
    targetWarehouseName?: string;
    itemCode: string;
    itemName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    reason?: string;
    note?: string;
}

// ========================
// Main Component
// ========================
const MisaExport: React.FC = () => {
    const { items, transactions, warehouses, suppliers, user } = useApp();

    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = (() => {
        const d = new Date();
        d.setDate(1);
        return d.toISOString().split('T')[0];
    })();

    const [startDate, setStartDate] = useState(firstOfMonth);
    const [endDate, setEndDate] = useState(today);
    const [selectedWh, setSelectedWh] = useState('ALL');
    const [exportType, setExportType] = useState<'IMPORT' | 'EXPORT' | 'BOTH'>('BOTH');
    const [expandedTx, setExpandedTx] = useState<string | null>(null);

    const isAdmin = user.role === Role.ADMIN;
    const canExport = isAdmin;

    // Lọc giao dịch dùng để export
    const filteredTx = useMemo(() => {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        return transactions.filter(tx => {
            if (tx.status !== TransactionStatus.COMPLETED) return false;
            const txDate = new Date(tx.date);
            if (txDate < start || txDate > end) return false;

            // Lọc loại phiếu
            if (exportType === 'IMPORT' && tx.type !== TransactionType.IMPORT) return false;
            if (exportType === 'EXPORT' && tx.type !== TransactionType.EXPORT && tx.type !== TransactionType.LIQUIDATION) return false;

            // Lọc kho
            if (selectedWh !== 'ALL') {
                const isRelated = tx.targetWarehouseId === selectedWh || tx.sourceWarehouseId === selectedWh;
                if (!isRelated) return false;
            }

            return true;
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [transactions, startDate, endDate, selectedWh, exportType]);

    // Thống kê nhanh
    const stats = useMemo(() => {
        const importTxs = filteredTx.filter(t => t.type === TransactionType.IMPORT);
        const exportTxs = filteredTx.filter(t => t.type === TransactionType.EXPORT || t.type === TransactionType.LIQUIDATION);

        const totalImportValue = importTxs.reduce((sum, tx) =>
            sum + tx.items.reduce((s, ti) => {
                const totalAmt = ti.accountingQty && ti.accountingPrice
                    ? ti.accountingQty * ti.accountingPrice
                    : ti.quantity * (ti.price || 0);
                return s + totalAmt;
            }, 0), 0);

        const totalExportQty = exportTxs.reduce((sum, tx) =>
            sum + tx.items.reduce((s, ti) => s + ti.quantity, 0), 0);

        return {
            importCount: importTxs.length,
            exportCount: exportTxs.length,
            totalLines: filteredTx.reduce((s, tx) => s + tx.items.length, 0),
            totalImportValue,
            totalExportQty,
        };
    }, [filteredTx]);

    // Build MISA Import rows
    const buildImportRows = (): MisaImportRow[] => {
        return transactions
            .filter(tx => tx.status === TransactionStatus.COMPLETED && tx.type === TransactionType.IMPORT)
            .filter(tx => {
                const d = new Date(tx.date);
                d.setHours(0, 0, 0, 0);
                const start = new Date(startDate); start.setHours(0, 0, 0, 0);
                const end = new Date(endDate); end.setHours(23, 59, 59, 999);
                if (d < start || d > end) return false;
                if (selectedWh !== 'ALL' && tx.targetWarehouseId !== selectedWh) return false;
                return true;
            })
            .flatMap((tx, idx) => {
                const wh = warehouses.find(w => w.id === tx.targetWarehouseId);
                const supplier = suppliers.find(s => s.id === tx.supplierId);
                const docNo = `NK-${String(idx + 1).padStart(4, '0')}`;
                const dateStr = new Date(tx.date).toLocaleDateString('vi-VN');

                return tx.items.map(ti => {
                    const item = items.find(i => i.id === ti.itemId);
                    // Nếu có dữ liệu kế toán (dual unit: KG)
                    const hasAccounting = ti.accountingQty && ti.accountingPrice && ti.accountingUnit;
                    const unitPrice = hasAccounting ? ti.accountingPrice! : (ti.price || item?.priceIn || 0);
                    const totalAmount = hasAccounting
                        ? ti.accountingQty! * ti.accountingPrice!
                        : ti.quantity * unitPrice;

                    return {
                        date: dateStr,
                        docNo,
                        description: `Nhập kho${supplier ? ` - ${supplier.name}` : ''}: ${item?.name || ti.itemId}`,
                        warehouseCode: wh?.id?.slice(-6).toUpperCase() || 'KHO',
                        warehouseName: wh?.name || '',
                        itemCode: item?.sku || ti.itemId,
                        itemName: item?.name || ti.itemId,
                        unit: item?.unit || '',
                        purchaseUnit: item?.purchaseUnit,
                        quantity: ti.quantity,
                        accountingQty: ti.accountingQty,
                        unitPrice,
                        totalAmount,
                        supplierCode: supplier?.id?.slice(-6).toUpperCase(),
                        supplierName: supplier?.name,
                        note: tx.note || '',
                    } as MisaImportRow;
                });
            });
    };

    // Build MISA Export rows
    const buildExportRows = (): MisaExportRow[] => {
        return transactions
            .filter(tx =>
                tx.status === TransactionStatus.COMPLETED &&
                (tx.type === TransactionType.EXPORT || tx.type === TransactionType.LIQUIDATION || tx.type === TransactionType.TRANSFER)
            )
            .filter(tx => {
                const d = new Date(tx.date);
                d.setHours(0, 0, 0, 0);
                const start = new Date(startDate); start.setHours(0, 0, 0, 0);
                const end = new Date(endDate); end.setHours(23, 59, 59, 999);
                if (d < start || d > end) return false;
                if (selectedWh !== 'ALL') {
                    if (tx.sourceWarehouseId !== selectedWh && tx.targetWarehouseId !== selectedWh) return false;
                }
                return true;
            })
            .flatMap((tx, idx) => {
                const srcWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
                const tgtWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                const docNo = `XK-${String(idx + 1).padStart(4, '0')}`;
                const dateStr = new Date(tx.date).toLocaleDateString('vi-VN');
                const reason = tx.type === TransactionType.LIQUIDATION ? 'Xuất hủy / Thanh lý'
                    : tx.type === TransactionType.TRANSFER ? 'Chuyển kho nội bộ'
                        : 'Xuất dùng công trình';

                return tx.items.map(ti => {
                    const item = items.find(i => i.id === ti.itemId);
                    const unitPrice = ti.price || item?.priceOut || 0;
                    return {
                        date: dateStr,
                        docNo,
                        description: `${reason}: ${item?.name || ti.itemId}`,
                        sourceWarehouseCode: srcWh?.id?.slice(-6).toUpperCase() || 'KHO',
                        sourceWarehouseName: srcWh?.name || '',
                        targetWarehouseCode: tgtWh?.id?.slice(-6).toUpperCase(),
                        targetWarehouseName: tgtWh?.name,
                        itemCode: item?.sku || ti.itemId,
                        itemName: item?.name || ti.itemId,
                        unit: item?.unit || '',
                        quantity: ti.quantity,
                        unitPrice,
                        totalAmount: ti.quantity * unitPrice,
                        reason,
                        note: tx.note || '',
                    } as MisaExportRow;
                });
            });
    };

    const handleExport = () => {
        const wb = XLSX.utils.book_new();

        if (exportType === 'IMPORT' || exportType === 'BOTH') {
            const rows = buildImportRows();
            if (rows.length > 0) {
                const ws = buildMisaImportSheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, 'NK - Nhập kho');
            }
        }

        if (exportType === 'EXPORT' || exportType === 'BOTH') {
            const rows = buildExportRows();
            if (rows.length > 0) {
                const ws = buildMisaExportSheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, 'XK - Xuất kho');
            }
        }

        if (wb.SheetNames.length === 0) {
            alert('Không có dữ liệu phù hợp trong khoảng thời gian đã chọn!');
            return;
        }

        const fileName = `MISA_${exportType}_${startDate}_${endDate}.xlsx`;
        const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const txTypeLabel = (type: TransactionType) => {
        switch (type) {
            case TransactionType.IMPORT: return { label: 'Nhập kho', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
            case TransactionType.EXPORT: return { label: 'Xuất kho', color: 'bg-orange-50 text-orange-700 border-orange-200' };
            case TransactionType.TRANSFER: return { label: 'Chuyển kho', color: 'bg-blue-50 text-blue-700 border-blue-200' };
            case TransactionType.LIQUIDATION: return { label: 'Xuất hủy', color: 'bg-red-50 text-red-700 border-red-200' };
            default: return { label: 'Khác', color: 'bg-slate-50 text-slate-700 border-slate-200' };
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <div className="p-2 bg-green-100 rounded-xl text-green-700">
                            <FileSpreadsheet size={24} />
                        </div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Đồng bộ sang MISA</h1>
                    </div>
                    <p className="text-sm text-slate-500 font-medium pl-1">
                        Xuất file Excel chuẩn MISA SME để kế toán nhập khẩu chứng từ vào phần mềm.
                    </p>
                </div>

                <button
                    onClick={handleExport}
                    disabled={!canExport || filteredTx.length === 0}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-black text-sm shadow-lg shadow-green-500/25 hover:bg-green-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Download size={18} />
                    Tải file Excel chuẩn MISA
                </button>
            </div>

            {/* Hướng dẫn sử dụng */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                    <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <p className="font-black mb-2">📋 Hướng dẫn nhập vào MISA SME:</p>
                        <ol className="list-decimal list-inside space-y-1 font-medium text-blue-700">
                            <li>Chọn khoảng thời gian và loại phiếu cần xuất → Bấm <strong>"Tải file Excel chuẩn MISA"</strong></li>
                            <li>Mở phần mềm MISA SME → Vào <strong>Kho → Nhập kho</strong> (hoặc <strong>Xuất kho</strong>)</li>
                            <li>Bấm nút <strong>"Nhập khẩu"</strong> (hoặc biểu tượng Excel trên thanh công cụ)</li>
                            <li>Chọn file Excel vừa tải về → MISA tự động đọc và tạo chứng từ hàng loạt</li>
                            <li>Kiểm tra lại từng chứng từ → Bấm <strong>"Ghi sổ"</strong> khi xác nhận đúng</li>
                        </ol>
                    </div>
                </div>
            </div>

            {!canExport && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 text-amber-800 text-sm font-bold">
                    <AlertTriangle size={16} className="text-amber-500" />
                    Chức năng này chỉ dành cho Admin và Kế toán.
                </div>
            )}

            {/* Filter Bar */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Filter size={12} /> Bộ lọc dữ liệu xuất
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Khoảng thời gian */}
                    <div className="space-y-1.5 md:col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                            <Calendar size={10} className="mr-1" /> Kỳ xuất dữ liệu
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                            />
                            <span className="text-slate-400 font-bold text-sm">→</span>
                            <input
                                type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                            />
                        </div>
                    </div>

                    {/* Kho */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kho</label>
                        <select
                            value={selectedWh} onChange={e => setSelectedWh(e.target.value)}
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                        >
                            <option value="ALL">Tất cả kho</option>
                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                    </div>

                    {/* Loại phiếu */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loại phiếu</label>
                        <select
                            value={exportType} onChange={e => setExportType(e.target.value as any)}
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                        >
                            <option value="BOTH">Tất cả (NK + XK)</option>
                            <option value="IMPORT">Chỉ Nhập kho (NK)</option>
                            <option value="EXPORT">Chỉ Xuất kho (XK)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Phiếu Nhập</div>
                    <div className="text-2xl font-black text-emerald-600">{stats.importCount}</div>
                    <div className="text-[10px] text-slate-400 font-medium">chứng từ</div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Phiếu Xuất</div>
                    <div className="text-2xl font-black text-orange-600">{stats.exportCount}</div>
                    <div className="text-[10px] text-slate-400 font-medium">chứng từ</div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Tổng dòng</div>
                    <div className="text-2xl font-black text-accent">{stats.totalLines}</div>
                    <div className="text-[10px] text-slate-400 font-medium">dòng vật tư</div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-black text-slate-400 uppercase mb-1">GT Nhập</div>
                    <div className="text-lg font-black text-slate-800">{stats.totalImportValue.toLocaleString('vi-VN')}</div>
                    <div className="text-[10px] text-slate-400 font-medium">₫ (kế toán)</div>
                </div>
            </div>

            {/* Preview Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-black text-slate-800 text-sm flex items-center gap-2">
                        <Package size={16} className="text-slate-400" />
                        Xem trước dữ liệu sẽ xuất
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {filteredTx.length} chứng từ
                        </span>
                    </h3>
                    {filteredTx.length > 0 && (
                        <span className="text-[10px] text-emerald-600 font-black flex items-center gap-1">
                            <CheckCircle2 size={12} /> Sẵn sàng xuất
                        </span>
                    )}
                </div>

                {filteredTx.length === 0 ? (
                    <div className="p-16 text-center">
                        <Clock size={40} className="mx-auto text-slate-200 mb-3" />
                        <p className="text-slate-400 font-bold">Không có chứng từ nào trong khoảng thời gian đã chọn</p>
                        <p className="text-slate-300 text-sm">Chỉ lấy các phiếu đã được <strong>Hoàn thành</strong></p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filteredTx.map(tx => {
                            const badge = txTypeLabel(tx.type);
                            const srcWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
                            const tgtWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                            const isExpanded = expandedTx === tx.id;

                            // Tính tổng tiền kế toán của phiếu
                            const txTotal = tx.items.reduce((sum, ti) => {
                                const hasAccounting = ti.accountingQty && ti.accountingPrice;
                                return sum + (hasAccounting
                                    ? ti.accountingQty! * ti.accountingPrice!
                                    : ti.quantity * (ti.price || 0));
                            }, 0);

                            return (
                                <div key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                                    {/* Row header */}
                                    <div
                                        className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                                        onClick={() => setExpandedTx(isExpanded ? null : tx.id)}
                                    >
                                        <div className={`text-[10px] font-black px-2 py-1 rounded-lg border ${badge.color} whitespace-nowrap`}>
                                            {badge.label}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-black text-slate-700">
                                                {new Date(tx.date).toLocaleDateString('vi-VN')}
                                                <span className="text-slate-400 font-normal ml-2">{tx.note || '(Không có ghi chú)'}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-medium flex items-center gap-2 mt-0.5">
                                                {tgtWh && <span className="text-emerald-600 font-bold">→ {tgtWh.name}</span>}
                                                {srcWh && <span className="text-orange-600 font-bold">{srcWh.name} →</span>}
                                                <span>{tx.items.length} vật tư</span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            {txTotal > 0 && (
                                                <div className="text-xs font-black text-slate-800">
                                                    {txTotal.toLocaleString('vi-VN')} ₫
                                                </div>
                                            )}
                                            <div className="text-slate-300 mt-1">
                                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded items */}
                                    {isExpanded && (
                                        <div className="px-4 pb-3 animate-in slide-in-from-top-1 duration-150">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="text-[10px] uppercase font-black text-slate-400 border-b border-slate-100">
                                                        <th className="py-2 text-left">Mã SKU</th>
                                                        <th className="py-2 text-left">Tên vật tư</th>
                                                        <th className="py-2 text-right">SL (kho)</th>
                                                        <th className="py-2 text-right">SL (kế toán)</th>
                                                        <th className="py-2 text-right">Đơn giá</th>
                                                        <th className="py-2 text-right">Thành tiền</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {tx.items.map((ti, idx) => {
                                                        const item = items.find(i => i.id === ti.itemId);
                                                        const hasAccounting = ti.accountingQty && ti.accountingPrice && ti.accountingUnit;
                                                        const unitPrice = ti.accountingPrice || ti.price || item?.priceIn || 0;
                                                        const total = hasAccounting
                                                            ? ti.accountingQty! * ti.accountingPrice!
                                                            : ti.quantity * unitPrice;

                                                        return (
                                                            <tr key={idx} className="hover:bg-slate-50">
                                                                <td className="py-1.5 font-mono text-slate-400 text-[10px]">{item?.sku}</td>
                                                                <td className="py-1.5 font-medium text-slate-700">{item?.name || ti.itemId}</td>
                                                                <td className="py-1.5 text-right font-bold text-slate-600">
                                                                    {ti.quantity.toLocaleString()} {item?.unit}
                                                                </td>
                                                                <td className="py-1.5 text-right font-bold text-amber-600">
                                                                    {hasAccounting ? (
                                                                        <>{ti.accountingQty!.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ti.accountingUnit}</>
                                                                    ) : (
                                                                        <span className="text-slate-300">—</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-1.5 text-right text-slate-500">
                                                                    {unitPrice > 0 ? `${unitPrice.toLocaleString('vi-VN')} ₫` : '—'}
                                                                </td>
                                                                <td className="py-1.5 text-right font-black text-slate-800">
                                                                    {total > 0 ? `${total.toLocaleString('vi-VN')} ₫` : '—'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer note */}
            <div className="text-center text-xs text-slate-400 font-medium pb-4">
                💡 File Excel xuất ra sẽ có 2 sheet: <strong>NK - Nhập kho</strong> và <strong>XK - Xuất kho</strong>.
                Kế toán dùng từng sheet tương ứng để nhập vào MISA.
            </div>
        </div>
    );
};

export default MisaExport;
