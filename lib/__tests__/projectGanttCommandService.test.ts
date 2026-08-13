import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectGanttCommandService,
  ProjectGanttCommandError,
} from '../projectGanttCommandService';

const scope = { projectId: 'project-1', constructionSiteId: 'site-1' };

describe('projectGanttCommandService', () => {
  const rpc = vi.fn();
  const invalidateTasks = vi.fn();
  const service = createProjectGanttCommandService({
    rpc,
    invalidateTasks,
    newRequestId: () => 'generated-request-id',
  });

  beforeEach(() => {
    rpc.mockReset();
    invalidateTasks.mockReset();
  });

  it('sends one snake_case batch RPC and maps the authoritative task response', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        requestId: 'generated-request-id',
        replayed: false,
        tasks: [{
          id: 'task-1',
          project_id: 'project-1',
          construction_site_id: 'site-1',
          row_version: 4,
          updated_at: '2026-08-13T07:00:00Z',
        }],
      },
      error: null,
    });

    const result = await service.saveTasks(scope, [{
      id: 'task-1',
      expectedRowVersion: 3,
      startDate: '2026-08-13',
      contractItemIds: ['contract-1'],
    }]);

    expect(rpc).toHaveBeenCalledWith('save_project_gantt_tasks', {
      p_request_id: 'generated-request-id',
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_changes: [{
        id: 'task-1',
        expected_row_version: 3,
        start_date: '2026-08-13',
        contract_item_ids: ['contract-1'],
      }],
    });
    expect(result).toMatchObject({
      ok: true,
      requestId: 'generated-request-id',
      replayed: false,
      mutated: true,
      tasks: [{ rowVersion: 4, updatedAt: '2026-08-13T07:00:00Z' }],
    });
    expect(invalidateTasks).toHaveBeenCalledTimes(1);
  });

  it('keeps the caller request ID for retry and does not apply replay twice', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, requestId: 'retry-id', replayed: true, tasks: [] },
      error: null,
    });

    const result = await service.saveTasks(scope, [], 'retry-id');

    expect(rpc.mock.calls[0][1].p_request_id).toBe('retry-id');
    expect(result.mutated).toBe(false);
    expect(invalidateTasks).not.toHaveBeenCalled();
  });

  it('maps every supporting command to its public RPC contract', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, requestId: 'generated-request-id', replayed: false },
      error: null,
    });

    await service.deleteTaskTree(scope, 'task-1', 4);
    await service.replaceTaskContractItems(scope, 'task-1', 4, ['contract-1']);
    await service.createBaseline(scope, 'Baseline 1');
    await service.transitionDelayEvent(
      scope, 'event-1', 'accepted', '2026-08-13T07:00:00Z',
    );
    await service.applyForecast(scope, {
      revision: { id: 'revision-1', sourceDelayEventIds: ['event-1'] },
      revisionTasks: [{ taskId: 'task-1', beforeStart: '2026-08-13' }],
      taskChanges: [{ id: 'task-1', expectedRowVersion: 4 }],
    });

    expect(rpc.mock.calls.map(call => call[0])).toEqual([
      'delete_project_gantt_task_tree',
      'replace_project_gantt_task_contract_items',
      'create_project_gantt_baseline',
      'transition_project_gantt_delay_event',
      'apply_project_gantt_forecast',
    ]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_task_id: 'task-1', p_expected_row_version: 4,
    });
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_contract_item_ids: ['contract-1'],
    });
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_name: 'Baseline 1' });
    expect(rpc.mock.calls[3][1]).toMatchObject({
      p_event_id: 'event-1',
      p_status: 'accepted',
      p_expected_updated_at: '2026-08-13T07:00:00Z',
    });
    expect(rpc.mock.calls[4][1]).toMatchObject({
      p_revision: { id: 'revision-1', source_delay_event_ids: ['event-1'] },
      p_revision_tasks: [{ task_id: 'task-1', before_start: '2026-08-13' }],
      p_task_changes: [{ id: 'task-1', expected_row_version: 4 }],
    });
  });

  it('loads a fixed-room minimal catalog without invalidating task state', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'task-1', rowVersion: 5, contractItemIds: ['contract-1'] }],
      error: null,
    });

    const rows = await service.loadCatalog(scope, 'weekly_progress');

    expect(rpc).toHaveBeenCalledWith('get_project_gantt_catalog', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_consumer_room: 'weekly_progress',
    });
    expect(rows[0]).toMatchObject({ rowVersion: 5, contractItemIds: ['contract-1'] });
    expect(invalidateTasks).not.toHaveBeenCalled();
  });

  it.each([
    ['GANTT_PERMISSION_DENIED', 'không có quyền'],
    ['GANTT_SCOPE_MISMATCH', 'không thuộc đúng dự án'],
    ['GANTT_STALE_VERSION', 'đã thay đổi'],
    ['GANTT_DELETE_BLOCKED', 'không thể xóa'],
    ['GANTT_REQUEST_ID_REUSED', 'mã yêu cầu'],
  ])('converts %s into a stable Vietnamese error', async (code, messagePart) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: `${code}: database details` },
    });

    const error = await service.saveTasks(scope, []).catch(value => value);

    expect(error).toBeInstanceOf(ProjectGanttCommandError);
    expect(error).toMatchObject({
      code,
      shouldReload: code === 'GANTT_STALE_VERSION',
    });
    expect(error.message.toLowerCase()).toContain(messagePart);
    expect(invalidateTasks).not.toHaveBeenCalled();
  });
});
