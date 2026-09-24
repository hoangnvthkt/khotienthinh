import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MaterialPlanEditor } from '../../components/project-v2/MaterialPlanEditor';
import { MaterialBasisDrawer } from '../../components/project-v2/MaterialBasisDrawer';
import type { MaterialCandidate, MaterialCandidateGroup } from '../projectV2/materialCandidateService';

vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return { Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    React.createElement('a', { href: to, ...props }, children) };
});

const group: MaterialCandidateGroup = {
  key: 'item:kg', itemId: 'item', itemCode: 'VT-01', itemName: 'Xi măng', unit: 'kg',
  calculatedQty: null, alreadyPlannedQty: '0.000000', availableQty: null,
  diagnostics: ['missing_conversion'], selectable: false, derivations: [],
};

describe('Project V2 material plan editor', () => {
  it('uses seven business columns and keeps unknown calculation visible', () => {
    const html = renderToStaticMarkup(<MaterialPlanEditor groups={[group]} selectedKeys={[]}
      entries={{}} onSelect={() => {}} onChange={() => {}}
      periodStart="2026-10-01" periodEnd="2026-10-31" siteName="Công trường A" siteId="site-a" />);
    for (const label of ['Mã và tên vật tư', 'Đơn vị', 'Nhu cầu tính toán', 'Số lượng đề nghị',
      'Ngày cần tại công trường', 'Điểm nhận', 'Ghi chú', 'Cơ sở tính toán', 'Chưa xác định'])
      expect(html).toContain(label);
    expect(html).not.toContain('norm_resource_id');
    expect(html).not.toContain('source_plan_hash');
    expect(html).not.toContain('missing_conversion');
  });

  it('explains the material calculation without showing norm resource IDs', () => {
    const derivation: MaterialCandidate = {
      candidateId: 'internal-candidate-id', itemId: 'item', itemCode: 'VT-01', itemName: 'Xi măng',
      unit: 'kg', calculatedQty: '10.000000', alreadyPlannedQty: '0.000000',
      availableQty: '10.000000', diagnostics: [], selectable: true,
      sourcePlanId: 'plan-id', sourceRevision: 2, sourcePlanHash: 'internal-hash',
      sourceLineId: 'line-id', sourceWorkName: 'Đào móng', sourceWorkQuantity: '2.000000',
      sourceUnit: 'm3', normResourceId: 'g8:internal-resource-id', normRevision: 'internal-revision-id',
      normFactor: '5.000000', coefficient: '1.000000',
      conversionNumerator: '1.000000', conversionDenominator: '1.000000', workspaceId: 'workspace',
    };
    const html = renderToStaticMarkup(<MaterialBasisDrawer group={{
      ...group, calculatedQty: '10.000000', availableQty: '10.000000', diagnostics: [],
      selectable: true, derivations: [derivation],
    }} onClose={() => {}} />);
    expect(html).toContain('Hao phí cho một đơn vị công việc');
    expect(html).toContain('Nhu cầu tính toán: 10 kg');
    expect(html).toContain('Còn có thể lập từ các công việc này');
    expect(html).not.toContain('10.000000');
    expect(html).not.toContain('g8:internal-resource-id');
    expect(html).not.toContain('internal-revision-id');
  });

  it('shows a readable calculated quantity on desktop and mobile', () => {
    const html = renderToStaticMarkup(<MaterialPlanEditor groups={[{
      ...group, calculatedQty: '10.000000', availableQty: '10.000000',
      diagnostics: [], selectable: true,
    }]} selectedKeys={[]} entries={{}} onSelect={() => {}} onChange={() => {}}
      periodStart="2026-10-01" periodEnd="2026-10-31" siteName="Công trường A" siteId="site-a" />);
    expect(html).toContain('Nhu cầu tính toán: 10');
    expect(html).not.toContain('10.000000');
  });
});
