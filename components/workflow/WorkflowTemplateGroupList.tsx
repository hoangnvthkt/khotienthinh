import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import type { WorkflowTemplate, WorkflowTemplateCategory } from '../../types';
import {
    buildSidebarGroups,
    loadSidebarGroupPrefs,
    moveSidebarGroup,
    orderSidebarGroups,
    saveSidebarGroupPrefs,
    toggleCollapsedGroup,
    type SidebarGroupPrefs,
} from '../../lib/workflowSidebarGroups';

interface Props {
    templates: WorkflowTemplate[];
    categories: WorkflowTemplateCategory[];
    userId: string;
    selectedTemplateId?: string;
    /** Badge on the group header (e.g. tickets across its templates); hidden when 0. */
    getGroupCount?: (templates: WorkflowTemplate[]) => number;
    renderTemplate: (template: WorkflowTemplate) => React.ReactNode;
}

/**
 * Templates grouped like Mẫu quy trình. Each person can collapse groups and drag a whole
 * group to change the order; the arrangement is remembered per person on this device.
 */
const WorkflowTemplateGroupList: React.FC<Props> = ({ templates, categories, userId, selectedTemplateId, getGroupCount, renderTemplate }) => {
    const [prefs, setPrefs] = useState<SidebarGroupPrefs>(() => loadSidebarGroupPrefs(userId));
    const [draggingKey, setDraggingKey] = useState<string | null>(null);
    const [overKey, setOverKey] = useState<string | null>(null);

    useEffect(() => { setPrefs(loadSidebarGroupPrefs(userId)); }, [userId]);

    const groups = useMemo(
        () => orderSidebarGroups(buildSidebarGroups(templates, categories), prefs.order),
        [templates, categories, prefs.order],
    );
    const visibleKeys = useMemo(() => groups.map(group => group.key), [groups]);

    const update = useCallback((next: SidebarGroupPrefs) => {
        setPrefs(next);
        saveSidebarGroupPrefs(userId, next);
    }, [userId]);

    const moveTo = (key: string, targetIndex: number) => update({ ...prefs, order: moveSidebarGroup(visibleKeys, key, targetIndex) });

    const endDrag = () => { setDraggingKey(null); setOverKey(null); };

    return (
        <div className="space-y-1.5">
            {groups.map((group, index) => {
                const collapsed = prefs.collapsed.includes(group.key);
                const count = getGroupCount?.(group.templates) ?? 0;
                const holdsSelected = collapsed && group.templates.some(template => template.id === selectedTemplateId);
                const isDropTarget = draggingKey !== null && overKey === group.key && draggingKey !== group.key;
                return (
                    <section
                        key={group.key}
                        onDragOver={event => {
                            if (!draggingKey) return;
                            event.preventDefault();
                            setOverKey(group.key);
                        }}
                        onDrop={event => {
                            if (!draggingKey) return;
                            event.preventDefault();
                            moveTo(draggingKey, index);
                            endDrag();
                        }}
                        className={`rounded-lg transition ${draggingKey === group.key ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-emerald-400/70' : ''}`}
                    >
                        <div
                            draggable
                            onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; setDraggingKey(group.key); }}
                            onDragEnd={endDrag}
                            className="group/header flex items-center gap-1 rounded-md px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        >
                            <button
                                type="button"
                                aria-label={`Sắp xếp nhóm ${group.name}. Dùng phím mũi tên lên/xuống để di chuyển`}
                                title="Kéo để sắp xếp nhóm"
                                onKeyDown={event => {
                                    if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); moveTo(group.key, index - 1); }
                                    if (event.key === 'ArrowDown' && index < groups.length - 1) { event.preventDefault(); moveTo(group.key, index + 1); }
                                }}
                                className="shrink-0 cursor-grab rounded p-0.5 text-slate-300 opacity-0 transition hover:text-slate-500 focus:opacity-100 group-hover/header:opacity-100 active:cursor-grabbing"
                            >
                                <GripVertical size={12} />
                            </button>
                            <button
                                type="button"
                                aria-expanded={!collapsed}
                                onClick={() => update({ ...prefs, collapsed: toggleCollapsedGroup(prefs.collapsed, group.key) })}
                                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                            >
                                {collapsed ? <ChevronRight size={12} className="shrink-0 text-slate-400" /> : <ChevronDown size={12} className="shrink-0 text-slate-400" />}
                                <span className="truncate text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{group.name}</span>
                                {holdsSelected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Đang chọn quy trình trong nhóm này" />}
                                <span className="ml-auto shrink-0 text-[9px] font-semibold text-slate-400">
                                    {count > 0 ? `${count} · ` : ''}{group.templates.length} mẫu
                                </span>
                            </button>
                        </div>
                        {!collapsed && <div className="space-y-0.5 pt-0.5">{group.templates.map(template => <React.Fragment key={template.id}>{renderTemplate(template)}</React.Fragment>)}</div>}
                    </section>
                );
            })}
        </div>
    );
};

export default WorkflowTemplateGroupList;
