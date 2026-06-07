import React from 'react';
import type { MaterialBudgetItem } from '../../../types';
import type { MaterialBudgetCategoryChartDatum, MaterialTopBudgetChartDatum } from '../MaterialTabCharts';

const MaterialBudgetDashboardCharts = React.lazy(() =>
    import('../MaterialTabCharts').then(module => ({ default: module.MaterialBudgetDashboardCharts }))
);

const ChartFallback = () => (
    <div className="flex h-[280px] items-center justify-center rounded-xl bg-slate-50 text-xs font-bold text-slate-400 dark:bg-slate-900/40">
        Đang tải biểu đồ...
    </div>
);

type MaterialDashboardTabProps = {
    computedBoqItems: MaterialBudgetItem[];
    budgetCategoryChartData: MaterialBudgetCategoryChartDatum[];
    topBudgetValueChartData: MaterialTopBudgetChartDatum[];
    formatQuantity: (value: number) => string;
    formatPercent: (value: number) => string;
    formatMoneyShort: (value: number) => string;
};

export const MaterialDashboardTab: React.FC<MaterialDashboardTabProps> = ({
    computedBoqItems,
    budgetCategoryChartData,
    topBudgetValueChartData,
    formatQuantity,
    formatPercent,
    formatMoneyShort,
}) => {
    const overBudgetItems = computedBoqItems
        .filter(item => (item.budgetOverPercent || 0) > 0)
        .sort((a, b) => (b.budgetOverPercent || 0) - (a.budgetOverPercent || 0));
    const overWasteItems = computedBoqItems
        .filter(item => (item.wasteQty || 0) > 0)
        .sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0));

    return (
        <div className="space-y-6">
            <React.Suspense fallback={
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <ChartFallback />
                    <ChartFallback />
                </div>
            }>
                <MaterialBudgetDashboardCharts
                    categoryData={budgetCategoryChartData}
                    topValueData={topBudgetValueChartData}
                />
            </React.Suspense>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                    <div className="border-b border-slate-100 p-4"><h4 className="text-sm font-black text-slate-800">🔴 Vật tư VƯỢT ngân sách</h4></div>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-slate-50 text-[9px] font-black uppercase text-slate-500">
                                <th className="p-2.5 text-left">Vật tư</th>
                                <th className="p-2.5 text-right">NS</th>
                                <th className="p-2.5 text-right">LK YC</th>
                                <th className="p-2.5 text-right">% Vượt</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                            {overBudgetItems.map(item => (
                                <tr key={item.id} className="hover:bg-red-50/50">
                                    <td className="p-2.5 font-bold text-slate-800">{item.itemName}</td>
                                    <td className="p-2.5 text-right">{formatQuantity(item.budgetQty)}</td>
                                    <td className="p-2.5 text-right font-bold">{formatQuantity(item.cumulativeRequested || 0)}</td>
                                    <td className="p-2.5 text-right font-black text-red-600">+{formatPercent(item.budgetOverPercent || 0)}%</td>
                                </tr>
                            ))}
                            {overBudgetItems.length === 0 && (
                                <tr><td colSpan={4} className="p-6 text-center text-[10px] font-bold uppercase text-slate-300">Không có vật tư vượt NS</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                    <div className="border-b border-slate-100 p-4"><h4 className="text-sm font-black text-slate-800">⚠️ Vật tư VƯỢT hao hụt</h4></div>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-slate-50 text-[9px] font-black uppercase text-slate-500">
                                <th className="p-2.5 text-left">Vật tư</th>
                                <th className="p-2.5 text-right">HH%</th>
                                <th className="p-2.5 text-right">Ngưỡng</th>
                                <th className="p-2.5 text-right">GT Hao hụt</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                            {overWasteItems.map(item => (
                                <tr key={item.id} className="hover:bg-amber-50/50">
                                    <td className="p-2.5 font-bold text-slate-800">{item.itemName}</td>
                                    <td className="p-2.5 text-right font-black text-red-600">{formatPercent(item.wastePercent || 0)}%</td>
                                    <td className="p-2.5 text-right text-slate-400">{formatQuantity(item.wasteThreshold)}</td>
                                    <td className="p-2.5 text-right font-bold text-red-600">{formatMoneyShort(Math.abs(item.wasteValue || 0))} đ</td>
                                </tr>
                            ))}
                            {overWasteItems.length === 0 && (
                                <tr><td colSpan={4} className="p-6 text-center text-[10px] font-bold uppercase text-slate-300">Tất cả trong định mức</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
