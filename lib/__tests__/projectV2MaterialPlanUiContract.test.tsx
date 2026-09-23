import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MaterialPlanEditor } from '../../components/project-v2/MaterialPlanEditor';
import type { MaterialCandidateGroup } from '../projectV2/materialCandidateService';

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
});
