import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('mẫu quyền sống — Đợt 2b (20261029130000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261029130000_live_permission_templates.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.search(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\(`, 'i'));
    expect(start, name).toBeGreaterThan(-1);
    const rest = sql.slice(start);
    const end = rest.search(/\n\$\$;|\$function\$;/);
    return rest.slice(0, end);
  };

  it('defines the per-person "Duyệt PO" option and turns it on for purchasing / warehouse / executive templates', () => {
    expect(sql).toContain("values ('po_approver', 'Duyệt PO',");
    expect(sql).toContain('[{"permissionCode": "system.procurement.approve", "scopeType": "global"}]');
    expect(sql).toContain("where code in ('material_staff', 'warehouse_manager', 'executive');");
  });

  it('links one person to one template with options, exclusions and the items the template manages', () => {
    expect(sql).toContain('create table public.user_template_assignments (');
    expect(sql).toContain('user_id uuid primary key references public.users(id) on delete cascade');
    expect(sql).toMatch(/excluded jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/applied jsonb not null default '\[\]'::jsonb/);
    expect(sql).toContain('revoke insert, update, delete on public.user_template_assignments from anon, authenticated;');
  });

  it('only grants directly grantable items, never HR-role-only ones, and honours exclusions', () => {
    const desired = body('app_private.permission_template_desired_items');
    expect(desired).toContain('action_row.direct_grant_allowed');
    expect(desired).toContain('not app_private.is_hrm_template_only_permission(w.pc)');
    expect(desired).toContain("option_def.key = any(coalesce(p_template_options, '{}'))");
    expect(desired).toContain("option_def.key = any(coalesce(p_assignment_options, '{}'))");
  });

  it('changes grants only through the standard replacement path and removes only what the template granted', () => {
    const apply = body('app_private.apply_template_grant_changes');
    expect(apply).toContain("perform app_private.replace_user_permission_grants_v2_impl(p_user_id, v_next, p_reason, '[]'::jsonb);");
    const sync = body('app_private.sync_user_template_assignment');
    expect(sync).toContain('unnest(app_private.permission_item_keys(v_assignment.applied)) k');
  });

  it('syncs every assignee on template save and reports failures instead of stopping', () => {
    const save = body('public.save_user_permission_template_v2');
    expect(save).toContain("if not public.is_admin() then");
    expect(save).toContain('v_result := app_private.sync_user_template_assignment(');
    expect(save).toContain('exception when others then');
    expect(save).toContain("v_failed := v_failed || jsonb_build_object('userId', v_user.user_id, 'name', v_user.name, 'error', sqlerrm);");
    expect(body('public.save_user_permission_template')).toContain('perform public.save_user_permission_template_v2(');
  });

  it('requires the permission-admin right to link people and records exclusions after a manual save', () => {
    expect(body('public.save_user_template_assignment_v1')).toContain("app_private.assert_authorization_permission('system.authorization.manage_grants')");
    expect(body('public.remove_user_template_assignment_v1')).toContain("app_private.assert_authorization_permission('system.authorization.manage_grants')");
    expect(body('app_private.update_user_authorization_v2_impl')).toContain('perform app_private.adopt_user_template_state(p_user_id);');
  });
});
