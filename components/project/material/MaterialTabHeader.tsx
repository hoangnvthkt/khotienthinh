import React from 'react';
import { AlertTriangle, Clock, Package, TrendingUp, Link2, FileText, Calendar, Inbox, Layers, ShoppingCart, BarChart3 } from 'lucide-react';
import type { ProjectMaterialTabKey } from '../../../lib/projectTabPermissions';
import { useTheme } from '../../../context/ThemeContext';

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

const tabIconMap: Record<ProjectMaterialTabKey, React.ComponentType<any>> = {
    summary: Link2,
    boq: FileText,
    planning: Calendar,
    request: Inbox,
    custom: Layers,
    po: ShoppingCart,
    waste: AlertTriangle,
    dashboard: BarChart3
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
}) => {
    const { isEnterprise } = useTheme();

    return (
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

            <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-sm dark:border-slate-700/60 dark:bg-slate-850 [&::-webkit-scrollbar]:hidden">
                {visibleMaterialTabs.map(tab => {
                    const IconComp = tabIconMap[tab.key];
                    const rawLabel = tabLabels[tab.key] || '';
                    const label = isEnterprise ? rawLabel.replace(/^[^\w\s\(\)]+\s*/u, '') : rawLabel;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => onTabChange(tab.key)}
                            className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition-all ${activeSubTab === tab.key ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                        >
                            {isEnterprise && IconComp && <IconComp size={13} className="shrink-0" />}
                            {label} {tabCounts[tab.key] > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeSubTab === tab.key ? 'bg-white/20' : 'bg-slate-100'}`}>{tabCounts[tab.key]}</span>}
                        </button>
                    );
                })}
            </div>
        </>
    );
};
