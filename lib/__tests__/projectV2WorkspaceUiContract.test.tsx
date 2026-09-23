import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProjectV2Shell } from '../../components/project-v2/ProjectV2Shell';
import { ProjectV2PlanList } from '../../components/project-v2/ProjectV2PlanList';

const plan = { id: 'plan-1', workspaceId: 'workspace-1', planType: 'month' as const,
  code: 'M-1', title: 'Kế hoạch tháng 10', status: 'draft' as const,
  periodStart: '2026-10-01', periodEnd: '2026-10-31', ownerUserId: null,
  creatorUserId: 'user-1', submitterUserId: null, approverUserId: null,
  revision: 1, version: 1, createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z' };

describe('Project V2 workspace first viewport', () => {
  it('shows project identity, three-step flow, current plan type and one primary action', () => {
    const html = renderToStaticMarkup(<ProjectV2Shell projectName="Dự án Một"
      siteName="Công trường A" planType="month" primaryAction={<button>Tạo kế hoạch tháng</button>}>
      <p>Danh sách kế hoạch</p>
    </ProjectV2Shell>);
    expect(html).toContain('Dự án Một');
    expect(html).toContain('Công trường A');
    expect(html).toContain('Kế hoạch tháng');
    expect(html).toContain('Thi công');
    expect(html).toContain('Vật tư');
    expect(html).toContain('Tạo kế hoạch tháng');
  });

  it('shows status, owner, period and card layout at mobile width', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ProjectV2PlanList plans={[plan]}
      ownerNames={{ 'user-1': 'Nguyễn A' }} /></MemoryRouter>);
    expect(html).toContain('Nháp');
    expect(html).toContain('Nguyễn A');
    expect(html).toContain('01/10/2026');
    expect(html).toContain('31/10/2026');
    expect(html).toContain('sm:hidden');
  });
});
