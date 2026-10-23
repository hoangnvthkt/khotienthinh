import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptySodAcknowledgement,
  groupSodWarnings,
  sodAcknowledgementIssue,
  sodExpiryAfterMonths,
  toSodAcceptances,
  toSodPreview,
  type SodWarning,
} from '../permissions/sodService';

describe('luật kiêm nhiệm — Đợt 2c (20261029160000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261029160000_permission_sod_rules.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.search(new RegExp(`(create or replace function|create function|CREATE OR REPLACE FUNCTION) ${name.replace('.', '\\.')}\\(`, 'i'));
    expect(start, name).toBeGreaterThan(-1);
    const rest = sql.slice(start);
    const end = rest.search(/\n\$\$;|\$function\$;/);
    return rest.slice(0, end);
  };

  it('adds the three owner-approved pair rules as warnings and the self-reverse rule as a hard rule', () => {
    expect(sql).toContain("('PROCUREMENT_BUY_APPROVE_PO', 'Mua hàng + Duyệt PO',");
    expect(sql).toContain("'PERMISSION_PAIR', 'WARN', 'system.procurement.manage', 'system.procurement.approve'");
    expect(sql).toContain("'PERMISSION_PAIR', 'WARN', 'system.procurement.manage', 'wms.transaction.keeper'");
    expect(sql).toContain("'PERMISSION_PAIR', 'WARN', 'system.finance.confirm', 'system.finance.manage'");
    expect(sql).toContain("'SUBJECT_RELATION', 'DENY', null, null, 'reverse', 'finance_voucher'");
  });

  it('does not re-warn a pair the person already holds, even through direct grants being replaced', () => {
    const evaluate = body('app_private.evaluate_authorization_change');
    expect(evaluate).toContain('held_codes as (');
    expect(evaluate).toContain('exists (select 1 from held_codes c where c.permission_code = rule_row.left_permission_code)');
    expect(evaluate).not.toContain('exists (select 1 from current_codes c where c.permission_code = rule_row.left_permission_code)\n        and exists');
  });

  it('lets any active person other than the granter and the grantee be the control owner', () => {
    const record = body('app_private.assert_and_record_sod_warnings');
    expect(record).not.toContain("'system.authorization.audit'");
    expect(record).toContain('or v_owner_id = p_actor_user_id');
    expect(record).toContain('or v_owner_id = p_target_user_id');
  });

  it('passes acknowledgements through the user screen save and the template assignment', () => {
    expect(body('public.update_user_authorization_v2')).toContain('p_warning_acceptances');
    expect(body('app_private.update_user_authorization_v2_impl')).toContain("coalesce(p_warning_acceptances, '[]'::jsonb)");
    expect(body('public.save_user_template_assignment_v1')).toContain("app_private.sync_user_template_assignment(p_user_id, v_reason, coalesce(p_warning_acceptances, '[]'::jsonb))");
    expect(body('public.preview_user_template_assignment_v1')).toContain("'sod', v_sod");
    expect(sql).toContain('drop function if exists public.update_user_authorization_v2(uuid, jsonb, jsonb, text, timestamp with time zone);');
  });

  it('blocks the confirmer from reversing the same voucher and hides the button for them', () => {
    expect(body('public.reverse_finance_payment_request_v1')).toContain("if v_req.paid ->> 'by' = v_actor::text then raise exception using errcode = '42501', message = 'FINANCE_SELF_REVERSE'");
    expect(body('public.decide_finance_cash_movement_v1')).toContain("if m.decided_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_REVERSE'");
    expect(body('public.list_finance_payment_requests_v1')).toContain("'canReverse', r.status = 'paid' and v_confirm and (r.paid ->> 'by') is distinct from v_actor::text");
    expect(body('public.get_finance_cash_v1')).toContain("'canReverse', m.status = 'confirmed' and v_confirm and m.decided_by is distinct from v_actor");
  });

  it('only permission admins can preview warnings or list people holding conflicting duties', () => {
    expect(body('public.preview_user_authorization_sod_v1')).toContain("app_private.assert_authorization_permission('system.authorization.manage_grants')");
    expect(body('public.list_user_sod_conflicts_v1')).toContain('if not app_private.can_manage_permissions() then');
    expect(body('public.list_user_sod_conflicts_v1')).toContain("u.role <> 'ADMIN'");
  });
});

describe('sodService', () => {
  const warning = (scopeType: string, scopeId: string, scopeLabel: string | null = null): SodWarning => ({
    ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho', description: 'Người mua tự nhận hàng.',
    scopeType, scopeId, scopeLabel, permissions: [], controls: ['Kiểm kê kho định kỳ có người thứ hai'],
  });

  it('groups one rule across several warehouses into one line', () => {
    const groups = groupSodWarnings([warning('warehouse', 'wh-1', 'Kho Tổng'), warning('warehouse', 'wh-2', 'Kho VPP')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].scopeLabels).toEqual(['Kho Tổng', 'Kho VPP']);
  });

  it('builds one acceptance per warning with the shared answer', () => {
    const ack = { ...emptySodAcknowledgement('u-thinh'), reason: ' Thiếu người ở công trường ', compensatingControls: 'Kiểm kê kho định kỳ có người thứ hai' };
    const rows = toSodAcceptances([warning('warehouse', 'wh-1'), warning('warehouse', 'wh-2')], ack);
    expect(rows.map(row => row.scopeId)).toEqual(['wh-1', 'wh-2']);
    expect(rows[0]).toMatchObject({ reason: 'Thiếu người ở công trường', controlOwnerUserId: 'u-thinh' });
  });

  it('says what is still missing before the acknowledgement can be sent', () => {
    const ready = { reason: 'Thiếu người ở công trường', controlOwnerUserId: 'u-thinh', compensatingControls: 'Kiểm kê kho định kỳ', expiresAt: sodExpiryAfterMonths(6) };
    expect(sodAcknowledgementIssue(ready, 'u-admin', 'u-ha')).toBe('');
    expect(sodAcknowledgementIssue({ ...ready, reason: 'ngắn' }, 'u-admin', 'u-ha')).toContain('Lý do');
    expect(sodAcknowledgementIssue({ ...ready, controlOwnerUserId: 'u-admin' }, 'u-admin', 'u-ha')).toContain('khác người đang cấp');
    expect(sodAcknowledgementIssue({ ...ready, controlOwnerUserId: 'u-ha' }, 'u-admin', 'u-ha')).toContain('khác người được cấp');
    expect(sodAcknowledgementIssue({ ...ready, expiresAt: '2020-01-01T00:00:00Z' }, 'u-admin', 'u-ha')).toContain('hạn');
  });

  it('reads an empty or partial server answer safely', () => {
    expect(toSodPreview(null)).toEqual({ warnings: [], hardDenies: [], defaultControlOwnerId: null });
    expect(toSodPreview({ warnings: [{ ...warning('global', '*'), controls: undefined }] }).warnings[0].controls).toEqual([]);
  });
});
