import React from 'react';
import { CheckCircle2, Edit2, Plus, Save, Search, X } from 'lucide-react';
import type { InventoryItem, MaterialBudgetItem, ProjectWorkBoqItem } from '../../../types';
import { parseVietnameseMoney } from '../../../lib/projectMaterialTabUtils';

type MaterialBoqFormModalProps = {
    editingBoq: MaterialBudgetItem | null;
    workBoqTree: Array<{ item: ProjectWorkBoqItem; level: number }>;
    bWorkBoqItemId: string;
    onWorkBoqItemChange: (value: string) => void;
    acRef: React.RefObject<HTMLDivElement>;
    acQuery: string;
    onAcQueryChange: (value: string) => void;
    acOpen: boolean;
    onAcOpenChange: (value: boolean) => void;
    acSuggestions: InventoryItem[];
    onSelectInventoryItem: (item: InventoryItem) => void;
    bInventoryItemId: string;
    bName: string;
    onBNameChange: (value: string) => void;
    bMaterialCode: string;
    bCat: string;
    onBCatChange: (value: string) => void;
    bUnit: string;
    onBUnitChange: (value: string) => void;
    bPrice: string;
    onBPriceChange: (value: string) => void;
    bThreshold: string;
    onBThresholdChange: (value: string) => void;
    bBudgetQtyInput: string;
    onBudgetQtyChange: (value: string) => void;
    selectedWorkBoqItem?: ProjectWorkBoqItem;
    selectedWorkPlannedQty: number;
    hasValidThreshold: boolean;
    thresholdValue: number;
    autoBudgetQty: number;
    bBudgetQty: number;
    bBudgetQtyManuallyEdited: boolean;
    onResetBudgetQtyToFormula: () => void;
    bNotes: string;
    onBNotesChange: (value: string) => void;
    canSaveBoqItem: boolean;
    onCancel: () => void;
    onSave: () => void;
    formatQuantity: (value: number) => string;
    formatMoneyShort: (value: number) => string;
};

export const MaterialBoqFormModal: React.FC<MaterialBoqFormModalProps> = ({
    editingBoq,
    workBoqTree,
    bWorkBoqItemId,
    onWorkBoqItemChange,
    acRef,
    acQuery,
    onAcQueryChange,
    acOpen,
    onAcOpenChange,
    acSuggestions,
    onSelectInventoryItem,
    bInventoryItemId,
    bName,
    onBNameChange,
    bMaterialCode,
    bCat,
    onBCatChange,
    bUnit,
    onBUnitChange,
    bPrice,
    onBPriceChange,
    bThreshold,
    onBThresholdChange,
    bBudgetQtyInput,
    onBudgetQtyChange,
    selectedWorkBoqItem,
    selectedWorkPlannedQty,
    hasValidThreshold,
    thresholdValue,
    autoBudgetQty,
    bBudgetQty,
    bBudgetQtyManuallyEdited,
    onResetBudgetQtyToFormula,
    bNotes,
    onBNotesChange,
    canSaveBoqItem,
    onCancel,
    onSave,
    formatQuantity,
    formatMoneyShort,
}) => {
    const isG8NormItem = editingBoq?.sourceType === 'g8_norm';
    return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between rounded-t-3xl border-b border-slate-100 bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-4">
                <span className="flex items-center gap-2 text-lg font-bold text-white">
                    {editingBoq ? <><Edit2 size={18} /> Sửa BOQ</> : <><Plus size={18} /> Thêm BOQ</>}
                </span>
                <button onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 text-white hover:bg-white/30"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-6">
                <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Đầu mục BOQ triển khai *</label>
                    <select
                        value={bWorkBoqItemId}
                        onChange={event => onWorkBoqItemChange(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">Chọn đầu mục để tính KL vật tư...</option>
                        {workBoqTree.map(({ item, level }) => (
                            <option key={item.id} value={item.id}>{`${'— '.repeat(level)}${item.wbsCode || ''} ${item.name} (KL: ${formatQuantity(Number(item.plannedQty || 0))})`}</option>
                        ))}
                    </select>
                </div>

                <div ref={acRef} className="relative">
                    <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">🔍 Tìm vật tư từ Kho (gõ mã SKU hoặc tên)</label>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                        <input
                            value={acQuery}
                            onChange={event => { onAcQueryChange(event.target.value); onAcOpenChange(true); }}
                            onFocus={() => acQuery && onAcOpenChange(true)}
                            placeholder="VD: VT00040 hoặc Thép phi 22..."
                            className="w-full rounded-xl border border-indigo-200 bg-indigo-50/30 py-2.5 pl-9 pr-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    {acOpen && acSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                            {acSuggestions.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => onSelectInventoryItem(item)}
                                    className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-4 py-2.5 text-left last:border-b-0 hover:bg-indigo-50"
                                >
                                    <div>
                                        <span className="text-xs font-bold text-slate-800">{item.name}</span>
                                        <span className="ml-2 text-[10px] text-slate-400">({item.sku})</span>
                                    </div>
                                    <div className="shrink-0 text-right text-[10px]">
                                        <span className="text-slate-400">{item.unit}</span>
                                        <span className="ml-2 font-bold text-indigo-500">{formatMoneyShort(item.priceIn)} đ</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {bInventoryItemId && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                        <CheckCircle2 size={12} className="text-emerald-500" />
                        <span className="font-bold text-emerald-700">Đã chọn: {bName}</span>
                        <span className="text-emerald-500">({bMaterialCode})</span>
                        <span className="ml-auto text-emerald-400">{bCat} • {bUnit} • {formatMoneyShort(parseVietnameseMoney(bPrice))} đ</span>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Tên vật tư *</label>
                        <input value={bName} onChange={event => onBNameChange(event.target.value)} placeholder="Nhập tên vật tư"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" readOnly={!!bInventoryItemId} />
                    </div>
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Nhóm</label>
                        <input value={bCat} onChange={event => onBCatChange(event.target.value)} placeholder="Nhóm vật tư"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" readOnly={!!bInventoryItemId} />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Đơn vị</label>
                        <input value={bUnit} onChange={event => onBUnitChange(event.target.value)} placeholder="kg, m3..."
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" readOnly={!!bInventoryItemId} />
                    </div>
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">{isG8NormItem ? 'Định mức hao phí *' : 'Ngưỡng hao hụt *'}</label>
                        <input type="text" inputMode="decimal" value={bThreshold} onChange={event => onBThresholdChange(event.target.value)} placeholder="0,5"
                            className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-indigo-500">KL Dự toán vật tư *</label>
                        <input type="text" inputMode="decimal" value={bBudgetQtyInput} onChange={event => onBudgetQtyChange(event.target.value)} placeholder="Tự động hoặc nhập tay"
                            className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm font-black text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Đơn giá (VNĐ)</label>
                        <input type="text" inputMode="decimal" value={bPrice} onChange={event => onBPriceChange(event.target.value)} placeholder="0"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" readOnly={!!bInventoryItemId} />
                    </div>
                    <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-blue-400">KL Thực xuất (tự động)</label>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-400">
                            Tự tính từ phiếu đề xuất đã duyệt
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs">
                    <div className="font-bold text-indigo-500">KL vật tư = KL dự toán đầu mục × {isG8NormItem ? 'Định mức hao phí' : 'Ngưỡng hao hụt'}</div>
                    {selectedWorkBoqItem ? (
                        <div className="mt-1 text-indigo-700">
                            <span className="font-black">{formatQuantity(selectedWorkPlannedQty)} × {hasValidThreshold ? formatQuantity(thresholdValue) : '—'} = {formatQuantity(autoBudgetQty)} {bUnit || ''}</span>
                            {bBudgetQtyManuallyEdited && bBudgetQty > 0 && Math.abs(bBudgetQty - autoBudgetQty) > 0.000001 && (
                                <span className="ml-2 font-bold text-amber-600">• KL đang nhập: {formatQuantity(bBudgetQty)} {bUnit || ''}</span>
                            )}
                            {bPrice !== '' && bBudgetQty > 0 && <span className="ml-2 text-indigo-400">• Giá trị: {formatMoneyShort(bBudgetQty * parseVietnameseMoney(bPrice))} đ</span>}
                            {hasValidThreshold && autoBudgetQty > 0 && (
                                <button
                                    type="button"
                                    onClick={onResetBudgetQtyToFormula}
                                    className="ml-2 rounded-lg border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-black text-indigo-600 hover:bg-indigo-100"
                                >
                                    Dùng công thức
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="mt-1 font-bold text-amber-600">Chọn đầu mục BOQ để hệ thống tự tính KL dự toán vật tư.</div>
                    )}
                    {selectedWorkBoqItem && selectedWorkPlannedQty <= 0 && (
                        <div className="mt-1 font-bold text-red-500">Đầu mục đang có KL dự toán bằng 0, chưa thể thêm vật tư.</div>
                    )}
                </div>

                <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Ghi chú</label>
                    <textarea value={bNotes} onChange={event => onBNotesChange(event.target.value)} rows={2} placeholder="Ghi chú..."
                        className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
                <button onClick={onCancel} className="rounded-xl px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                <button
                    onClick={onSave}
                    disabled={!canSaveBoqItem}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:shadow-xl disabled:opacity-50"
                >
                    <Save size={16} /> {editingBoq ? 'Lưu' : 'Thêm'}
                </button>
            </div>
        </div>
    </div>
    );
};
