import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDraftFromTemplate, diffRoomActions, orderTemplatesForPosition, type ProjectRoomTemplate } from '../projectRoomTemplateService';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_authorization_p3_project_room_templates.sql'));
const migration = migrationName ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8') : '';
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const template = (code: string, positions: string[], sortOrder: number, isActive = true): ProjectRoomTemplate => ({
  code, name: code, description: null, roomActions: {}, suggestedPositionIds: positions, sortOrder, isActive,
});

describe('project Room role templates', () => {
  it('applies through the existing Room command, Admin-only, with preview and audit', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toContain('perform public.replace_project_permission_room_members(p_project_id, v_site, v_room.code, v_members)');
    expect(migration).toContain("raise exception 'ROOM_TEMPLATE_ADMIN_REQUIRED'");
    expect(migration).toContain('p_dry_run boolean default true');
    expect(migration).toContain("'project_permission_room_members', p_project_staff_id::text");
    expect(migration).toContain('ROOM_TEMPLATE_STAFF_NOT_IN_PROJECT');
  });

  it('seeds the five site roles plus read-only, and adds prerequisites', () => {
    for (const code of ['site_commander', 'field_engineer', 'quantity_surveyor', 'site_storekeeper', 'project_accountant', 'viewer']) {
      expect(migration).toContain(`('${code}',`);
    }
    expect(migration).toContain('prerequisite_action_codes');
    expect(migration).toContain("on conflict (code) do nothing");
  });

  it('puts the template suggested for a position first and hides inactive ones', () => {
    const ordered = orderTemplatesForPosition([
      template('viewer', [], 90),
      template('site_commander', ['pos-cht'], 10),
      template('old', ['pos-cht'], 5, false),
      template('field_engineer', ['pos-kt'], 20),
    ], 'pos-kt');
    expect(ordered.map(item => item.code)).toEqual(['field_engineer', 'site_commander', 'viewer']);
    expect(ordered[0].suggested).toBe(true);
  });

  it('is reachable from the project Permissions tab and Settings', () => {
    expect(read('pages/project/ProjectPermissionsTab.tsx')).toContain('<ProjectPersonRoomEditor');
    expect(read('pages/Settings.tsx')).toContain('<SettingsProjectRoomTemplates />');
    expect(read('pages/project/ProjectPermissionsTab.tsx')).not.toMatch(/PBAC|Room-authoritative/);
  });

  it('lets an Admin adjust a template for one person before saving', () => {
    const current = { daily_log: ['view'], safety: ['view', 'edit'] } as any;
    const qs = { quantity_acceptance: ['view', 'edit', 'submit'], payment: ['view', 'edit', 'submit'] } as any;
    const merged = buildDraftFromTemplate(current, qs, 'merge');
    expect(merged.safety).toEqual(['view', 'edit']);
    expect(merged.quantity_acceptance).toEqual(['view', 'edit', 'submit']);
    expect(buildDraftFromTemplate(current, qs, 'replace')).toEqual(qs);
    const adjusted = { ...merged, payment: ['view', 'edit'] } as any;
    expect(diffRoomActions(current, adjusted).find(change => change.roomCode === 'payment')).toEqual({ roomCode: 'payment', added: ['view', 'edit'], removed: [] });
    expect(diffRoomActions(current, current)).toEqual([]);
    expect(migration).toContain("p_mode not in ('merge', 'replace', 'exact')");
    expect(migration).toContain("'customized', v_customized");
    expect(read('components/project/permissions/ProjectPersonRoomEditor.tsx')).toContain("mode: 'exact'");
  });

  it('gives members added by the project form their Rooms from templates', () => {
    const dashboard = read('pages/ProjectDashboard.tsx');
    expect(dashboard).toContain("admin: 'site_commander'");
    expect(dashboard).toContain("executor: 'field_engineer'");
    expect(dashboard).toContain("watcher: 'viewer'");
    expect(dashboard.match(/await applySeedRoomTemplates\(project, seededMembers/g)?.length).toBe(2);
    expect(dashboard).toContain('if (user.role !== Role.ADMIN)');
  });
});
