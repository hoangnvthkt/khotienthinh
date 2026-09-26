import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import type { ProjectTask, ProjectWorkBoqItem } from '../../../types';

export interface DailyLogWbsPickerProps {
  tasks: ProjectTask[];
  workBoqItems: ProjectWorkBoqItem[];
  selectedTaskIds: ReadonlySet<string>;
  recentTaskIds: readonly string[];
  onConfirm(taskIds: string[]): void;
  onClose(): void;
}

type WbsFilter = 'planned_today' | 'planned_week' | 'active' | 'recent' | 'all';

const FILTERS: Array<{ value: WbsFilter; label: string }> = [
  { value: 'planned_today', label: 'Kế hoạch hôm nay' },
  { value: 'planned_week', label: 'Kế hoạch tuần này' },
  { value: 'active', label: 'Đang thi công' },
  { value: 'recent', label: 'Đã chọn gần đây' },
  { value: 'all', label: 'Tất cả' },
];

const normalizeSearch = (value?: string | null) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .toLowerCase();

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

export const DailyLogWbsPicker: React.FC<DailyLogWbsPickerProps> = ({
  tasks, workBoqItems, selectedTaskIds, recentTaskIds, onConfirm, onClose,
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WbsFilter>('all');
  const [draftIds, setDraftIds] = useState(() => new Set(selectedTaskIds));
  const [expandedIds, setExpandedIds] = useState(() => new Set(tasks.filter(task => !task.parentId).map(task => task.id)));

  const childrenByParent = useMemo(() => {
    const result = new Map<string | null, ProjectTask[]>();
    tasks.forEach(task => {
      const key = task.parentId || null;
      result.set(key, [...(result.get(key) || []), task]);
    });
    result.forEach(rows => rows.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)));
    return result;
  }, [tasks]);
  const parentIds = useMemo(() => new Set(tasks.map(task => task.parentId).filter(Boolean) as string[]), [tasks]);
  const boqByTask = useMemo(() => new Map(workBoqItems.filter(item => item.sourceTaskId).map(item => [item.sourceTaskId!, item])), [workBoqItems]);
  const recentIds = useMemo(() => new Set(recentTaskIds), [recentTaskIds]);
  const today = toDateKey(new Date());
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndKey = toDateKey(weekEnd);

  const matches = (task: ProjectTask) => {
    const keyword = normalizeSearch(query.trim());
    const textMatch = !keyword || normalizeSearch(`${task.wbsCode || ''} ${task.name}`).includes(keyword);
    if (!textMatch) return false;
    if (filter === 'recent') return recentIds.has(task.id);
    if (filter === 'active') return Number(task.progress || 0) > 0 && Number(task.progress || 0) < 100;
    if (filter === 'planned_today') return task.startDate <= today && task.endDate >= today;
    if (filter === 'planned_week') return task.startDate <= weekEndKey && task.endDate >= today;
    return true;
  };

  const branchMatches = (task: ProjectTask): boolean => matches(task)
    || (childrenByParent.get(task.id) || []).some(branchMatches);

  const toggleTask = (taskId: string) => {
    setDraftIds(current => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  const renderBranch = (task: ProjectTask, depth = 0): React.ReactNode => {
    if (!branchMatches(task)) return null;
    const isParent = parentIds.has(task.id);
    const isExpanded = expandedIds.has(task.id);
    const boq = boqByTask.get(task.id);
    const plannedQuantity = Number(boq?.plannedQty || task.provisionalQuantity || 0);
    const unit = boq?.unit || task.fallbackUnit || '';
    return (
      <React.Fragment key={task.id}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/70" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          <div className="flex min-w-0 items-center gap-2">
            {isParent ? (
              <button type="button" aria-label={`${isExpanded ? 'Thu gọn' : 'Mở'} ${task.wbsCode || ''} ${task.name}`}
                onClick={() => setExpandedIds(current => {
                  const next = new Set(current);
                  if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
                  return next;
                })}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <input type="checkbox" checked={draftIds.has(task.id)} onChange={() => toggleTask(task.id)}
                aria-label={`Chọn ${task.wbsCode || ''} ${task.name}`.trim()}
                className="h-4 w-4 shrink-0 accent-teal-600" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {[task.wbsCode, task.name].filter(Boolean).join(' ')}
              </div>
              {!isParent && (
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {plannedQuantity > 0 ? `${plannedQuantity.toLocaleString('vi-VN')} ${unit}` : 'Chưa có khối lượng kế hoạch'}
                  {task.endDate ? `, hoàn thành ${new Date(`${task.endDate}T00:00:00`).toLocaleDateString('vi-VN')}` : ''}
                </div>
              )}
            </div>
          </div>
          {!isParent && draftIds.has(task.id) && <Check size={17} className="text-teal-600" aria-hidden="true" />}
        </div>
        {isParent && isExpanded && (childrenByParent.get(task.id) || []).map(child => renderBranch(child, depth + 1))}
      </React.Fragment>
    );
  };

  const roots = childrenByParent.get(null) || tasks.filter(task => !tasks.some(parent => parent.id === task.parentId));
  const hasResults = roots.some(branchMatches);

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/45" role="dialog" aria-modal="true" aria-label="Chọn công việc WBS">
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Chọn công việc WBS</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Chỉ công việc lá có thể đưa vào phiếu nguồn.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng bộ chọn WBS" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-700">
          <label className="relative block">
            <span className="sr-only">Tìm WBS</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm theo mã hoặc tên công việc"
              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Lọc WBS">
            {FILTERS.map(item => <button key={item.value} type="button" onClick={() => setFilter(item.value)}
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold ${filter === item.value ? 'border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{item.label}</button>)}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {hasResults ? roots.map(task => renderBranch(task)) : (
            <div className="mx-auto max-w-sm py-16 text-center">
              <p className="font-semibold text-slate-700 dark:text-slate-200">Không có WBS phù hợp</p>
              <button type="button" onClick={() => { setQuery(''); setFilter('all'); }} className="mt-3 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">Xóa tìm kiếm và bộ lọc</button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-slate-700">
          <span className="text-sm text-slate-500">Đã chọn {draftIds.size} công việc</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
            <button type="button" onClick={() => onConfirm([...draftIds])} className="h-10 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 active:translate-y-px">Đưa vào phiếu</button>
          </div>
        </div>
      </div>
    </div>
  );
};
