import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import UnifiedPermissionMatrix from '../../components/permissions/UnifiedPermissionMatrix';
import PermissionChangeSummary from '../../components/permissions/PermissionChangeSummary';
import SodWarningPanel from '../../components/permissions/SodWarningPanel';

const grant = (permissionCode: string): UserPermissionGrant => ({
  userId: 'user-1',
  permissionCode,
  scopeType: 'project',
  scopeId: 'project-1',
});

const source = (
  permissionCode: string,
  sourceType: EffectivePermissionSource['sourceType'],
): EffectivePermissionSource => ({
  permissionCode,
  sourceType,
  sourceId: sourceType.toLowerCase() + '-1',
  sourceCode: sourceType.toLowerCase(),
  sourceLabel: sourceType === 'ROLE' ? 'Nhật ký dự án' : sourceType,
  scopeType: 'project',
  scopeId: 'project-1',
  riskLevel: 'normal',
  isBusinessApproval: false,
  metadata: {},
});

const legacyState = {
  allowedModules: [],
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
};

describe('UnifiedPermissionMatrix', () => {
  it('renders View before action keys and keeps raw codes inside Advanced details', () => {
    const html = renderToStaticMarkup(
      <UnifiedPermissionMatrix
        targetUserId="user-1"
        grants={[]}
        effectiveSources={[]}
        scope={{ scopeType: 'project', scopeId: 'project-1' }}
        initialApplicationCode="project"
        initialModuleCode="project.daily_log"
        onGrantsChange={() => undefined}
      />,
    );

    expect(html.indexOf('Xem')).toBeLessThan(html.indexOf('Tạo'));
    expect(html).toContain('Dự án');
    expect(html).toContain('Nhật ký dự án');
    expect(html).toMatch(/<details[^>]*>[\s\S]*project\.daily_log\.view[\s\S]*<\/details>/);
  });

  it('shows Role and Legacy as effective sources without checking Direct', () => {
    const html = renderToStaticMarkup(
      <UnifiedPermissionMatrix
        targetUserId="user-1"
        grants={[]}
        effectiveSources={[
          source('hrm.employee.view', 'ROLE'),
          source('hrm.employee.view', 'LEGACY'),
        ]}
        scope={{ scopeType: 'project', scopeId: 'project-1' }}
        initialApplicationCode="hrm"
        initialModuleCode="hrm.employee"
        onGrantsChange={() => undefined}
      />,
    );

    expect(html).toContain('Business Role');
    expect(html).toContain('Legacy');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/);
  });

  it('allows a Declared app action to be granted while still allowing Direct revocation', () => {
    const withoutGrant = renderToStaticMarkup(
      <UnifiedPermissionMatrix
        targetUserId="user-1"
        grants={[]}
        effectiveSources={[]}
        scope={{ scopeType: 'global', scopeId: '*' }}
        initialApplicationCode="hrm"
        initialModuleCode="hrm.employee"
        onGrantsChange={() => undefined}
      />,
    );
    const withGrant = renderToStaticMarkup(
      <UnifiedPermissionMatrix
        targetUserId="user-1"
        grants={[{ ...grant('hrm.employee.create'), scopeType: 'global', scopeId: '*' }]}
        effectiveSources={[]}
        scope={{ scopeType: 'global', scopeId: '*' }}
        initialApplicationCode="hrm"
        initialModuleCode="hrm.employee"
        onGrantsChange={() => undefined}
      />,
    );

    expect(withoutGrant).toContain('Chưa xác minh');
    expect(withoutGrant).not.toMatch(/Tạo[\s\S]{0,800}disabled=""/);
    expect(withGrant).toMatch(/Tạo[\s\S]{0,800}checked=""/);
    expect(withGrant).toContain('Có thể thu hồi');
  });

  it('disables View revocation while same-module Direct actions remain', () => {
    const html = renderToStaticMarkup(
      <UnifiedPermissionMatrix
        targetUserId="user-1"
        grants={[
          { ...grant('asset.catalog.view'), scopeType: 'warehouse', scopeId: 'wh-1' },
          { ...grant('asset.catalog.create'), scopeType: 'warehouse', scopeId: 'wh-1' },
        ]}
        effectiveSources={[]}
        scope={{ scopeType: 'warehouse', scopeId: 'wh-1' }}
        initialApplicationCode="asset"
        initialModuleCode="asset.catalog"
        onGrantsChange={() => undefined}
      />,
    );

    expect(html).toMatch(/Xem[\s\S]{0,1200}type="checkbox"[^>]*disabled=""/);
    expect(html).toContain('Bỏ quyền hành động trước khi thu hồi View.');
  });

  it('summarizes auto-View and effective access retained by inherited sources', () => {
    const autoViewHtml = renderToStaticMarkup(
      <PermissionChangeSummary
        beforeGrants={[]}
        afterGrants={[grant('project.daily_log.view'), grant('project.daily_log.edit_own')]}
        beforeLegacy={legacyState}
        afterLegacy={legacyState}
        effectiveSources={[]}
      />,
    );
    const retainedHtml = renderToStaticMarkup(
      <PermissionChangeSummary
        beforeGrants={[grant('project.daily_log.edit_own')]}
        afterGrants={[]}
        beforeLegacy={legacyState}
        afterLegacy={legacyState}
        effectiveSources={[source('project.daily_log.edit_own', 'ROLE')]}
      />,
    );

    expect(autoViewHtml).toContain('View được thêm tự động');
    expect(retainedHtml).toContain('Gỡ Direct Grant không làm mất quyền thực tế vì Business Role vẫn còn hiệu lực.');
  });

  it('blocks warning acceptance when no independent control owner is eligible', () => {
    const html = renderToStaticMarkup(
      <SodWarningPanel
        warnings={[{
          ruleCode: 'SOD-01',
          effect: 'WARN',
          message: 'Cần kiểm soát độc lập.',
          permissionCodes: ['project.daily_log.approve'],
          scopeType: 'project',
          scopeId: 'project-1',
        }]}
        acceptances={[]}
        controlOwners={[{
          userId: 'actor-1',
          name: 'Actor',
          email: 'actor@example.com',
          accountStatus: 'ACTIVE',
          legacyState: {
            allowedModules: [],
            allowedSubModules: {},
            adminModules: [],
            adminSubModules: {},
          },
        }]}
        currentUserId="actor-1"
        affectedPrincipalId="user-1"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('Chưa có người kiểm soát độc lập đủ điều kiện; không thể lưu thay đổi quyền nhạy cảm này.');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });
});
