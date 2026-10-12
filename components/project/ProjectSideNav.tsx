import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, HardHat, LayoutDashboard, Menu, Package, Settings, ShieldCheck, X } from 'lucide-react';
import type { ProjectMaterialTabKey, ProjectOverviewTabKey } from '../../lib/projectTabPermissions';

export type ProjectNavTab = { key: ProjectOverviewTabKey; label: string };
export type ProjectNavMaterialItem = { key: ProjectMaterialTabKey; label: string };

type GroupId = 'run' | 'build' | 'material' | 'qhse' | 'docs' | 'setup' | 'other';

// Nhóm theo công việc (audit 11/10/2026 mục 4.2, mẫu FastCons chủ SP gửi 12/10).
const GROUPS: Array<{ id: GroupId; label: string; icon: React.ElementType; keys: ProjectOverviewTabKey[] }> = [
  { id: 'run', label: 'Điều hành', icon: LayoutDashboard, keys: ['executive', 'report'] },
  { id: 'build', label: 'Thi công', icon: HardHat, keys: ['gantt', 'work_plan', 'weekly_progress', 'dailylog'] },
  { id: 'material', label: 'Vật tư', icon: Package, keys: ['material'] },
  { id: 'qhse', label: 'Chất lượng & An toàn', icon: ShieldCheck, keys: ['quality', 'safety'] },
  { id: 'docs', label: 'Hồ sơ', icon: FolderOpen, keys: ['documents', 'contract', 'subcontract'] },
  { id: 'setup', label: 'Thiết lập', icon: Settings, keys: ['org', 'permissions'] },
];

const STORAGE_KEY = 'vioo_project_nav_collapsed';
const readCollapsed = (): GroupId[] => {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
};
const writeCollapsed = (ids: GroupId[]) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* bỏ qua */ } };

type Props = {
  tabs: ProjectNavTab[];
  activeTab: ProjectOverviewTabKey;
  onSelectTab: (key: ProjectOverviewTabKey) => void;
  /** Mục con của Vật tư (đã lọc theo quyền); rỗng thì nhóm Vật tư chỉ có một mục. */
  materialItems: ProjectNavMaterialItem[];
  activeMaterialTab: ProjectMaterialTabKey | null;
  onSelectMaterial: (key: ProjectMaterialTabKey) => void;
};

/** Menu dạng cột của một dự án: cột trái cố định trên màn rộng, ngăn kéo trên màn hẹp. */
export const ProjectSideNav: React.FC<Props> = ({ tabs, activeTab, onSelectTab, materialItems, activeMaterialTab, onSelectMaterial }) => {
  const [collapsed, setCollapsed] = useState<GroupId[]>(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const groups = useMemo(() => {
    const byKey = new Map(tabs.map(tab => [tab.key, tab]));
    const used = new Set<ProjectOverviewTabKey>();
    const list = GROUPS.map(group => {
      const items = group.keys.map(key => byKey.get(key)).filter((tab): tab is ProjectNavTab => Boolean(tab));
      items.forEach(item => used.add(item.key));
      return { ...group, items };
    }).filter(group => group.items.length > 0);
    const rest = tabs.filter(tab => !used.has(tab.key));
    if (rest.length > 0) list.push({ id: 'other', label: 'Khác', icon: FolderOpen, keys: rest.map(tab => tab.key), items: rest });
    return list;
  }, [tabs]);

  const activeGroup = groups.find(group => group.items.some(item => item.key === activeTab)) || null;
  const activeLabel = activeTab === 'material' && activeMaterialTab
    ? materialItems.find(item => item.key === activeMaterialTab)?.label || 'Vật tư'
    : tabs.find(tab => tab.key === activeTab)?.label || '';

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggle = (id: GroupId) => setCollapsed(current => {
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
    writeCollapsed(next);
    return next;
  });

  const itemCls = (active: boolean) => `flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${active
    ? 'bg-teal-700 font-semibold text-white shadow-sm'
    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'}`;

  const nav = (onPicked?: () => void) => <nav aria-label="Chức năng dự án" className="space-y-1">
    {groups.map(group => {
      const Icon = group.icon;
      // Nhóm đang xem luôn mở; nhóm một mục (không phải Vật tư) bấm tiêu đề là mở luôn.
      const isOpen = group.id === activeGroup?.id || !collapsed.includes(group.id);
      const single = group.items.length === 1 && !(group.id === 'material' && materialItems.length > 0);
      if (single) {
        const item = group.items[0];
        return <button key={group.id} type="button" aria-current={activeTab === item.key ? 'page' : undefined}
          onClick={() => { onSelectTab(item.key); onPicked?.(); }}
          className={`${itemCls(activeTab === item.key)} gap-2 font-semibold`}>
          <Icon size={16} className="shrink-0" />{group.id === 'material' ? group.label : item.label}
        </button>;
      }
      return <div key={group.id}>
        <button type="button" aria-expanded={isOpen} onClick={() => toggle(group.id)} disabled={group.id === activeGroup?.id}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-100 disabled:cursor-default disabled:hover:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-800">
          <Icon size={16} className={`shrink-0 ${group.id === activeGroup?.id ? 'text-teal-700 dark:text-teal-400' : 'text-zinc-400'}`} />
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          {group.id !== activeGroup?.id && (isOpen ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />)}
        </button>
        {isOpen && <div className="ml-4 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
          {group.id === 'material'
            ? materialItems.map(item => {
              const active = activeTab === 'material' && activeMaterialTab === item.key;
              return <button key={item.key} type="button" aria-current={active ? 'page' : undefined}
                onClick={() => { onSelectMaterial(item.key); onPicked?.(); }} className={itemCls(active)}>{item.label}</button>;
            })
            : group.items.map(item => <button key={item.key} type="button" aria-current={activeTab === item.key ? 'page' : undefined}
              onClick={() => { onSelectTab(item.key); onPicked?.(); }} className={itemCls(activeTab === item.key)}>{item.label}</button>)}
        </div>}
      </div>;
    })}
  </nav>;

  return <>
    {/* Màn hẹp: một nút mở ngăn kéo menu. */}
    <button type="button" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog"
      className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:hidden">
      <Menu size={16} className="shrink-0 text-teal-700 dark:text-teal-400" />
      <span className="truncate text-zinc-500 dark:text-zinc-400">{activeGroup?.label}</span>
      {activeGroup && activeGroup.label !== activeLabel && <><ChevronRight size={14} className="shrink-0 text-zinc-300" />
        <span className="truncate font-semibold text-zinc-900 dark:text-white">{activeLabel}</span></>}
    </button>
    {drawerOpen && <div className="fixed inset-0 z-[999] lg:hidden" role="dialog" aria-modal="true" aria-label="Chức năng dự án">
      <button type="button" aria-label="Đóng menu" className="absolute inset-0 bg-slate-950/40" onClick={() => setDrawerOpen(false)} />
      <div className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="text-sm font-bold">Chức năng dự án</span>
          <button type="button" aria-label="Đóng" onClick={() => setDrawerOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">{nav(() => setDrawerOpen(false))}</div>
      </div>
    </div>}

    {/* Màn rộng: cột trái cố định khi cuộn. */}
    <aside className="hidden lg:sticky lg:top-3 lg:block lg:max-h-[calc(100vh-1.5rem)] lg:self-start lg:overflow-y-auto lg:rounded-xl lg:border lg:border-zinc-200 lg:bg-white lg:p-2 lg:shadow-sm dark:lg:border-zinc-800 dark:lg:bg-zinc-900">
      {nav()}
    </aside>
  </>;
};
