import React from 'react';
import { AlertTriangle, Clock, Package, TrendingUp } from 'lucide-react';
import type { ProjectMaterialTabKey } from '../../../lib/projectTabPermissions';

const AiInsightPanel = React.lazy(() => import('../../AiInsightPanel'));

type MaterialBoqStats = {
    boqCount: number;
    totalBudget: number;
    totalActual: number;
    diff: number;
    overWaste: number;
    overBudget: number;
    totalWasteValue: number;
    pendingReq: number;
};

type MaterialTabHeaderProps = {
    constructionSiteId?: string;
    materialBoqStats: MaterialBoqStats;
    totalRequestCount: number;
    visibleMaterialTabs: Array<{ key: ProjectMaterialTabKey }>;
    activeSubTab: ProjectMaterialTabKey;
    tabLabels: Record<ProjectMaterialTabKey, string>;
    tabCounts: Record<ProjectMaterialTabKey, number>;
    formatMoneyShort: (value: number) => string;
    onTabChange: (tab: ProjectMaterialTabKey) => void;
    actions?: React.ReactNode;
};

export const MaterialTabHeader: React.FC<MaterialTabHeaderProps> = ({
    constructionSiteId,
    materialBoqStats,
    totalRequestCount,
    visibleMaterialTabs,
    activeSubTab,
    tabLabels,
    tabCounts,
    formatMoneyShort,
    onTabChange,
    actions,
}) => (
    <>
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-700 dark:text-white">Quản lý vật tư</h3>
            <div className="flex items-center gap-2">
                {actions}
                <React.Suspense fallback={null}>
                    <AiInsightPanel module="material" siteId={constructionSiteId} />
                </React.Suspense>
            </div>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 [&::-webkit-scrollbar]:hidden">
            {visibleMaterialTabs.map(tab => (
                <button
                    key={tab.key}
                    onClick={() => onTabChange(tab.key)}
                    className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all ${activeSubTab === tab.key ? 'bg-teal-700 text-white shadow-sm font-semibold' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                >
                    {tabLabels[tab.key]} {tabCounts[tab.key] > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeSubTab === tab.key ? 'bg-white/20 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>{tabCounts[tab.key]}</span>}
                </button>
            ))}
        </div>
    </>
);
