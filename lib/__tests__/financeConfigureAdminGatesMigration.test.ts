import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Cấu hình Tài chính + bỏ ADMIN cứng (20261029095000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261029095000_finance_configure_and_admin_gates.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.indexOf(`create or replace function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    const end = sql.indexOf('$function$;', start);
    return sql.slice(start, end === -1 ? sql.indexOf('$$;', start) : end);
  };

  it('adds system.finance.configure; manage includes it and it implies view', () => {
    expect(sql).toContain("values ('system.finance', 'configure', 'system.finance.configure', 'Cấu hình Tài chính',");
    const can = body('app_private.finance_can');
    expect(can).toContain("(p_action = 'configure' and app_private.has_permission(public.current_app_user_id(), 'system.finance.manage'))");
    expect(can).toContain("app_private.has_permission(public.current_app_user_id(), 'system.finance.configure')");
    expect(body('app_private.finance_can_flags')).toContain("'configure', app_private.finance_can('configure')");
  });

  it('moves routine settings and the executive overview to configure', () => {
    for (const fn of [
      'public.save_finance_settings_v1', 'public.save_finance_cash_settings_v1', 'public.save_finance_forecast_settings_v1',
      'public.save_finance_contract_terms_v1', 'public.save_finance_customer_terms_v1', 'public.save_finance_subcontract_terms_v1',
      'public.save_finance_supplier_terms_v1', 'public.set_finance_payable_due_v1', 'public.get_finance_overview_v1',
    ]) {
      expect(body(fn), fn).toContain("if not app_private.finance_can('configure') then");
      expect(body(fn), fn).not.toContain("if not app_private.finance_can('manage') then");
    }
    expect(body('public.get_finance_forecast_v1')).toContain("v_company boolean := app_private.finance_can('configure');");
  });

  it('keeps control settings on manage', () => {
    for (const fn of ['public.save_finance_approval_matrix_v1', 'public.save_finance_delegation_v1',
      'public.save_finance_advance_settings_v1', 'public.save_finance_cost_settings_v1', 'public.save_finance_cost_cutover_v1']) {
      expect(sql.includes(`create or replace function ${fn}(`), fn).toBe(false);
    }
  });

  it('lets finance managers run project sensitive-view toggles', () => {
    expect(body('app_private.can_manage_project_sensitive_view')).toContain("'system.finance.manage', 'global', '*'");
    for (const fn of ['public.set_project_sensitive_view_grant', 'public.list_project_sensitive_view_access', 'public.get_user_sensitive_view_summary']) {
      expect(body(fn), fn).toContain('if not app_private.can_manage_project_sensitive_view() then');
    }
  });

  it('lets warehouse managers edit warehouse access', () => {
    expect(body('app_private.wms_can_edit_access')).toContain("'system.wms.manage', 'global', '*'");
    for (const fn of ['public.save_wms_access_v1', 'public.save_wms_owners_v1']) {
      expect(body(fn), fn).toContain('not app_private.wms_can_edit_access(v_actor)');
    }
    for (const fn of ['public.get_wms_access_v1', 'public.get_wms_owners_v1']) {
      expect(body(fn), fn).toContain("'edit', app_private.wms_can_edit_access(v_actor)");
    }
  });

  it('grants configure to chị Hương and anh Chuẩn', () => {
    expect(sql).toContain("and u.email in ('huongnt@tienthinhjsc.vn', 'chuanhd@tienthinhjsc.vn')");
  });
});
