import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260921183000_g9_erp_completion_rollout_control.sql', import.meta.url), 'utf8');

describe('G9 rollout control migration', () => {
  it('keeps rollout private, empty by default, audited, scoped, and expiring', () => {
    expect(sql).toContain('create table app_private.erp_completion_rollout_scopes');
    expect(sql).toContain('create table app_private.erp_completion_rollout_actors');
    expect(sql).toContain('create table app_private.erp_completion_rollout_audit');
    expect(sql).toContain("mode in ('read_only','pilot','paused')");
    expect(sql).toContain('expires_at');
    expect(sql).toContain('enabled_commands');
    expect(sql).toContain('completion_commands');
    expect(sql).toContain("current_setting('app.erp_completion_rollout_reason', true)");
    expect(sql).not.toMatch(/insert into app_private\.erp_completion_rollout_scopes/i);
    expect(sql).toContain('revoke all on app_private.erp_completion_rollout_scopes');
  });

  it('uses the session actor and rejects disabled, expired, cross-scope, and unlisted commands', () => {
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain('ERP_COMPLETION_PILOT_COMMAND_DISABLED');
    expect(sql).toContain('scope.expires_at > statement_timestamp()');
    expect(sql).toContain('p_command = any(scope.enabled_commands)');
    expect(sql).toContain('p_command = any(scope.completion_commands)');
    expect(sql).not.toMatch(/public\.get_erp_completion_rollout_access_v1\([^)]*actor/i);
  });

  it('gates every human G4-G7 command wrapper while keeping reads independent', () => {
    for (const command of [
      'material_plan.save', 'material_plan.convert', 'procurement.assign',
      'procurement.allocate', 'procurement.po.create', 'wms.transfer.dispatch',
      'wms.transfer.receive', 'wms.transfer.dispose', 'wms.inventory_count.start',
      'wms.inventory_count.post', 'finance.invoice.record', 'finance.invoice.reverse',
      'finance.payment.post', 'finance.payment.reverse',
    ]) expect(sql).toContain(`'${command}'`);
    expect(sql).toContain('create or replace function public.save_material_plan_v1');
    expect(sql).toContain('create or replace function public.create_procurement_purchase_order_v1');
    expect(sql).toContain('create or replace function public.dispatch_wms_transfer_v1');
    expect(sql).toContain('create or replace function public.record_supplier_invoice_reconciliation_v3');
    expect(sql).toContain('create or replace function public.record_supplier_invoice_reconciliation_v2');
    expect(sql).toContain('create or replace function public.post_supplier_payment_batch_v2');
  });

  it('exposes an admin-only health snapshot with explicit unavailable latency evidence', () => {
    expect(sql).toContain('create function public.get_erp_completion_rollout_health_v1');
    expect(sql).toContain('ERP_COMPLETION_ROLLOUT_HEALTH_FORBIDDEN');
    expect(sql).toContain("'external_evidence_required'");
    expect(sql).toContain("'procurementOutbox'");
    expect(sql).toContain("'reconciliationIssues'");
    expect(sql).toContain('security definer set search_path');
  });
});
