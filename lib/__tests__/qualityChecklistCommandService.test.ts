import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createQualityChecklistCommandService,
  QualityChecklistCommandError,
} from '../qualityChecklistCommandService';

const scope = { projectId: 'project-1', constructionSiteId: 'site-1' };

describe('qualityChecklistCommandService', () => {
  const rpc = vi.fn();
  const service = createQualityChecklistCommandService({
    rpc,
    newRequestId: () => 'generated-request-id',
  });

  beforeEach(() => rpc.mockReset());

  it('maps create, update, transition, delete and inspection attempt commands', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        requestId: 'generated-request-id',
        replayed: false,
        checklist: { id: 'checklist-1', updated_at: '2026-08-16T01:00:00Z' },
      },
      error: null,
    });

    await service.create(scope, { title: 'Hồ sơ' }, { userId: 'approver-1' });
    await service.update(scope, 'checklist-1', '2026-08-16T01:00:00Z', { title: 'Mới' });
    await service.transition(scope, 'checklist-1', '2026-08-16T01:00:00Z', 'submitted', {
      targetUserId: 'approver-1',
      reason: 'Trình duyệt',
    });
    await service.remove(scope, 'checklist-1', '2026-08-16T01:00:00Z');
    await service.createAttempt(scope, 'checklist-1', '2026-08-16T01:00:00Z', {
      attemptNumber: 1,
      result: 'PASSED',
      itemsData: [],
    });

    expect(rpc.mock.calls.map(call => call[0])).toEqual([
      'create_quality_checklist',
      'update_quality_checklist',
      'transition_quality_checklist',
      'delete_quality_checklist',
      'create_quality_inspection_attempt',
    ]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_request_id: 'generated-request-id',
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_payload: { title: 'Hồ sơ' },
      p_submission_target: { user_id: 'approver-1' },
    });
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_checklist_id: 'checklist-1',
      p_expected_updated_at: '2026-08-16T01:00:00Z',
      p_changes: { title: 'Mới' },
    });
  });

  it('marks replayed commands as non-mutating', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, requestId: 'retry-id', replayed: true, checklist: null },
      error: null,
    });

    const result = await service.remove(
      scope,
      'checklist-1',
      '2026-08-16T01:00:00Z',
      'retry-id',
    );

    expect(result).toMatchObject({ replayed: true, mutated: false });
  });

  it.each([
    ['QUALITY_PERMISSION_DENIED', 'không có quyền'],
    ['QUALITY_SCOPE_MISMATCH', 'không thuộc đúng'],
    ['QUALITY_INVALID_TRANSITION', 'trạng thái'],
    ['QUALITY_RECIPIENT_INVALID', 'người duyệt'],
    ['QUALITY_STALE_VERSION', 'đã thay đổi'],
    ['QUALITY_REQUEST_ID_REUSED', 'mã yêu cầu'],
  ])('maps %s to a stable Vietnamese error', async (code, messagePart) => {
    rpc.mockResolvedValue({ data: null, error: { message: `${code}: details` } });

    const error = await service.remove(
      scope,
      'checklist-1',
      '2026-08-16T01:00:00Z',
    ).catch(value => value);

    expect(error).toBeInstanceOf(QualityChecklistCommandError);
    expect(error).toMatchObject({ code, shouldReload: code === 'QUALITY_STALE_VERSION' });
    expect(error.message.toLowerCase()).toContain(messagePart);
  });
});
