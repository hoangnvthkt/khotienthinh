import { describe, expect, it } from 'vitest';
import type { WorkflowTemplate, WorkflowTemplateCategory } from '../../types';
import {
  buildSidebarGroups,
  moveSidebarGroup,
  orderSidebarGroups,
  toggleCollapsedGroup,
  UNCATEGORIZED_GROUP,
} from '../workflowSidebarGroups';

const template = (id: string, name: string, categoryId: string | null) => ({ id, name, categoryId }) as WorkflowTemplate;
const categories: WorkflowTemplateCategory[] = [
  { id: 'cat-site', name: 'Công trường', sortOrder: 1 },
  { id: 'cat-hr', name: 'Nhân sự', sortOrder: 2 },
  { id: 'cat-empty', name: 'Trống', sortOrder: 3 },
];

describe('buildSidebarGroups', () => {
  const groups = buildSidebarGroups([
    template('t1', 'Xin Hai', 'cat-site'),
    template('t2', 'Gia hạn HĐLĐ', 'cat-hr'),
    template('t3', 'CT Rico', 'cat-site'),
    template('t4', 'Mẫu lẻ', null),
    template('t5', 'Mẫu nhóm đã xóa', 'cat-deleted'),
  ], categories);

  it('follows category order, drops empty groups and ends with the uncategorized one', () => {
    expect(groups.map(group => group.key)).toEqual(['cat-site', 'cat-hr', UNCATEGORIZED_GROUP]);
  });

  it('sorts templates by name and sends unknown categories to "Chưa phân nhóm"', () => {
    expect(groups[0].templates.map(item => item.name)).toEqual(['CT Rico', 'Xin Hai']);
    expect(groups[2].templates.map(item => item.name)).toEqual(['Mẫu lẻ', 'Mẫu nhóm đã xóa']);
  });
});

describe('orderSidebarGroups', () => {
  const groups = ['a', 'b', 'c'].map(key => ({ key, name: key, templates: [] }));

  it('applies the saved order and appends groups the person has not arranged', () => {
    expect(orderSidebarGroups(groups, ['c', 'a']).map(group => group.key)).toEqual(['c', 'a', 'b']);
  });

  it('ignores saved keys that no longer exist', () => {
    expect(orderSidebarGroups(groups, ['gone', 'b']).map(group => group.key)).toEqual(['b', 'a', 'c']);
  });
});

describe('moveSidebarGroup / toggleCollapsedGroup', () => {
  it('moves a group to the target slot', () => {
    expect(moveSidebarGroup(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveSidebarGroup(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveSidebarGroup(['a', 'b'], 'zz', 0)).toEqual(['a', 'b']);
  });

  it('toggles collapsed state', () => {
    expect(toggleCollapsedGroup([], 'a')).toEqual(['a']);
    expect(toggleCollapsedGroup(['a', 'b'], 'a')).toEqual(['b']);
  });
});
