import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const legacyFieldPattern = /\b(?:allowedModules|adminModules|allowedSubModules|adminSubModules|allowed_modules|admin_modules|allowed_sub_modules|admin_sub_modules)\b/;

const runtimeDecisionFiles = [
  'components/Layout.tsx',
  'components/Sidebar.tsx',
  'context/AppContext.tsx',
  'context/WorkflowContext.tsx',
  'hooks/usePermission.ts',
  'lib/approvalService.ts',
  'lib/costEstimateService.ts',
  'lib/feedbackNotificationService.ts',
  'lib/homeCapabilities.ts',
  'lib/notificationService.ts',
  'lib/permissions/permissionService.ts',
  'lib/permissions/projectPermissionService.ts',
  'lib/routeAccess.ts',
  'lib/settingsPermissions.ts',
  'lib/tenderAiService.ts',
  'lib/userAccountLifecycleService.ts',
  'pages/FeedbackHub.tsx',
  'supabase/functions/ai-assistant/index.ts',
  'supabase/functions/create-user/index.ts',
];

const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_authorization_v2_phase6_disable_legacy_writes.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8').toLowerCase()
  : '';
const aiAssistant = readFileSync(
  join(root, 'supabase', 'functions', 'ai-assistant', 'index.ts'),
  'utf8',
);

describe('Authorization V2 legacy runtime removal', () => {
  it('has no legacy-field authorization or write consumer in runtime code', () => {
    const offenders = runtimeDecisionFiles.filter(file =>
      legacyFieldPattern.test(readFileSync(join(root, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('enables the write guard and retires the old permission mutation RPCs', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toContain("'legacy_permission_writes_disabled', 'true'::jsonb");
    expect(migration).toContain('guard_and_audit_legacy_permission_write');
    expect(migration).toContain('before insert or update of');
    expect(migration).toContain('revoke execute on function public.apply_user_permission_change');
    expect(migration).toContain('revoke execute on function public.preview_user_permission_change');
    expect(migration).toContain('service_authorization_user_has_permission');
    expect(migration).toContain('to service_role');
  });

  it('keeps only the audited account-lifecycle clearing path after shutdown', () => {
    expect(migration).toContain("current_setting('app.account_lifecycle_command', true)");
    expect(migration).toContain('legacy permission writes are disabled');
    expect(migration).toContain('account lifecycle may only clear legacy permission columns');
  });

  it('authenticates every AI action from JWT before canonical permission checks', () => {
    expect(aiAssistant).not.toContain('resolveActor(request, req.userId)');
    expect(aiAssistant).toMatch(
      /req = await request\.json\(\)[\s\S]*?const authorization = await requireAiAssistantUse\(request\);[\s\S]*?if \(req\.action === 'feedback'\)/,
    );
  });
});
