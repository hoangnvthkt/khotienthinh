import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conflictToSodWarnings } from '../permissions/sodService';

describe('Đợt 3a — 8 mẫu quyền, gắn mẫu với quyền hết hạn, không tự duyệt công (20261030090000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261030090000_permission_dot3_templates.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.search(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\(`, 'i'));
    expect(start, name).toBeGreaterThan(-1);
    const rest = sql.slice(start);
    return rest.slice(0, rest.search(/\n\$\$;/));
  };

  it('keeps 8 department templates and switches off the 7 merged or admin-only ones', () => {
    expect(sql).toContain("where code in ('chief_accountant', 'hr_head', 'admin_assets_fleet', 'workflow_admin', 'request_admin', 'asset_admin', 'work_admin');");
    expect(sql).toContain("options = '{chief_accountant,warehouse_accounting}'");
    expect(sql).toContain("('chief_accountant', 'Kế toán trưởng',");
  });

  it('separates the warehouse officer from purchasing and gives the deputy CEO configure instead of manage', () => {
    expect(sql).toMatch(/not in \('system\.procurement\.manage', 'settings\.loss_norms\.manage',\s+'settings\.master_data\.manage', 'settings\.warehouses\.manage'\)/);
    expect(sql).toContain("where i ->> 'permissionCode' <> 'system.finance.manage')");
    expect(sql).toContain('[{"permissionCode": "system.finance.configure", "scopeType": "global"}]');
  });

  it('leaves expired grants out of the set a template assignment saves', () => {
    expect(body('app_private.template_next_grants')).toContain(
      'where g.user_id = p_user_id and g.is_active and (g.expires_at is null or g.expires_at > now())',
    );
  });

  it('blocks approving your own attendance or attendance proposal on the server', () => {
    const guard = body('app_private.guard_attendance_self_approval');
    expect(guard).toContain("coalesce(v_new ->> 'targetEmployeeId', v_new ->> 'employeeId')");
    expect(guard).toContain('e.user_id::text = v_approver');
    expect(sql).toContain('before insert or update of "approvedBy" on public.hrm_attendance\n');
    expect(sql).toContain('before insert or update of "approvedBy" on public.hrm_attendance_proposals\n');
  });

  it('records an acknowledgement only for a pair the person really holds, by a permission admin, with a separate control owner', () => {
    const record = body('public.record_existing_sod_acceptance_v1');
    expect(record).toContain("app_private.assert_authorization_permission('system.authorization.manage_grants')");
    expect(record).toContain("raise exception 'SOD_CONFLICT_NOT_FOUND'");
    expect(record).toContain('p_control_owner_user_id in (v_actor, p_user_id)');
    expect(record).toContain("'EXISTING_CONFLICT_REVIEW'");
  });

  it('turns a held conflict into one warning per scope for the acknowledgement dialog', () => {
    const warnings = conflictToSodWarnings({
      ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho', description: '',
      scopes: [{ scopeType: 'warehouse', scopeId: 'wh-1', scopeLabel: 'Kho Sơn Miền Bắc' }, { scopeType: 'warehouse', scopeId: 'wh-2' }],
      controls: ['Kiểm kê kho định kỳ có người thứ hai'], acceptance: null,
    });
    expect(warnings.map(warning => warning.scopeId)).toEqual(['wh-1', 'wh-2']);
    expect(warnings[1].scopeLabel).toBeNull();
    expect(warnings[0].permissions).toEqual([]);
    expect(warnings[0].controls).toEqual(['Kiểm kê kho định kỳ có người thứ hai']);
  });
});
