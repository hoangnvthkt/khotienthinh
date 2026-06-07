import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { MaterialBudgetItem } from '../../../types';

type MaterialSummaryTabProps = {
    computedBoqItems: MaterialBudgetItem[];
    formatQuantity: (value: number) => string;
    formatPercent: (value: number) => string;
    formatMoneyShort: (value: number) => string;
};

export const MaterialSummaryTab: React.FC<MaterialSummaryTabProps> = ({
    computedBoqItems,
    formatQuantity,
    formatPercent,
    formatMoneyShort,
}) => (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div>
                <h4 className="text-sm font-black text-slate-800">📊 Bảng tổng hợp vật tư</h4>
                <p className="text-[10px] text-slate-400">Toàn bộ chỉ số trên 1 dòng — liên kết BOQ↔YC↔PO↔Kho</p>
            </div>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left">
                <thead>
                    <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-wider text-slate-500">
                        <th className="sticky left-0 z-10 bg-slate-50 p-2.5">Mã VT</th>
                        <th className="p-2.5">Vật tư</th>
                        <th className="p-2.5">ĐVT</th>
                        <th className="p-2.5 text-right">Ngân sách</th>
                        <th className="p-2.5 text-right">LK Yêu cầu</th>
                        <th className="p-2.5 text-right text-amber-600">% Vượt NS</th>
                        <th className="p-2.5 text-right">LK Nhập</th>
                        <th className="p-2.5 text-right">LK Xuất</th>
                        <th className="p-2.5 text-right">Tồn kho</th>
                        <th className="p-2.5 text-right">HH (%)</th>
                        <th className="p-2.5 text-right">Ngưỡng</th>
                        <th className="p-2.5 text-right text-red-500">GT Hao hụt</th>
                        <th className="p-2.5">Cảnh báo</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-xs dark:divide-slate-700/40">
                    {computedBoqItems.map(item => {
                        const overBudget = (item.budgetOverPercent || 0) > 0;
                        const overWaste = (item.wasteQty || 0) > 0;
                        const negStock = (item.stockBalance || 0) < 0;
                        return (
                            <tr key={item.id} className={`hover:bg-slate-50 ${overWaste ? 'bg-red-50/40' : overBudget ? 'bg-amber-50/40' : ''}`}>
                                <td className="sticky left-0 z-10 bg-white p-2.5 font-mono text-[10px] font-bold text-indigo-500 dark:bg-slate-900">{item.materialCode || '—'}</td>
                                <td className="max-w-[140px] truncate p-2.5 font-bold text-slate-800">{item.itemName}</td>
                                <td className="p-2.5 text-slate-400">{item.unit}</td>
                                <td className="p-2.5 text-right font-bold">{formatQuantity(item.budgetQty)}</td>
                                <td className="p-2.5 text-right font-bold">{formatQuantity(item.cumulativeRequested || 0)}</td>
                                <td className={`p-2.5 text-right font-black ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {(item.budgetOverPercent || 0) > 0 ? '+' : ''}{formatPercent(item.budgetOverPercent || 0)}%
                                </td>
                                <td className="p-2.5 text-right">{formatQuantity(item.cumulativeImported || 0)}</td>
                                <td className="p-2.5 text-right">{formatQuantity(item.cumulativeExported || 0)}</td>
                                <td className={`p-2.5 text-right font-bold ${negStock ? 'text-red-600' : 'text-emerald-600'}`}>{formatQuantity(item.stockBalance || 0)}</td>
                                <td className={`p-2.5 text-right font-bold ${overWaste ? 'text-red-600' : 'text-slate-600'}`}>{formatPercent(item.wastePercent || 0)}%</td>
                                <td className="p-2.5 text-right text-slate-400">{formatQuantity(item.wasteThreshold)}</td>
                                <td className={`p-2.5 text-right font-bold ${(item.wasteValue || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatMoneyShort(Math.abs(item.wasteValue || 0))}</td>
                                <td className="p-2.5">
                                    {item.autoAlert ? (
                                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${item.autoAlert.includes('Vượt') ? 'bg-red-100 text-red-700' : item.autoAlert.includes('Cận') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                            <AlertTriangle size={9} /> {item.autoAlert}
                                        </span>
                                    ) : <span className="text-[9px] font-bold text-emerald-500">✓ OK</span>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
);
