import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, FileSpreadsheet, HelpCircle, Info, X } from 'lucide-react';
import {
    SYSTEM_IMPORT_FIELDS,
    type MaterialRequestColumnMapping,
    type MaterialRequestImportFields,
    type RawExcelFileStructure,
} from '../../../lib/materialRequestImportService';

type MaterialRequestColumnMapModalProps = {
    fileStructure: RawExcelFileStructure;
    activeMapping: MaterialRequestColumnMapping;
    onCancel: () => void;
    onConfirmMapping: (newMapping: MaterialRequestColumnMapping) => void;
};

export const MaterialRequestColumnMapModal: React.FC<MaterialRequestColumnMapModalProps> = ({
    fileStructure,
    activeMapping,
    onCancel,
    onConfirmMapping,
}) => {
    const [mapping, setMapping] = useState<MaterialRequestColumnMapping>({ ...activeMapping });

    const handleSelectColumn = (fieldKey: keyof MaterialRequestImportFields, excelHeader: string) => {
        setMapping(prev => ({
            ...prev,
            [fieldKey]: excelHeader,
        }));
    };

    const isNameMapped = Boolean(mapping.materialName || mapping.materialCode);
    const isQtyMapped = Boolean(mapping.requestQty);
    const canProceed = isNameMapped && isQtyMapped;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!canProceed) return;
        onConfirmMapping(mapping);
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-800/40">
                    <div className="flex items-center space-x-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold">
                            <FileSpreadsheet size={22} />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white uppercase tracking-wider">
                                    Bước 1 / 2
                                </span>
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">
                                    Ánh xạ cột dữ liệu Excel
                                </h3>
                            </div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                File: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{fileStructure.fileName}</span> (Sheet: {fileStructure.sheetName})
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Banner Guidance */}
                <div className="px-6 py-3 bg-indigo-50/60 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/40 flex items-start space-x-3">
                    <Info size={18} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs font-medium text-indigo-900 dark:text-indigo-200">
                        Hệ thống đã tự động quét và gợi ý khớp các cột Excel của anh. Vui lòng kiểm tra lại nếu cột nào chưa đúng và chọn lại dropdown tương ứng trước khi bấm chuyển sang Bước 2 Xem trước.
                    </p>
                </div>

                {/* Mapping Form Table */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6 space-y-4">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 rounded-l-xl w-1/3">Trường dữ liệu phần mềm</th>
                                <th className="px-4 py-3 w-1/3">Chọn Cột từ Excel của Anh</th>
                                <th className="px-4 py-3 rounded-r-xl w-1/3">Mẫu dữ liệu Dòng 1</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {SYSTEM_IMPORT_FIELDS.map(field => {
                                const selectedCol = mapping[field.key] || '';
                                const sampleVal = selectedCol ? fileStructure.sampleRow[selectedCol] : '';
                                const isRequired = field.required;

                                return (
                                    <tr key={field.key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {/* System Field Info */}
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center">
                                                <span>{field.label}</span>
                                                {isRequired && <span className="ml-1 text-red-500 font-bold">*</span>}
                                            </div>
                                            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                                                {field.description}
                                            </div>
                                        </td>

                                        {/* Excel Column Selector */}
                                        <td className="px-4 py-3">
                                            <select
                                                value={selectedCol}
                                                onChange={e => handleSelectColumn(field.key, e.target.value)}
                                                className={`w-full rounded-xl border py-2 px-3 text-xs font-bold transition-all focus:outline-none focus:ring-2 ${
                                                    selectedCol
                                                        ? 'border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 focus:ring-indigo-500'
                                                        : isRequired
                                                        ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20 text-red-600 focus:ring-red-500'
                                                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500'
                                                }`}
                                            >
                                                <option value="">-- (Bỏ qua / Không chọn) --</option>
                                                {fileStructure.availableHeaders.map((header, hIdx) => (
                                                    <option key={`${header}-${hIdx}`} value={header}>
                                                        Cột: {header}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>

                                        {/* Sample Data Value */}
                                        <td className="px-4 py-3 font-mono text-[11px]">
                                            {sampleVal ? (
                                                <span className="inline-block max-w-[240px] truncate font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                                                    "{sampleVal}"
                                                </span>
                                            ) : (
                                                <span className="italic text-slate-400">(Trống)</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {!canProceed && (
                        <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-xs font-bold text-red-600 dark:text-red-400 flex items-center">
                            <Info size={16} className="mr-2 flex-shrink-0" />
                            Vui lòng chọn cột tương ứng cho trường Tên vật tư (hoặc Mã SKU) và Số lượng đề xuất để tiếp tục.
                        </div>
                    )}
                </form>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-800/40">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition-all"
                    >
                        Hủy bỏ
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canProceed}
                        className="flex items-center rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 disabled:shadow-none transition-all"
                    >
                        <span>Chuyển sang Bước 2: Xem trước (Preview)</span>
                        <ArrowRight size={16} className="ml-2" />
                    </button>
                </div>
            </div>
        </div>
    );
};
