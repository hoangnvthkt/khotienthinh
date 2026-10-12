import React from 'react';
import type { ProjectMaterialTabKey } from '../../../lib/projectTabPermissions';

type MaterialTabHeaderProps = {
    visibleMaterialTabs: Array<{ key: ProjectMaterialTabKey }>;
    activeSubTab: ProjectMaterialTabKey;
    tabLabels: Record<ProjectMaterialTabKey, string>;
    tabCounts: Record<ProjectMaterialTabKey, number>;
    onTabChange: (tab: ProjectMaterialTabKey) => void;
    /** Nút phụ bên phải (Đơn hàng, Mua nóng ở Mua hàng; Nhập đầu kỳ). */
    actions?: React.ReactNode;
};

// Một hàng: tab con bên trái (cuộn ngang trên màn hẹp), nút phụ bên phải.
export const MaterialTabHeader: React.FC<MaterialTabHeaderProps> = ({
    visibleMaterialTabs,
    activeSubTab,
    tabLabels,
    tabCounts,
    onTabChange,
    actions,
}) => (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label="Vật tư" className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 [&::-webkit-scrollbar]:hidden">
            {visibleMaterialTabs.map(tab => (
                <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeSubTab === tab.key}
                    onClick={() => onTabChange(tab.key)}
                    className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all ${activeSubTab === tab.key ? 'bg-teal-700 text-white shadow-sm font-semibold' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                >
                    {tabLabels[tab.key]} {tabCounts[tab.key] > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeSubTab === tab.key ? 'bg-white/20 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>{tabCounts[tab.key]}</span>}
                </button>
            ))}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
);
