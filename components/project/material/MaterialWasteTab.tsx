import React from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock } from 'lucide-react';
import type { MaterialBudgetItem } from '../../../types';
import type { MaterialWasteChartDatum } from '../MaterialTabCharts';

const MaterialWasteComparisonChart = React.lazy(() =>
    import('../MaterialTabCharts').then(module => ({ default: module.MaterialWasteComparisonChart }))
);

const ChartFallback = () => (
    <div className="flex h-[280px] items-center justify-center rounded-xl bg-slate-50 text-xs font-bold text-slate-400 dark:bg-slate-900/40">
        Đang tải biểu đồ...
    </div>
);

type MaterialWasteTabProps = {
    computedBoqItems: MaterialBudgetItem[];
    sortedWasteBoqItems: MaterialBudgetItem[];
    wasteChartData: MaterialWasteChartDatum[];
    formatQuantity: (value: number) => string;
    formatPercent: (value: number) => string;
};

export const MaterialWasteTab: React.FC<MaterialWasteTabProps> = ({
    computedBoqItems,
    sortedWasteBoqItems,
    wasteChartData,
    formatQuantity,
    formatPercent,
}) => (
    <div className="space-y-4">
        {computedBoqItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                <BarChart3 size={36} className="mx-auto mb-2 text-slate-200" />
                <p className="text-sm font-bold text-slate-400">Thêm dữ liệu BOQ để so sánh hao hụt</p>
            </div>
        ) : (
            <>
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-black text-slate-700"><BarChart3 size={16} className="text-indigo-500" /> Dự toán vs Thực tế</h3>
                    <React.Suspense fallback={<ChartFallback />}>
                        <MaterialWasteComparisonChart data={wasteChartData} />
                    </React.Suspense>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                    <div className="border-b border-slate-100 p-5">
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-700"><AlertTriangle size={16} className="text-red-400" /> Chi tiết hao hụt</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50/80">
                                <tr className="text-[10px] font-bold uppercase text-slate-400">
                                    <th className="px-4 py-3 text-left">Vật tư</th>
                                    <th className="px-4 py-3 text-center">ĐVT</th>
                                    <th className="px-4 py-3 text-right">Dự toán</th>
                                    <th className="px-4 py-3 text-right">Thực tế</th>
                                    <th className="px-4 py-3 text-right">Chênh lệch</th>
                                    <th className="px-4 py-3 text-right">% Hao hụt</th>
                                    <th className="px-4 py-3 text-right">Ngưỡng</th>
                                    <th className="px-4 py-3 text-center">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                {sortedWasteBoqItems.map(item => {
                                    const isOver = (item.wasteQty || 0) > 0;
                                    const isNeg = (item.wastePercent || 0) <= 0;
                                    return (
                                        <tr key={item.id} className={`${isOver ? 'bg-red-50/30' : ''}`}>
                                            <td className="px-4 py-2.5 font-bold text-slate-700">{item.itemName}</td>
                                            <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                                            <td className="px-4 py-2.5 text-right text-slate-600">{formatQuantity(item.budgetQty)}</td>
                                            <td className="px-4 py-2.5 text-right font-bold text-slate-700">{formatQuantity(item.actualQty)}</td>
                                            <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {(item.wasteQty || 0) > 0 ? '+' : ''}{formatQuantity(item.wasteQty || 0)}
                                            </td>
                                            <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : isNeg ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                {(item.wastePercent || 0) > 0 ? '+' : ''}{formatPercent(item.wastePercent || 0)}%
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-slate-400">{formatQuantity(item.wasteThreshold)}</td>
                                            <td className="px-4 py-2.5 text-center">
                                                {isOver ? (
                                                    <span className="inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-600"><AlertTriangle size={9} /> Vượt</span>
                                                ) : isNeg ? (
                                                    <span className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-600"><CheckCircle2 size={9} /> Tốt</span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-600"><Clock size={9} /> OK</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </>
        )}
    </div>
);
