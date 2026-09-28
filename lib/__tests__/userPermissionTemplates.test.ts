import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGrantsFromTemplate, orderUserTemplatesForPosition, type UserPermissionTemplate } from '../userPermissionTemplateService';
import type { PermissionAdminCatalog } from '../permissions/permissionTypes';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_authorization_p3_user_permission_templates.sql'));
const migration = migrationName ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8') : '';
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const action = (permissionCode: string, extra: Record<string, unknown> = {}) => ({
  permissionCode, label: permissionCode, scopeTypes: ['global', 'own', 'assigned'], riskLevel: 'normal',
  grantReadiness: 'declared', directGrantAllowed: true, directGrantRequiresExpiry: false, isDefaultView: false, ...extra,
});
const catalog = {
  generatedAt: '', applications: [{
    code: 'app', label: 'App', hasDefaultViewBundle: false, modules: [{
      code: 'm', label: 'M', actions: [
        action('kb.view'),
        action('wms.request.approve', { directGrantRequiresExpiry: true }),
        action('hrm.payroll.view', { directGrantAllowed: false }),
        action('asset.catalog.view'),
        action('project.daily_log.view', { directGrantAllowed: false }),
      ],
    }],
  }],
} as unknown as PermissionAdminCatalog;

const template = (items: UserPermissionTemplate['items'], extra: Partial<UserPermissionTemplate> = {}): UserPermissionTemplate => ({
  code: 'tpl', name: 'Mẫu', description: null, items, suggestedPositionIds: [], sortOrder: 10, isActive: true, ...extra,
});

describe('person permission templates', () => {
  it('stores only grantable items and is edited by Admins only', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toContain("raise exception 'PERMISSION_TEMPLATE_ADMIN_REQUIRED'");
    expect(migration).toContain('PERMISSION_TEMPLATE_NOT_DIRECT');
    expect(migration).toContain("array['global', 'own', 'assigned']");
    expect(migration).toContain("'user_permission_templates', v_row.code");
    expect(migration).toContain('on conflict (code) do nothing');
  });

  it('seeds the approved position and module-admin templates', () => {
    for (const code of ['basic_employee', 'material_staff', 'warehouse_manager', 'site_staff', 'accountant', 'chief_accountant',
      'hr_staff', 'hr_head', 'admin_assets_fleet', 'executive', 'workflow_admin', 'request_admin', 'asset_admin', 'work_admin']) {
      expect(migration).toContain(`('${code}',`);
    }
    // Sensitive HR data stays with the HR / HR_MANAGE roles.
    expect(migration).not.toMatch(/"hrm\.(payroll|compensation|contract|document)\./);
    expect(migration).not.toContain('"project.');
  });

  it('adds template items to what the person has, with an end date where required', () => {
    const now = new Date('2026-09-28T00:00:00Z');
    const result = buildGrantsFromTemplate({
      current: [{ userId: 'u', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*', isActive: true }],
      template: template([
        { permissionCode: 'kb.view', scopeType: 'global' },
        { permissionCode: 'wms.request.approve', scopeType: 'global', expiresInDays: 30 },
        { permissionCode: 'hrm.payroll.view', scopeType: 'global' },
        { permissionCode: 'asset.catalog.view', scopeType: 'global' },
      ]),
      mode: 'merge', catalog, userId: 'u', now,
    });
    expect(result.grants.map(grant => grant.permissionCode)).toEqual(['asset.catalog.view', 'kb.view', 'wms.request.approve']);
    expect(result.grants.find(grant => grant.permissionCode === 'wms.request.approve')?.expiresAt).toBe('2026-10-28T00:00:00.000Z');
    expect(result).toMatchObject({ added: 2, removed: 0, skipped: 1 });
  });

  it('replaces catalog grants but keeps project grants and skips inherited ones', () => {
    const result = buildGrantsFromTemplate({
      current: [
        { userId: 'u', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*', isActive: true },
        { userId: 'u', permissionCode: 'project.daily_log.view', scopeType: 'project', scopeId: 'p1', isActive: true },
      ],
      template: template([{ permissionCode: 'kb.view', scopeType: 'global' }, { permissionCode: 'wms.request.approve', scopeType: 'global' }]),
      mode: 'replace', catalog, userId: 'u', inheritedCodes: ['wms.request.approve'],
    });
    expect(result.grants.map(grant => grant.permissionCode)).toEqual(['project.daily_log.view', 'kb.view']);
    expect(result).toMatchObject({ added: 1, removed: 1, skipped: 1 });
  });

  it('puts the template suggested for the position first', () => {
    const ordered = orderUserTemplatesForPosition([
      template([], { code: 'basic', sortOrder: 10 }),
      template([], { code: 'wh', sortOrder: 30, suggestedPositionIds: ['pos-kho'] }),
      template([], { code: 'off', sortOrder: 1, isActive: false }),
    ], 'pos-kho');
    expect(ordered.map(item => item.code)).toEqual(['wh', 'basic']);
    expect(ordered[0].suggested).toBe(true);
  });

  it('is reachable from the user editor and Settings', () => {
    expect(read('components/permissions/AuthorizationEditor.tsx')).toContain('<PermissionTemplateFill');
    expect(read('pages/Settings.tsx')).toContain('<SettingsUserPermissionTemplates />');
  });
});
