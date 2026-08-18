import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HrmOrgChartOverview from '../HrmOrgChartOverview';
import HrmStaffingPanel from '../HrmStaffingPanel';
import type {
  HrmOrgPositionSlot,
  HrmOrgTreeNode,
  HrmSharedOrgUnit,
  HrmSharedPosition,
  HrmStaffingRow,
} from '../../../../types/hrmSharedCatalog';

const unit: HrmSharedOrgUnit = {
  id: 'u-ql-da', code: 'QLDA', name: 'Phòng Quản lý dự án', type: 'department',
  parentId: 'k1', blockCode: 'K1', managerSlotId: null, orderIndex: 1, isActive: true,
};

const position = (overrides: Partial<HrmSharedPosition> = {}): HrmSharedPosition => ({
  id: 'p1', code: 'CV', name: 'Cố vấn', groupCode: 'CG', levelCode: 'E4',
  suggestedOrgUnitCode: null, isActive: true, sortOrder: 1, source: 'catalog',
  ...overrides,
});

const legacySlot: HrmOrgPositionSlot = {
  id: 's1', code: 'QLDA-LEGACY-065D8A01-01', orgUnitId: unit.id, positionId: 'p1',
  levelCode: 'E4', reportsToSlotId: null, slotType: 'STANDARD', status: 'ACTIVE',
  effectiveFrom: '2026-08-18', effectiveTo: null, sortOrder: 1, source: 'workforce_plan',
};

const staffingRow = (overrides: Partial<HrmStaffingRow> = {}): HrmStaffingRow => ({
  key: 'u-ql-da|p1|E4|', orgUnitId: unit.id, positionId: 'p1', levelCode: 'E4',
  reportsToSlotId: null, slots: [legacySlot], plannedCount: 11, occupiedCount: 0,
  vacantCount: 11, isManager: false, ...overrides,
});

describe('HRM organization workforce planning UI', () => {
  it('renders business staffing rows and never exposes technical slot codes', () => {
    const html = renderToStaticMarkup(
      <HrmStaffingPanel
        unit={unit}
        rows={[
          staffingRow(),
          staffingRow({ key: 'u-ql-da|p2|E5|', positionId: 'p2', plannedCount: 1, occupiedCount: 1, vacantCount: 0 }),
        ]}
        positions={[position(), position({ id: 'p2', name: 'Chuyên viên' })]}
        canManage
        onAdjust={() => undefined}
        onAssign={() => undefined}
        onSetManager={() => undefined}
      />,
    );

    expect(html).toContain('Cố vấn');
    expect(html).toContain('0 / 11');
    expect(html).toContain('Định biên');
    expect(html).toContain('Đã bố trí');
    expect(html).toContain('Còn trống');
    expect(html).toContain('Phân bổ nhân sự');
    expect(html).toContain('Chuyển vị trí');
    expect(html).not.toContain('QLDA-LEGACY');
  });

  it('shows the company and blocks while child departments start collapsed', () => {
    const department: HrmOrgTreeNode = { ...unit, children: [] };
    const block: HrmOrgTreeNode = {
      id: 'k1', code: 'K1', name: 'Khối Văn phòng', type: 'custom', parentId: 'root',
      blockCode: 'K1', managerSlotId: null, orderIndex: 1, isActive: true,
      children: [department],
    };
    const root: HrmOrgTreeNode = {
      id: 'root', code: 'TTG', name: 'Tiến Thịnh Group', type: 'company', parentId: null,
      blockCode: null, managerSlotId: null, orderIndex: 0, isActive: true,
      children: [block],
    };

    const html = renderToStaticMarkup(
      <HrmOrgChartOverview
        roots={[root]}
        selectedUnitId={null}
        query=""
        expansionCommand={{ expanded: false, version: 0 }}
        onSelectUnit={() => undefined}
      />,
    );

    expect(html).toContain('Tiến Thịnh Group');
    expect(html).toContain('Khối Văn phòng');
    expect(html).not.toContain('Phòng Quản lý dự án');
    expect(html).toContain('Mặc định thu gọn');
  });

  it('renders the official staffing empty state', () => {
    const html = renderToStaticMarkup(
      <HrmStaffingPanel
        unit={unit}
        rows={[]}
        positions={[position()]}
        canManage
        onAdjust={() => undefined}
        onAssign={() => undefined}
        onSetManager={() => undefined}
      />,
    );

    expect(html).toContain('Chưa có định biên chính thức');
    expect(html).toContain('Thiết lập định biên đầu tiên');
  });
});
