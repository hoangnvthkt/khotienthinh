import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  AuthorizationPrincipal,
  EffectivePermissionSource,
} from '../permissions/authorizationGovernanceTypes';
import DirectUserPermissionWorkspace from '../../components/permissions/DirectUserPermissionWorkspace';

const principal: AuthorizationPrincipal = {
  userId: 'user-1',
  name: 'Hà Thị Hải Hồng',
  email: 'honghh@tienthinhjsc.vn',
  accountStatus: 'ACTIVE',
  legacyState: {
    allowedModules: ['TS'],
    adminModules: [],
    allowedSubModules: {},
    adminSubModules: {},
  },
};

const directSource = (permissionCode: string): EffectivePermissionSource => ({
  permissionCode,
  scopeType: 'global',
  scopeId: '*',
  sourceType: 'DIRECT',
  sourceId: `direct:${permissionCode}`,
  sourceCode: permissionCode,
  sourceLabel: 'Direct grant',
  riskLevel: 'normal',
  isBusinessApproval: false,
  metadata: {},
});

describe('application permission workbench UI contract', () => {
  it('renders current permission source and revoke/convert affordances', () => {
    const html = renderToStaticMarkup(
      <DirectUserPermissionWorkspace
        principal={principal}
        grants={[{ userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*' }]}
        effectiveSources={[
          directSource('asset.catalog.view'),
          {
            ...directSource('asset.assignment.view'),
            sourceType: 'LEGACY',
            sourceId: 'TS',
            sourceCode: 'TS',
            sourceLabel: 'Legacy TS',
          },
        ]}
        principals={[principal]}
        currentUserId="admin-1"
        disabled={false}
        clipboard={null}
        onClipboardChange={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain('Quyền hiện có');
    expect(html).toContain('asset.catalog.view');
    expect(html).toContain('Direct');
    expect(html).toContain('Thu hồi');
    expect(html).toContain('Legacy');
    expect(html).toContain('Chuyển sang quyền mới');
  });

  it('labels the editor as app module action scope workflow', () => {
    const html = renderToStaticMarkup(
      <DirectUserPermissionWorkspace
        principal={principal}
        grants={[]}
        effectiveSources={[]}
        principals={[principal]}
        currentUserId="admin-1"
        disabled={false}
        clipboard={null}
        onClipboardChange={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain('Ứng dụng');
    expect(html).toContain('Module');
    expect(html).toContain('Phạm vi');
    expect(html).toContain('Preview backend');
    expect(html).toContain('Lưu phân quyền');
  });
});
