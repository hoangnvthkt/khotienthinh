import type { WorkflowTemplate, WorkflowTemplateCategory } from '../types';

export const UNCATEGORIZED_GROUP = '__uncategorized__';

export interface SidebarTemplateGroup {
  key: string;
  name: string;
  templates: WorkflowTemplate[];
}

export interface SidebarGroupPrefs {
  /** Group keys in the order this person wants to see them. */
  order: string[];
  collapsed: string[];
}

export const EMPTY_SIDEBAR_GROUP_PREFS: SidebarGroupPrefs = { order: [], collapsed: [] };

/**
 * Same grouping as Mẫu quy trình: category order, then "Chưa phân nhóm". Empty groups are
 * dropped because the sidebar only lists templates a person can start or follow.
 */
export const buildSidebarGroups = (
  templates: WorkflowTemplate[],
  categories: WorkflowTemplateCategory[],
): SidebarTemplateGroup[] => {
  const known = new Set(categories.map(category => category.id));
  const groupOf = (template: WorkflowTemplate) =>
    template.categoryId && known.has(template.categoryId) ? template.categoryId : UNCATEGORIZED_GROUP;
  const byName = (a: WorkflowTemplate, b: WorkflowTemplate) => a.name.localeCompare(b.name, 'vi');
  return [
    ...categories.map(category => ({ key: category.id, name: category.name })),
    { key: UNCATEGORIZED_GROUP, name: 'Chưa phân nhóm' },
  ]
    .map(group => ({ ...group, templates: templates.filter(template => groupOf(template) === group.key).sort(byName) }))
    .filter(group => group.templates.length > 0);
};

/**
 * Applies a person's saved order. Groups they have never arranged (new categories) keep their
 * default position after the arranged ones; saved keys that no longer exist are ignored.
 */
export const orderSidebarGroups = (groups: SidebarTemplateGroup[], order: string[]): SidebarTemplateGroup[] => {
  const byKey = new Map(groups.map(group => [group.key, group]));
  const arranged = order.flatMap(key => (byKey.has(key) ? [byKey.get(key)!] : []));
  const arrangedKeys = new Set(arranged.map(group => group.key));
  return [...arranged, ...groups.filter(group => !arrangedKeys.has(group.key))];
};

/** New full order after moving `key` so that it sits at `targetIndex` of the visible groups. */
export const moveSidebarGroup = (visibleKeys: string[], key: string, targetIndex: number): string[] => {
  const from = visibleKeys.indexOf(key);
  if (from < 0) return visibleKeys;
  const next = visibleKeys.filter(item => item !== key);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, key);
  return next;
};

export const toggleCollapsedGroup = (collapsed: string[], key: string): string[] =>
  collapsed.includes(key) ? collapsed.filter(item => item !== key) : [...collapsed, key];

const storageKey = (userId: string) => `vioo.wf.sidebar-groups.v1.${userId}`;

export const loadSidebarGroupPrefs = (userId: string): SidebarGroupPrefs => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || 'null');
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    return parsed ? { order: strings(parsed.order), collapsed: strings(parsed.collapsed) } : EMPTY_SIDEBAR_GROUP_PREFS;
  } catch {
    return EMPTY_SIDEBAR_GROUP_PREFS;
  }
};

export const saveSidebarGroupPrefs = (userId: string, prefs: SidebarGroupPrefs): void => {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: the arrangement just lasts for this session.
  }
};
