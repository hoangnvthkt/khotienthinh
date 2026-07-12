import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.rpc.mockReset();
  supabaseMock.rpc.mockResolvedValue({
    data: {
      id: 'cmr-1',
      project_id: 'project-1',
      construction_site_id: 'site-1',
      code: 'CMR-1',
      status: 'approved',
      lines: [],
      attachments: [],
    },
    error: null,
  });
});

describe('customMaterialRequestService Phase 3.3 workflow transitions', () => {
  it('routes status changes through the custom material transition RPC', async () => {
    const { customMaterialRequestService } = await import('../customMaterialRequestService');

    await customMaterialRequestService.setStatus('cmr-1', 'approved', 'approver-1', 'Đủ điều kiện');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('transition_custom_material_request_status', {
      p_request_id: 'cmr-1',
      p_status: 'approved',
      p_actor_user_id: 'approver-1',
      p_note: 'Đủ điều kiện',
    });
    expect(supabaseMock.from).not.toHaveBeenCalledWith('custom_material_requests');
  });
});
