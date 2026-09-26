import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { VerifiedResourceUsageEvidence } from '../../types';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { projectResourceEvidenceService } from '../projectResourceEvidenceService';
import { ResourceUsageEvidencePanel } from '../../components/project/finance/ResourceUsageEvidencePanel';
import { ResourceUsageEvidenceDrawer } from '../../components/project/finance/ResourceUsageEvidenceDrawer';

const labor: VerifiedResourceUsageEvidence = {
  resourceLineId: 'line-1', resourceType: 'labor', dailyLogId: 'log-1',
  summarySourceId: 'source-1', contributionId: 'contribution-1',
  revisionNo: 1, revisionState: 'current', projectId: 'project-1',
  constructionSiteId: 'site-1', logDate: '2026-09-23', workAreaCode: 'A',
  workAreaName: 'Khu A', taskId: 'task-1', wbsCode: '1.1', taskName: 'Bê tông móng',
  provider: { entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: 'Tổ anh Minh' },
  peopleCount: 5, totalLaborHours: 40, sourceUserName: 'Kỹ thuật A',
  verifiedByName: 'CHT', verifiedAt: '2026-09-23T10:00:00Z',
};

describe('resource usage evidence panel', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the scoped RPC and allowlists returned evidence', async () => {
    rpc.mockResolvedValue({ data: {
      rows: [{ ...labor, totalCost: 900000, provider: { ...labor.provider, unitCost: 100000 } }],
      totals: { providerCount: 1, peopleCount: 5, totalLaborHours: 40, machineCount: 0, totalMachineHours: 15, lineCount: 1 },
      unknownLegacyCount: 2, nextCursor: null,
    }, error: null });
    const result = await projectResourceEvidenceService.getEvidence({
      projectId: 'project-1', constructionSiteId: 'site-1',
      fromDate: '2026-09-01', toDate: '2026-09-30', limit: 200,
    });
    expect(rpc).toHaveBeenCalledWith('get_verified_resource_usage_evidence_v1', expect.objectContaining({
      p_project_id: 'project-1', p_construction_site_id: 'site-1', p_limit: 200,
    }));
    expect(JSON.stringify(result)).not.toMatch(/totalCost|unitCost|900000|100000/);
    expect(result.groups[0].providerKey).toBe('manual:day_labor:to anh minh');
  });

  it('shows physical KPIs, provider lineage and legacy unknown without money copy', () => {
    const html = renderToStaticMarkup(<ResourceUsageEvidencePanel initialData={{
      rows: [labor, { ...labor, resourceLineId: 'machine-1', resourceType: 'machine', machineCount: 1,
        totalLaborHours: null, peopleCount: null, totalMachineHours: 15 }],
      groups: [{ providerKey: 'manual:day_labor:to anh minh', provider: labor.provider,
        peopleCount: 5, totalLaborHours: 40, machineCount: 1, totalMachineHours: 15, lineCount: 2 }],
      totals: { providerCount: 1, peopleCount: 5, totalLaborHours: 40, machineCount: 1, totalMachineHours: 15, lineCount: 2 },
      unknownLegacyCount: 2, nextCursor: null,
    }} projectId="project-1" constructionSiteId="site-1" />);
    expect(html).toContain('Bằng chứng nhân công &amp; máy');
    expect(html).toContain('aria-label="40 giờ công"');
    expect(html).toContain('aria-label="15 giờ máy"');
    expect(html).toContain('Tổ anh Minh');
    expect(html).toContain('chưa đủ semantics');
    expect(html).not.toMatch(/đồng|VNĐ|Đơn giá|Thành tiền/i);
  });

  it('shows a useful empty state without turning unknown legacy into zero', () => {
    const html = renderToStaticMarkup(<ResourceUsageEvidencePanel projectId="project-1" initialData={{
      rows: [], groups: [], totals: { providerCount: 0, peopleCount: 0, totalLaborHours: 0,
        machineCount: 0, totalMachineHours: 0, lineCount: 0 }, unknownLegacyCount: 3, nextCursor: null,
    }} />);
    expect(html).toContain('Chưa có bằng chứng đã xác nhận');
    expect(html).toContain('3 dòng dữ liệu cũ chưa đủ semantics');
  });

  it('maps permission denial and date errors to actionable copy', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'RESOURCE_EVIDENCE_SCOPE_DENIED' } });
    await expect(projectResourceEvidenceService.getEvidence({ projectId: 'project-1', fromDate: '2026-09-01', toDate: '2026-09-30' }))
      .rejects.toThrow('chưa được cấp quyền');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'INVALID_DATE_RANGE' } });
    await expect(projectResourceEvidenceService.getEvidence({ projectId: 'project-1', fromDate: '2024-01-01', toDate: '2026-09-30' }))
      .rejects.toThrow('Khoảng ngày không hợp lệ');
  });

  it('rejects incomplete RPC totals instead of showing unknown as zero', async () => {
    rpc.mockResolvedValue({ data: {
      rows: [labor], totals: { providerCount: 1 }, unknownLegacyCount: 0, nextCursor: null,
    }, error: null });
    await expect(projectResourceEvidenceService.getEvidence({
      projectId: 'project-1', fromDate: '2026-09-01', toDate: '2026-09-30',
    })).rejects.toThrow('Dữ liệu bằng chứng nguồn lực chưa đầy đủ');
  });

  it('keeps provider snapshot, revision state, lineage and the original Daily Log link in the drawer', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ResourceUsageEvidenceDrawer row={{
      ...labor, revisionState: 'superseded', revisionNo: 2,
      provider: { entryMode: 'catalog', partnerId: 'inactive-partner', providerNameSnapshot: 'NCC cũ đã khóa' },
    }} onClose={() => {}} /></MemoryRouter>);
    expect(html).toContain('NCC cũ đã khóa');
    expect(html).toContain('Đã thay thế');
    expect(html).toContain('Kỹ thuật A');
    expect(html).toContain('/da?tab=dailylog&amp;dailyLogId=log-1');
    expect(html).not.toMatch(/đồng|VNĐ|Đơn giá|Thành tiền/i);
  });
});
