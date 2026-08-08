import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rows: [] as any[],
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: { from: supabaseMocks.from },
}));

import { taskService } from '../projectService';

const makeQuery = () => {
  const query: any = {
    select: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => resolve({
      data: supabaseMocks.rows,
      error: null,
    }),
  };
  return query;
};

describe('taskService list cache', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.from.mockImplementation(() => makeQuery());
    (taskService as any).invalidateListCache?.();
  });

  it('can invalidate cached task rows after an authoritative progress RPC update', async () => {
    supabaseMocks.rows = [{
      id: 'task-1',
      project_id: 'project-1',
      construction_site_id: 'site-1',
      name: 'Task 1',
      progress: 10,
      sort_order: 1,
    }];
    expect((await taskService.list('project-1', 'site-1'))[0].progress).toBe(10);

    supabaseMocks.rows = [{
      id: 'task-1',
      project_id: 'project-1',
      construction_site_id: 'site-1',
      name: 'Task 1',
      progress: 65,
      sort_order: 1,
    }];
    expect((await taskService.list('project-1', 'site-1'))[0].progress).toBe(10);

    const invalidate = (taskService as any).invalidateListCache;
    expect(invalidate).toBeTypeOf('function');
    if (typeof invalidate !== 'function') return;
    invalidate();

    expect((await taskService.list('project-1', 'site-1'))[0].progress).toBe(65);
  });
});
