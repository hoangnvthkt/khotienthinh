import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('quyền Duyệt PO tách khỏi Quản trị Mua hàng (20261029090000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261029090000_procurement_po_approve_permission.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.indexOf(`create or replace function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf('$function$;', start));
  };

  it('adds system.procurement.approve as a grantable, non-expiring business approval', () => {
    expect(sql).toContain("values ('system.procurement', 'approve', 'system.procurement.approve', 'Duyệt PO',");
    expect(sql).toContain("array['global'], 'PROCUREMENT', '/procurement', false, 30, true, 'sensitive', true, true, false, 'enforced', 'procurement', true)");
  });

  it('makes approvers the holders of Duyệt PO, not of Quản trị Mua hàng', () => {
    expect(body('app_private.procurement_po_approver_ok')).toContain("app_private.has_permission(u.id, 'system.procurement.approve')");
    expect(body('app_private.procurement_po_approver_ok')).not.toContain("'system.procurement.manage'");
    for (const list of ['public.get_procurement_order_v1', 'public.get_procurement_contract_v1', 'public.assistant_po_approvers_v1']) {
      expect(body(list), list).toContain("and app_private.has_permission(u.id, 'system.procurement.approve')");
      expect(body(list), list).not.toContain("(u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))");
    }
  });

  it('lets an approver approve or return the order sent to them without the manage permission', () => {
    const transition = body('public.transition_procurement_hub_po_v1');
    expect(transition).toContain("or (v_action in ('approve', 'return') and app_private.procurement_can('approve'))) then");
    expect(transition).toContain("submitted_to_permission = 'system.procurement.approve'");
    expect(transition).toContain("or not (v_po.submitted_to_user_id = v_actor::text or public.is_admin()) then");
  });

  it('lets approvers open Mua hàng read-only and approve hot purchases without a site commander', () => {
    expect(body('app_private.procurement_can')).toContain("app_private.has_permission(public.current_app_user_id(), 'system.procurement.approve')");
    expect(body('app_private.hot_purchase_can_approve')).toContain("app_private.has_permission(v_actor, 'system.procurement.approve', 'global', '*')");
  });

  it('grants Duyệt PO to chị Đặng Thị Thu Hà and chị Nguyễn Thị Mơ', () => {
    expect(sql).toContain("and u.email in ('hadtt@tienthinhjsc.vn', 'mont@tienthinhjsc.vn')");
  });
});
