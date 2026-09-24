import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MonthPlanEditor } from '../../components/project-v2/MonthPlanEditor';
import { ConstructionPlanEditor } from '../../components/project-v2/ConstructionPlanEditor';
import { ProjectV2SourcePicker } from '../../components/project-v2/ProjectV2SourcePicker';
import { ProjectV2PlanWorkflowActions } from '../../components/project-v2/ProjectV2PlanWorkflowActions';
import type { ProjectV2PlanSummary } from '../projectV2/readService';

const plan = (status: ProjectV2PlanSummary['status']): ProjectV2PlanSummary => ({
  id: 'p', workspaceId: 'w', planType: 'month', code: 'M1', title: 'Tháng một', status,
  periodStart: '2026-09-01', periodEnd: '2026-09-30', ownerUserId: null,
  followerUserId: null, creatorUserId: 'creator', submitterUserId: 'submitter',
  approverUserId: null, revision: 1, version: 1,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

describe('Project V2 plan UI contract', () => {
  it('does not show internal source codes in the monthly work picker', () => {
    const html = renderToStaticMarkup(<ProjectV2SourcePicker workspaceId="w" type="month"
      monthCandidates={[{ contractItemId: 'i', code: '01', title: 'Móng', unit: 'm3',
        parentId: null, isGroup: false, contractQuantity: '100.000000',
        previousPlannedQuantity: '20.000000', availableQuantity: '80.000000',
        baselineRevision: 'v1', baselineState: 'verified', workspaceId: 'w',
        unavailableReason: 'boq_closure_not_supported' }]}
      selectedIds={[]} onChange={() => {}} />);
    expect(html).toContain('Nguồn chưa thể chọn. Kiểm tra dữ liệu kế hoạch.');
    expect(html).not.toContain('boq_closure_not_supported');
  });

  it('explains an unconfirmed schedule in business language', () => {
    const html = renderToStaticMarkup(<ProjectV2SourcePicker workspaceId="w" type="month"
      monthCandidates={[{ contractItemId: 'i', code: '01', title: 'Móng', unit: 'm3',
        parentId: null, isGroup: false, contractQuantity: null,
        previousPlannedQuantity: null, availableQuantity: null,
        baselineRevision: null, baselineState: 'unverified', workspaceId: 'w',
        unavailableReason: 'Baseline chưa được xác nhận' }]}
      selectedIds={[]} onChange={() => {}} />);
    expect(html).toContain('Tiến độ gốc chưa được xác nhận');
    expect(html).not.toContain('Baseline chưa được xác nhận');
  });

  it('shows monthly business columns without price when capability is absent', () => {
    const html = renderToStaticMarkup(<MonthPlanEditor rows={[{
      contractItemId: 'i', code: '01', title: 'Móng', unit: 'm3', parentId: null,
      isGroup: false, contractQuantity: '100.000000', previousPlannedQuantity: '20.000000',
      availableQuantity: '80.000000', baselineRevision: 'v1', baselineState: 'verified',
      workspaceId: 'w', unavailableReason: null,
    }]} quantities={{ i: '8' }} onChange={() => {}} />);
    expect(html).toContain('Khối lượng hợp đồng');
    expect(html).toContain('Đã lập trước kỳ');
    expect(html).toContain('Kế hoạch kỳ này');
    expect(html).not.toContain('Đơn giá hợp đồng');
    expect(html).not.toContain('Thành tiền');
  });

  it('uses scoped V2 crew choices and reports unknown availability', () => {
    const html = renderToStaticMarkup(<ConstructionPlanEditor rows={[{
      sourcePlanId: 'p1', sourceRevision: 1, sourcePlanHash: 'hash', sourceLineId: 'l1',
      sourceQuantity: null, availableQuantity: null, sourceUnit: 'm3', workspaceId: 'w',
      sourceStatus: 'approved', unavailableReason: null, code: 'M01', title: 'Móng',
      workItemId: 'work-1', contractItemId: null,
    }]} entries={{}} onChange={() => {}} crews={[{ id: 'crew-1', name: 'Tổ 1', workspaceId: 'w' }]}
      periodStart="2026-09-01" periodEnd="2026-09-07" />);
    expect(html).toContain('Chưa xác định');
    expect(html).toContain('Tổ 1');
    expect(html).not.toContain('safety_teams');
  });

  it('keeps approval off creator/submitter and shows primary action by status', () => {
    const caps = { edit: true, submit: true, approve: true, return: true, revise: true, cancel: false };
    const render = (status: ProjectV2PlanSummary['status'], actorId: string) => renderToStaticMarkup(
      <ProjectV2PlanWorkflowActions plan={plan(status)} capabilities={caps} actorId={actorId}
        busy={false} onAction={() => {}} />);
    expect(render('draft', 'creator')).toContain('Gửi duyệt');
    expect(render('pending_approval', 'submitter')).not.toContain('Phê duyệt');
    expect(render('pending_approval', 'handler')).toContain('Phê duyệt');
    expect(render('approved', 'handler')).toContain('Tạo bản điều chỉnh');
  });
});
