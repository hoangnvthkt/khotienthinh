import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rows: [] as any[],
  responses: [] as Array<{ data: any[] | null; error: any }>,
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
    limit: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => resolve(
      supabaseMocks.responses.shift() || { data: supabaseMocks.rows, error: null },
    ),
  };
  return query;
};

describe('taskService list cache', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.from.mockImplementation(() => makeQuery());
    supabaseMocks.responses = [];
    (taskService as any).invalidateListCache?.();
  });

  it('loads legacy Cloud task rows when optimistic-version columns are not deployed yet', async () => {
    supabaseMocks.responses = [
      {
        data: null,
        error: {
          code: '42703',
          message: 'column project_tasks.row_version does not exist',
        },
      },
      {
        data: [{
          id: 'task-legacy',
          project_id: 'project-1',
          construction_site_id: 'site-1',
          name: 'Existing Cloud task',
          progress: 20,
          sort_order: 1,
        }],
        error: null,
      },
    ];

    const tasks = await taskService.list('project-1', 'site-1');

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task-legacy',
      name: 'Existing Cloud task',
      progress: 20,
      order: 1,
    });
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
