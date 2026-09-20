import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260920155632_procurement_identity_authorization.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('procurement identity authorization migration', () => {
  it('maps read, price and allocation to distinct room actions', () => {
    expect(sql).toContain("'material_request', 'view'");
    expect(sql).toContain("'material_po', 'view'");
    expect(sql).toContain("'material_po', 'edit'");
    expect(sql).toContain("'canread'");
    expect(sql).toContain("'canviewprice'");
    expect(sql).toContain("'canallocate'");
  });

  it('filters authorized source rows before balance aggregation', () => {
    expect(sql).toContain('list_procurement_demand_balances_v1');
    expect(sql).toMatch(/eligible_request_lines[\s\S]+project_actor_has_effective_room_action/);
    expect(sql).toMatch(/resolved as materialized \([\s\S]+from eligible_request_lines/);
    expect(sql).toMatch(/fulfillment as \([\s\S]+from resolved/);
    expect(sql).toContain('g2_identity_not_ingested');
    expect(sql).toContain('unallocated_fulfillment_effect');
  });

  it('returns decimal strings and no commercial price fields', () => {
    expect(sql).toContain("'availabletoplanqty'");
    expect(sql).toContain("::text");
    expect(sql).not.toContain("'unitprice'");
    expect(sql).not.toContain("'totalamount'");
  });

  it('derives the actor on the server and exposes invoker wrappers only', () => {
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toMatch(/create function public\.list_procurement_demand_balances_v1[\s\S]+security invoker/);
    expect(sql).not.toContain('p_actor_user_id');
  });
});
