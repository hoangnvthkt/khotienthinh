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
}) => (
    <>
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-700 dark:text-white">Quản lý vật tư</h3>
            <React.Suspense fallback={null}>
                <AiInsightPanel module="material" siteId={constructionSiteId} />
            </React.Suspense>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-sm dark:border-slate-700/60 dark:bg-slate-850 [&::-webkit-scrollbar]:hidden">
            {visibleMaterialTabs.map(tab => (
                <button
                    key={tab.key}
                    onClick={() => onTabChange(tab.key)}
                    className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition-all ${activeSubTab === tab.key ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    {tabLabels[tab.key]} {tabCounts[tab.key] > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeSubTab === tab.key ? 'bg-white/20' : 'bg-slate-100'}`}>{tabCounts[tab.key]}</span>}
                </button>
            ))}
        </div>
    </>
);
