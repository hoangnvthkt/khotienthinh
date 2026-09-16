import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('authorization E27 role-template administration', () => {
  it('provides versioned commands, rich preview, snapshot and legacy RPC retirement', () => {
    const sql = read('supabase/migrations/20260916110300_authorization_v2_task12_4_2_role_template_commands_v2.sql');
    expect(sql).toContain('get_business_role_admin_snapshot');
    expect(sql).toContain('preview_business_role_assignment_v2');
    expect(sql).toContain('save_business_role_v2');
    expect(sql).toContain('assign_business_role_v2');
    expect(sql).toContain('p_expected_role_version');
    expect(sql).toContain("v_role.code='SUPER_ADMIN'");
    expect(sql).toContain("'dynamic',v_role.code='SUPER_ADMIN'");
    expect(sql).toContain('revoke execute on function public.save_business_role(');
    expect(sql).toContain('revoke execute on function public.assign_business_role(');
  });

  it('ships a three-step protected administration surface', () => {
    const page = read('pages/settings/SettingsRoleTemplates.tsx');
    const service = read('lib/permissions/businessRoleAdminService.ts');
    const settings = read('pages/Settings.tsx');
    const app = read('App.tsx');

    expect(page).toContain('Thông tin chung');
    expect(page).toContain('Cấu hình bảng phân quyền');
    expect(page).toContain('Gán đối tượng');
    expect(page).toContain('SUPER_ADMIN');
    expect(page).toContain('previewBusinessRoleAssignment');
    expect(service).toContain("rpc('get_business_role_admin_snapshot'");
    expect(service).toContain("rpc('save_business_role_v2'");
    expect(service).toContain("rpc('assign_business_role_v2'");
    expect(settings).toContain("'/settings/role-templates'");
    expect(app).toContain('settings/role-templates');
  });
});
