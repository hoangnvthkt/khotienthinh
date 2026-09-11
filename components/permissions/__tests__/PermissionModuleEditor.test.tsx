import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EffectivePermissionSource } from '../../../types';
import { PermissionAdminCatalog, PermissionCatalogApplication } from '../../../lib/permissions/permissionTypes';
import PermissionModuleCard from '../PermissionModuleCard';
import { PermissionModuleEditorView } from '../PermissionModuleEditor';
import RetainedPermissionGrantNotice from '../RetainedPermissionGrantNotice';

const assetApplication: PermissionCatalogApplication = {
  code: 'asset',
  label: 'Tài sản',
  description: 'Danh mục, cấp phát, bảo trì và kiểm kê',
  sortOrder: 80,
  hasDefaultViewBundle: true,
  modules: [
    ['asset.catalog', 'Danh mục tài sản'],
    ['asset.assignment', 'Cấp phát tài sản'],
    ['asset.maintenance', 'Bảo trì tài sản'],
    ['asset.audit', 'Kiểm kê tài sản'],
  ].map(([code, label], index) => ({
    code,
    label,
    sortOrder: (index + 1) * 10,
    actions: [
      {
        action: 'view',
        label: 'Xem',
        permissionCode: `${code}.view`,
        scopeTypes: ['global'],
        sortOrder: 10,
        riskLevel: 'normal',
        grantReadiness: 'enforced',
        directGrantAllowed: true,
        directGrantRequiresExpiry: false,
        isDefaultView: true,
        defaultScopeType: 'global',
      },
      ...(code === 'asset.assignment' ? [{
        action: 'approve',
        label: 'Duyệt',
        permissionCode: 'asset.assignment.approve',
        scopeTypes: ['global'] as const,
        sortOrder: 30,
        riskLevel: 'sensitive' as const,
        grantReadiness: 'enforced' as const,
        directGrantAllowed: true,
        directGrantRequiresExpiry: true,
        isDefaultView: false,
      }] : []),
    ],
  })),
};

const catalog: PermissionAdminCatalog = {
  generatedAt: '2026-09-11T07:45:16.000Z',
  applications: [assetApplication],
};

const inheritedSources: EffectivePermissionSource[] = [{
  permissionCode: 'asset.catalog.view',
  sourceType: 'ROLE',
  sourceCode: 'HR',
  sourceLabel: 'HR',
  scopeType: 'global',
  scopeId: '*',
  isBusinessApproval: false,
  metadata: {},
}];

describe('PermissionModuleEditor', () => {
  it('shows retained hidden grants as read-only system permissions', () => {
    const html = renderToStaticMarkup(
      <RetainedPermissionGrantNotice grants={[{
        userId: 'user-1',
        permissionCode: 'system.ts.view',
        scopeType: 'global',
        scopeId: '*',
        isActive: true,
      }]} />,
    );

    expect(html).toContain('Quyền hệ thống đang giữ lại');
    expect(html).toContain('system.ts.view');
    expect(html).toContain('Chỉ đọc');
    expect(html).not.toContain('type="checkbox"');
  });

  it('renders a compact collapsed Module card with a separate disclosure control', () => {
    const html = renderToStaticMarkup(
      <PermissionModuleCard
        application={assetApplication}
        state="unchecked"
        expanded={false}
        grants={[]}
        inheritedSources={[]}
        disabled={false}
        pendingRemovalCount={0}
        onToggleSelected={vi.fn()}
        onToggleExpanded={vi.fn()}
        onToggleAction={vi.fn()}
        onConfirmRemoval={vi.fn()}
        onCancelRemoval={vi.fn()}
      />,
    );

    expect(html).toContain('Tài sản');
    expect(html).toContain('4 phân hệ được xem');
    expect(html).toContain('Cấp quyền Xem cho Tài sản');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Quyền nâng cao');
  });

  it('shows inherited provenance and advanced risk/expiry information when expanded', () => {
    const html = renderToStaticMarkup(
      <PermissionModuleEditorView
        catalog={catalog}
        grants={[]}
        inheritedSources={inheritedSources}
        targetUserId="user-1"
        disabled={false}
        initialExpandedApplicationCodes={['asset']}
        initialExpandedAdvancedModuleCodes={['asset.assignment']}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Danh mục tài sản');
    expect(html).toContain('Quyền nâng cao');
    expect(html).toContain('Kế thừa từ HR');
    expect(html).toContain('Nhạy cảm');
    expect(html).toContain('Cần ngày hết hạn');
    expect(html).not.toContain('Ma trận quyền mới');
  });

  it('shows a Room handoff instead of a misleading checkbox when a Module has no default bundle', () => {
    const projectApplication: PermissionCatalogApplication = {
      ...assetApplication,
      code: 'project',
      label: 'Dự án',
      hasDefaultViewBundle: false,
    };
    const html = renderToStaticMarkup(
      <PermissionModuleEditorView
        catalog={{ ...catalog, applications: [projectApplication] }}
        grants={[]}
        inheritedSources={[]}
        targetUserId="user-1"
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Quản lý tại Room Dự án');
    expect(html).not.toContain('Cấp quyền Xem cho Dự án');
  });

  it('lets an admin remove a direct grant even when the same permission is inherited', () => {
    const oneActionApplication: PermissionCatalogApplication = {
      ...assetApplication,
      modules: [assetApplication.modules[0]],
    };
    const html = renderToStaticMarkup(
      <PermissionModuleCard
        application={oneActionApplication}
        state="checked"
        expanded
        grants={[{
          id: 'grant-1',
          userId: 'user-1',
          permissionCode: 'asset.catalog.view',
          scopeType: 'global',
          scopeId: '*',
          isActive: true,
        }]}
        inheritedSources={inheritedSources}
        disabled={false}
        pendingRemovalCount={0}
        onToggleSelected={vi.fn()}
        onToggleExpanded={vi.fn()}
        onToggleAction={vi.fn()}
        onConfirmRemoval={vi.fn()}
        onCancelRemoval={vi.fn()}
      />,
    );

    const checkboxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map(match => match[0]);
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[1]).toContain('checked=""');
    expect(checkboxes[1]).not.toContain('disabled');
  });
});
