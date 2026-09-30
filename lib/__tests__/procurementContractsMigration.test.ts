import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261001210000_procurement_contracts.sql'), 'utf8').toLowerCase();

describe('Mua hàng M2b migration — hợp đồng nguyên tắc', () => {
  it('prices deliveries by the contract price valid on the delivery date', () => {
    expect(sql).toContain('add column effective_from date');
    expect(sql).toContain('app_private.procurement_contract_price(n.supplier_contract_id, l.item_id, n.delivery_date)');
    expect(sql).toContain("message = 'procurement_contract_price_overlap'");
  });

  it('gathers a month of accepted deliveries into one statement, only once each', () => {
    expect(sql).toContain("date_trunc('month', d.delivery_date)::date <> v_month");
    expect(sql).toContain('(d.statement_id is not null and d.statement_id is distinct from v_id)');
    expect(sql).toContain("and other_s.status in ('draft', 'confirmed', 'posted')");
  });

  it('separates the buyer who confirms from the accountant who records the payable', () => {
    expect(sql).toContain("app_private.project_actor_has_effective_room_action(p_actor, p_project_id, p_site_id, 'payment', 'confirm')");
    expect(sql).toContain("message = 'procurement_statement_self_post'");
    expect(sql).toContain("check (status = any (array['draft', 'confirmed', 'posted', 'cancelled', 'reversed']))");
  });

  it('stops sites from preparing or posting statements themselves', () => {
    expect(sql).toContain('create trigger trg_guard_supplier_statement_origin before insert on public.supplier_delivery_statements');
    expect(sql).toContain("if not (app_private.procurement_hub_context_enabled() or public.is_admin()) then");
  });
});
