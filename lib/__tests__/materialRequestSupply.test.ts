import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { RequestStatus, type MaterialRequest, type User } from '../../types';
import { getMaterialRequestNextAction } from '../erpWorkflow';
import { MATERIAL_REQUEST_KANBAN_COLUMNS, getMaterialRequestSlaState, resolveRequestKanbanStage } from '../materialRequestService';

// Việc 1: bỏ bước "Tạo đợt giao" — duyệt xong là Đang cung ứng, tự Hoàn tất hoặc được Kết thúc.

const request = (patch: Partial<MaterialRequest>): MaterialRequest => ({
  id: 'mr-1', code: 'MR-1', title: 'Thép', requestOrigin: 'project', projectId: 'p1', siteWarehouseId: 'wh', requesterId: 'u1',
  status: RequestStatus.APPROVED, items: [], createdDate: '2026-09-01T00:00:00Z', expectedDate: '2026-09-10T00:00:00Z',
  ...patch,
} as MaterialRequest);
const user = { id: 'u9', role: 'EMPLOYEE' } as unknown as User;

describe('Đề xuất vật tư sau khi duyệt', () => {
  it('hiển thị bước batch_planning là Đang cung ứng và có cột Đã kết thúc', () => {
    expect(MATERIAL_REQUEST_KANBAN_COLUMNS.find(c => c.id === 'batch_planning')?.label).toBe('Đang cung ứng');
    expect(MATERIAL_REQUEST_KANBAN_COLUMNS.some(c => c.id === 'ended')).toBe(true);
    expect(MATERIAL_REQUEST_KANBAN_COLUMNS.some(c => /tạo đợt/i.test(c.label))).toBe(false);
  });

  it('đề xuất kết thúc nằm ở cột Đã kết thúc, hoàn tất ở Hoàn tất', () => {
    expect(resolveRequestKanbanStage(request({ status: RequestStatus.COMPLETED, workflowStep: 'ended' }))).toBe('ended');
    expect(resolveRequestKanbanStage(request({ status: RequestStatus.COMPLETED, workflowStep: 'completed' }))).toBe('completed');
    expect(resolveRequestKanbanStage(request({ status: RequestStatus.IN_TRANSIT, workflowStep: 'batch_planning' }))).toBe('batch_planning');
  });

  it('Đang cung ứng không bị báo quá hạn theo SLA 48h cũ', () => {
    const r = request({ workflowStep: 'batch_planning', workflowStepStartedAt: '2026-09-01T00:00:00Z', workflowStepDueAt: '2026-09-03T00:00:00Z', workflowStepSlaHours: 48 });
    expect(getMaterialRequestSlaState(r)).toBe('none');
  });

  it('nhãn trạng thái đề xuất dự án', () => {
    expect(getMaterialRequestNextAction(request({ status: RequestStatus.IN_TRANSIT }), user).label).toBe('Đang cung ứng');
    expect(getMaterialRequestNextAction(request({ status: RequestStatus.COMPLETED, workflowStep: 'ended' }), user).label).toBe('Đã kết thúc');
  });

  it('migration: ngưỡng 98%, kết thúc có lý do, Cấp từ kho chỉ khi kho đã bật chuyển kho 2 bước', () => {
    const sql = readFileSync('supabase/migrations/20261008133300_material_request_supply_v1.sql', 'utf8');
    expect(sql).toContain('s.received_qty >= s.need_qty * 0.98');
    expect(sql).toContain("message = 'MR_SUPPLY_REASON_REQUIRED'");
    expect(sql).toContain("message = 'MR_SUPPLY_TRANSFER_NOT_ENABLED'");
    expect(sql).toContain("'material_request', 'approve'");
    expect(sql).toMatch(/revoke all on function public\.end_material_request_supply_v1\(jsonb\) from public, anon;/);
  });
});
