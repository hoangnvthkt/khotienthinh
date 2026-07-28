import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { requestRuntimeService } from '../requestRuntimeService';

describe('requestRuntimeService.submit', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('submits one immutable request snapshot through the atomic command', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        requestId: 'rq-1',
        requestCode: 'RQ-2026-000001',
        status: 'PENDING',
        workflowInstanceId: 'wf-1',
        workflowSubjectId: 'ws-1',
        currentBlockKeys: ['manager'],
        updatedAt: '2026-07-28T10:00:00.000Z',
      },
      error: null,
    });

    await requestRuntimeService.submit({
      requestTemplateVersionId: 'rtv-1',
      title: 'Đề xuất cấp tài khoản',
      description: 'Nội dung',
      formData: { employee_name: 'Nguyễn Văn A' },
      dynamicApproversByBlock: {},
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('submit_request', expect.objectContaining({
      p_request_template_version_id: 'rtv-1',
      p_title: 'Đề xuất cấp tài khoản',
      p_description: 'Nội dung',
      p_form_data: { employee_name: 'Nguyễn Văn A' },
      p_dynamic_approvers_by_block: {},
      p_idempotency_key: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('surfaces RPC failures and empty results', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'forbidden' } });
    await expect(requestRuntimeService.submit({
      requestTemplateVersionId: 'rtv-1',
      title: 'Title',
      description: '',
      formData: {},
      dynamicApproversByBlock: {},
      idempotencyKey: '11111111-1111-4111-8111-111111111112',
    })).rejects.toEqual({ message: 'forbidden' });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(requestRuntimeService.submit({
      requestTemplateVersionId: 'rtv-1',
      title: 'Title',
      description: '',
      formData: {},
      dynamicApproversByBlock: {},
      idempotencyKey: '11111111-1111-4111-8111-111111111113',
    })).rejects.toThrow('submit_request không trả về dữ liệu.');
  });
});
