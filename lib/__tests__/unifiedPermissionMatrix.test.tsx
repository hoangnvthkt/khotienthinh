import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import UnifiedPermissionMatrix from '../../components/permissions/UnifiedPermissionMatrix';
import PermissionChangeSummary from '../../components/permissions/PermissionChangeSummary';

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
          source('system.authorization.view', 'ROLE'),
          source('system.authorization.view', 'LEGACY'),
        ]}
        scope={{ scopeType: 'project', scopeId: 'project-1' }}
        initialApplicationCode="system"
        initialModuleCode="system.authorization"
        onGrantsChange={() => undefined}
      />,
    );

    expect(html).toContain('Business Role');
    expect(html).toContain('Legacy');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/);
  });

  it('disables a Declared addition but lets an existing Declared Direct be revoked', () => {
    const withoutGrant = renderToStaticMarkup(
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
    const withGrant = renderToStaticMarkup(
      <UnifiedPermissionMatrix
        targetUserId="user-1"
        grants={[grant('project.daily_log.confirm')]}
        effectiveSources={[]}
        scope={{ scopeType: 'project', scopeId: 'project-1' }}
        initialApplicationCode="project"
        initialModuleCode="project.daily_log"
        onGrantsChange={() => undefined}
      />,
    );

    expect(withoutGrant).toContain('Chưa xác minh');
    expect(withoutGrant).toMatch(/Xác nhận[\s\S]{0,800}disabled=""/);
    expect(withGrant).toMatch(/Xác nhận[\s\S]{0,800}checked=""/);
    expect(withGrant).toContain('Có thể thu hồi');
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
    expect(retainedHtml).toContain('Business Role vẫn giữ quyền thực tế');
  });
});
