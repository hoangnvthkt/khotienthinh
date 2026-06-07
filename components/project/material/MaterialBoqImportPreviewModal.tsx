import React from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import type { ProjectWorkBoqItem } from '../../../types';
import type { WorkBoqImportPreview } from '../../../lib/projectMaterialTabUtils';

type MaterialBoqImportPreviewModalProps = {
    importPreview: WorkBoqImportPreview;
    workBoqItems: ProjectWorkBoqItem[];
    importingBoq: boolean;
    canEditBoq: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    formatQuantity: (value: number) => string;
    formatMoneyShort: (value: number) => string;
};

export const MaterialBoqImportPreviewModal: React.FC<MaterialBoqImportPreviewModalProps> = ({
    importPreview,
    workBoqItems,
    importingBoq,
    canEditBoq,
    onCancel,
    onConfirm,
    formatQuantity,
    formatMoneyShort,
}) => {
    const allRows = [...importPreview.workRows, ...importPreview.materialRows];
    const validRowsEmpty = allRows.every(row => row.status === 'error');

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div>
                        <h3 className="text-lg font-black text-slate-800">Preview import BOQ triển khai</h3>
                        <p className="mt-0.5 text-xs font-bold text-slate-400">
                            {importPreview.workRows.length} đầu mục • {importPreview.materialRows.length} vật tư • {allRows.filter(row => row.status === 'error').length} lỗi
                        </p>
                    </div>
                    <button onClick={onCancel} disabled={importingBoq} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
                        <X size={18} />
                    </button>
                </div>
                <div className="flex-1 space-y-5 overflow-auto p-5">
                    <div>
                        <h4 className="mb-2 text-xs font-black uppercase text-slate-500">Đầu mục</h4>
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-400">
                                <tr>
                                    <th className="px-3 py-2 text-left">Dòng</th>
                                    <th className="px-3 py-2 text-left">WBS</th>
                                    <th className="px-3 py-2 text-left">Tên</th>
                                    <th className="px-3 py-2 text-left">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                {importPreview.workRows.map(row => (
                                    <tr key={`work-${row.rowNumber}`} className={row.status === 'error' ? 'bg-red-50/60' : ''}>
                                        <td className="px-3 py-2 font-mono text-slate-400">{row.rowNumber}</td>
                                        <td className="px-3 py-2 font-bold text-indigo-600">{row.item.wbsCode || '-'}</td>
                                        <td className="px-3 py-2 font-bold text-slate-700">{row.item.name || '-'}</td>
                                        <td className="px-3 py-2">{row.errors.length ? row.errors.join(' | ') : row.status === 'create' ? 'Thêm mới' : 'Cập nhật'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div>
                        <h4 className="mb-2 text-xs font-black uppercase text-slate-500">Vật tư</h4>
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-400">
                                <tr>
                                    <th className="px-3 py-2 text-left">Dòng</th>
                                    <th className="px-3 py-2 text-left">WBS</th>
                                    <th className="px-3 py-2 text-left">Mã/SKU</th>
                                    <th className="px-3 py-2 text-left">Tên vật tư</th>
                                    <th className="px-3 py-2 text-left">ĐVT</th>
                                    <th className="px-3 py-2 text-right">KL tự tính</th>
                                    <th className="px-3 py-2 text-right">Ngưỡng</th>
                                    <th className="px-3 py-2 text-right">Đơn giá</th>
                                    <th className="px-3 py-2 text-left">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                {importPreview.materialRows.map(row => {
                                    const previewWork = workBoqItems.find(item => item.id === row.item.workBoqItemId)
                                        || importPreview.workRows.find(workRow => workRow.item.id === row.item.workBoqItemId)?.item;
                                    return (
                                        <tr key={`mat-${row.rowNumber}`} className={row.status === 'error' ? 'bg-red-50/60' : ''}>
                                            <td className="px-3 py-2 font-mono text-slate-400">{row.rowNumber}</td>
                                            <td className="px-3 py-2 font-mono text-indigo-500">{previewWork?.wbsCode || '-'}</td>
                                            <td className="px-3 py-2 font-mono text-slate-500">{row.item.materialCode || '-'}</td>
                                            <td className="px-3 py-2 font-bold text-slate-700">{row.item.itemName || '-'}</td>
                                            <td className="px-3 py-2 text-slate-500">{row.item.unit || '-'}</td>
                                            <td className="px-3 py-2 text-right font-bold">{formatQuantity(row.item.budgetQty)}</td>
                                            <td className="px-3 py-2 text-right font-bold text-indigo-600">{formatQuantity(row.item.wasteThreshold)}</td>
                                            <td className="px-3 py-2 text-right font-bold">{formatMoneyShort(row.item.budgetUnitPrice)}</td>
                                            <td className="px-3 py-2">{row.errors.length ? row.errors.join(' | ') : row.status === 'create' ? 'Thêm mới' : 'Cập nhật'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
                    <button onClick={onCancel} disabled={importingBoq} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600">Huỷ</button>
                    <button
                        onClick={onConfirm}
                        disabled={!canEditBoq || importingBoq || validRowsEmpty}
                        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                        <FileSpreadsheet size={15} /> Ghi dữ liệu hợp lệ
                    </button>
                </div>
            </div>
        </div>
    );
};
