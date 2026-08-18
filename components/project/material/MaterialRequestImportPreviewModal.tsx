import React, { useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    Info,
    Loader2,
    SlidersHorizontal,
    X,
    XCircle,
} from 'lucide-react';
import type {
    MaterialRequestImportGroup,
    MaterialRequestImportPreview,
    MaterialRequestImportRow,
} from '../../../lib/materialRequestImportService';
import type { Warehouse } from '../../../types';

type MaterialRequestImportPreviewModalProps = {
    importPreview: MaterialRequestImportPreview;
    isImporting: boolean;
    warehouses: Warehouse[];
    defaultSiteWarehouseId?: string;
    onCancel: () => void;
    onOpenColumnMapping?: () => void;
    onConfirm: (
        validRows: MaterialRequestImportRow[],
        importGroups: MaterialRequestImportGroup[],
        selectedSiteWarehouseId: string
    ) => void;
};

type FilterTab = 'all' | 'error' | 'warning' | 'valid';

export const MaterialRequestImportPreviewModal: React.FC<MaterialRequestImportPreviewModalProps> = ({
    importPreview,
    isImporting,
    warehouses,
    defaultSiteWarehouseId,
    onCancel,
    onOpenColumnMapping,
    onConfirm,
}) => {
    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [skipErrorRows, setSkipErrorRows] = useState(true);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(
        defaultSiteWarehouseId || (warehouses[0]?.id ?? '')
    );

    // Calculate row lists based on activeTab
    const filteredRows = useMemo(() => {
        if (activeTab === 'error') {
            return importPreview.rows.filter(r => r.status === 'error');
        }
        if (activeTab === 'warning') {
            return importPreview.rows.filter(r => r.status === 'warning');
        }
        if (activeTab === 'valid') {
            return importPreview.rows.filter(r => r.status === 'valid');
        }
        return importPreview.rows;
    }, [importPreview.rows, activeTab]);

    // Rows eligible for importing (valid + warning, or only non-error rows when skipErrorRows is checked)
    const importableRows = useMemo(() => {
        if (skipErrorRows) {
            return importPreview.rows.filter(r => r.status !== 'error');
        }
        return importPreview.errorRowsCount === 0 ? importPreview.rows : [];
    }, [importPreview.rows, importPreview.errorRowsCount, skipErrorRows]);

    const canSubmit = importableRows.length > 0 && !isImporting;

    const handleConfirm = () => {
        if (!canSubmit) return;

        const groupMap = new Map<string, MaterialRequestImportRow[]>();
        importableRows.forEach(row => {
            const key = row.requestCode || 'Phiếu đề xuất mới';
            if (!groupMap.has(key)) groupMap.set(key, []);
            groupMap.get(key)!.push(row);
        });

        const importGroups: MaterialRequestImportGroup[] = Array.from(groupMap.entries()).map(
            ([requestCode, rows]) => ({
                requestCode,
                requestTitle:
                    requestCode === 'Phiếu đề xuất mới'
                        ? 'Đề xuất vật tư nhập từ Excel'
                        : `Đề xuất vật tư ${requestCode}`,
                rows,
                validRowsCount: rows.filter(r => r.status === 'valid').length,
                warningRowsCount: rows.filter(r => r.status === 'warning').length,
                errorRowsCount: rows.filter(r => r.status === 'error').length,
            })
        );

        onConfirm(importableRows, importGroups, selectedWarehouseId);
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-800/40">
                    <div className="flex items-center space-x-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold">
                            <FileSpreadsheet size={22} />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white uppercase tracking-wider">
                                    Bước 2 / 2
                                </span>
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">
                                    Xem trước & Kiểm tra Lỗi
                                </h3>
                            </div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                File: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{importPreview.fileName}</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2">
                        {onOpenColumnMapping && (
                            <button
                                type="button"
                                onClick={onOpenColumnMapping}
                                className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 transition-all"
                                title="Quay lại Bước 1 để điều chỉnh lại tên cột Excel"
                            >
                                <SlidersHorizontal size={14} /> Sửa khớp cột
                            </button>
                        )}

                        <button
                            onClick={onCancel}
                            disabled={isImporting}
                            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Summary Metrics & Warehouse selection */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex flex-col justify-center rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3.5">
                        <span className="text-[10px] font-black uppercase text-slate-400">Tổng số dòng</span>
                        <span className="text-xl font-black text-slate-800 dark:text-slate-100">{importPreview.totalRows}</span>
                        <span className="text-[11px] font-medium text-slate-500">{importPreview.groups.length} phiếu đề xuất</span>
                    </div>

                    <div className="flex flex-col justify-center rounded-2xl border border-emerald-100 dark:border-emerald-950 bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5">
                        <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 flex items-center">
                            <CheckCircle2 size={12} className="mr-1" /> Hợp lệ
                        </span>
                        <span className="text-xl font-black text-emerald-700 dark:text-emerald-300">{importPreview.validRowsCount}</span>
                        <span className="text-[11px] font-medium text-emerald-600/80">Sẵn sàng nhập</span>
                    </div>

                    <div className="flex flex-col justify-center rounded-2xl border border-amber-100 dark:border-amber-950 bg-amber-50/50 dark:bg-amber-950/30 p-3.5">
                        <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400 flex items-center">
                            <AlertTriangle size={12} className="mr-1" /> Cảnh báo / Vượt BOQ
                        </span>
                        <span className="text-xl font-black text-amber-700 dark:text-amber-300">{importPreview.warningRowsCount}</span>
                        <span className="text-[11px] font-medium text-amber-600/80">Có thể nhập</span>
                    </div>

                    <div className="flex flex-col justify-center rounded-2xl border border-red-100 dark:border-red-950 bg-red-50/50 dark:bg-red-950/30 p-3.5">
                        <span className="text-[10px] font-black uppercase text-red-600 dark:text-red-400 flex items-center">
                            <XCircle size={12} className="mr-1" /> Lỗi chặn
                        </span>
                        <span className="text-xl font-black text-red-700 dark:text-red-300">{importPreview.errorRowsCount}</span>
                        <span className="text-[11px] font-medium text-red-600/80">Cần bỏ qua / sửa file</span>
                    </div>

                    {/* Warehouse selection fallback */}
                    <div className="flex flex-col justify-between rounded-2xl border border-indigo-100 dark:border-indigo-950 bg-indigo-50/40 dark:bg-indigo-950/20 p-3.5">
                        <label className="text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400">
                            Kho công trường nhận:
                        </label>
                        <select
                            value={selectedWarehouseId}
                            onChange={e => setSelectedWarehouseId(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 py-1.5 px-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {warehouses.map(wh => (
                                <option key={wh.id} value={wh.id}>
                                    {wh.name}
                                </option>
                            ))}
                            {warehouses.length === 0 && <option value="">Kho mặc định</option>}
                        </select>
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-2 bg-slate-50/30 dark:bg-slate-800/20">
                    <div className="flex space-x-1">
                        <button
                            onClick={() => setActiveTab('all')}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                activeTab === 'all'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700'
                            }`}
                        >
                            Tất cả ({importPreview.totalRows})
                        </button>
                        <button
                            onClick={() => setActiveTab('error')}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                activeTab === 'error'
                                    ? 'bg-red-600 text-white shadow-sm'
                                    : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                            }`}
                        >
                            Chỉ dòng lỗi ({importPreview.errorRowsCount})
                        </button>
                        <button
                            onClick={() => setActiveTab('warning')}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                activeTab === 'warning'
                                    ? 'bg-amber-500 text-white shadow-sm'
                                    : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                            }`}
                        >
                            Cảnh báo ({importPreview.warningRowsCount})
                        </button>
                        <button
                            onClick={() => setActiveTab('valid')}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                activeTab === 'valid'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                            }`}
                        >
                            Hợp lệ ({importPreview.validRowsCount})
                        </button>
                    </div>

                    <div className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            id="skipErrorRows"
                            checked={skipErrorRows}
                            onChange={e => setSkipErrorRows(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="skipErrorRows" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                            Tự động bỏ qua các dòng bị lỗi khi bấm nhập
                        </label>
                    </div>
                </div>

                {/* Table Content */}
                <div className="flex-1 overflow-auto p-5">
                    {filteredRows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <Info size={32} className="mb-2 text-slate-300" />
                            <p className="text-sm font-bold">Không có dòng nào thuộc bộ lọc này</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 shadow-sm">
                                <tr>
                                    <th className="px-3 py-2.5 rounded-l-xl">Dòng</th>
                                    <th className="px-3 py-2.5">Phiếu đề xuất</th>
                                    <th className="px-3 py-2.5">SKU / Mã VT</th>
                                    <th className="px-3 py-2.5">Tên vật tư</th>
                                    <th className="px-3 py-2.5">Quy cách/mô tả</th>
                                    <th className="px-3 py-2.5">ĐVT</th>
                                    <th className="px-3 py-2.5 text-right">SL đề xuất</th>
                                    <th className="px-3 py-2.5">Ngày cần</th>
                                    <th className="px-3 py-2.5">Mã WBS / BOQ</th>
                                    <th className="px-3 py-2.5">Kho nhận</th>
                                    <th className="px-3 py-2.5 rounded-r-xl">Trạng thái & Chi tiết Lỗi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {filteredRows.map(row => {
                                    const isError = row.status === 'error';
                                    const isWarning = row.status === 'warning';

                                    return (
                                        <tr
                                            key={`row-${row.rowNumber}`}
                                            className={`transition-colors ${
                                                isError
                                                    ? 'bg-red-50/70 dark:bg-red-950/30 text-red-900 dark:text-red-200'
                                                    : isWarning
                                                    ? 'bg-amber-50/60 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                                                    : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                                            }`}
                                        >
                                            <td className="px-3 py-3 font-mono font-bold text-slate-400">{row.rowNumber}</td>
                                            <td className="px-3 py-3">
                                                <span className="inline-block rounded-lg bg-indigo-100/70 dark:bg-indigo-950/80 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                                                    {row.requestCode}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 font-mono text-slate-600 dark:text-slate-400">
                                                {row.materialCode || '-'}
                                            </td>
                                            <td className="px-3 py-3 font-bold">
                                                {row.materialName || <span className="italic text-red-500">(Thiếu tên)</span>}
                                                {row.matchedInventoryItem && (
                                                    <div className="mt-0.5 text-[10px] font-medium text-slate-400">
                                                        Danh mục: {row.matchedInventoryItem.sku} — {row.matchedInventoryItem.name}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-slate-500">{row.specification || '-'}</td>
                                            <td className="px-3 py-3 text-slate-500">{row.unit || '-'}</td>
                                            <td className="px-3 py-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400 text-sm">
                                                {row.requestQty > 0 ? row.requestQty.toLocaleString('vi-VN') : <span className="text-red-500 font-bold">{row.requestQty}</span>}
                                            </td>
                                            <td className="px-3 py-3 text-slate-500 font-mono text-[11px]">
                                                {row.neededDate || '-'}
                                            </td>
                                            <td className="px-3 py-3">
                                                {row.wbsCode ? (
                                                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                                                        {row.wbsCode}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">-</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-slate-500 text-[11px]">
                                                {row.siteWarehouseName || 'Mặc định'}
                                            </td>
                                            <td className="px-3 py-3">
                                                {isError && (
                                                    <div className="space-y-1 text-red-600 dark:text-red-400 font-bold">
                                                        {row.errors.map((err, errIdx) => (
                                                            <div key={errIdx} className="flex items-center">
                                                                <XCircle size={13} className="mr-1.5 flex-shrink-0" />
                                                                <span>{err}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {isWarning && (
                                                    <div className="space-y-1 text-amber-600 dark:text-amber-400 font-bold">
                                                        {row.warnings.map((warn, warnIdx) => (
                                                            <div key={warnIdx} className="flex items-center">
                                                                <AlertTriangle size={13} className="mr-1.5 flex-shrink-0" />
                                                                <span>{warn}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {!isError && !isWarning && (
                                                    <div className="flex items-center text-emerald-600 dark:text-emerald-400 font-bold">
                                                        <CheckCircle2 size={13} className="mr-1.5 flex-shrink-0" />
                                                        <span>Hợp lệ</span>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-800/40">
                    <div className="text-xs font-bold text-slate-500">
                        Sẽ nhập <span className="font-mono text-indigo-600 dark:text-indigo-400 text-sm">{importableRows.length}</span> dòng hợp lệ vào hệ thống
                    </div>

                    <div className="flex items-center space-x-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isImporting}
                            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={!canSubmit}
                            className="flex items-center rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 disabled:shadow-none transition-all"
                        >
                            {isImporting ? (
                                <>
                                    <Loader2 size={16} className="mr-2 animate-spin" /> Đang tạo phiếu đề xuất...
                                </>
                            ) : (
                                <>
                                    <Download size={16} className="mr-2" /> Xác nhận nhập ({importableRows.length} dòng)
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
