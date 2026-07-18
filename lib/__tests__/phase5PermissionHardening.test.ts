import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAllPermissionActions } from '../permissions/permissionRegistry';

const scanFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...scanFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
};

describe('Phase 5 permission hardening guards', () => {
  it('does not register generic, non-namespaced permission codes', () => {
    const forbiddenGenericCodes = new Set([
      'approve',
      'confirm',
      'delete',
      'edit',
      'manage',
      'submit',
      'verify',
      'view',
    ]);

    const invalidCodes = getAllPermissionActions()
      .map(action => action.permissionCode)
      .filter(permissionCode =>
        forbiddenGenericCodes.has(permissionCode) ||
        !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(permissionCode)
      )
      .sort();

    expect(invalidCodes).toEqual([]);
  });

  it('keeps legacy field access decisions confined to the Phase 5 readiness allowlist', () => {
    const allowedLegacyConsumers = new Set([
      'components/Layout.tsx',
      'components/Sidebar.tsx',
      'components/UserModal.tsx',
      'components/permissions/PermissionChangeSummary.tsx',
      'components/permissions/UnifiedPermissionMatrix.tsx',
      'hooks/usePermission.ts',
      'lib/approvalService.ts',
      'lib/auditService.ts',
      'lib/costEstimateService.ts',
      'lib/feedbackNotificationService.ts',
      'lib/homeCapabilities.ts',
      'lib/notificationService.ts',
      'lib/permissions/permissionService.ts',
      'lib/permissions/permissionTypes.ts',
      'lib/permissions/projectPermissionService.ts',
      'lib/permissions/unifiedPermissionViewModel.ts',
      'lib/routeAccess.ts',
      'lib/settingsPermissions.ts',
      'lib/tenderAiService.ts',
      'pages/FeedbackHub.tsx',
    ]);
    const legacyFieldPattern = /\b(?:allowedModules|adminModules|allowedSubModules|adminSubModules|allowed_modules|admin_modules|allowed_sub_modules|admin_sub_modules)\b/;
    const scannedRoots = ['components', 'hooks', 'lib', 'pages'];
    const actualLegacyConsumers = scannedRoots
      .flatMap(root => scanFiles(join(process.cwd(), root)))
      .filter(file => legacyFieldPattern.test(readFileSync(file, 'utf8')))
      .map(file => relative(process.cwd(), file))
      .sort();

    expect(actualLegacyConsumers).toEqual([...allowedLegacyConsumers].sort());
  });
});
