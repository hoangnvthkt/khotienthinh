import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260921113000_procurement_atomic_purchase_order_allocation.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('atomic procurement purchase-order allocation migration', () => {
  it('locks demand lines before creating the purchase-order aggregate', () => {
    expect(sql).toContain('create_procurement_purchase_order_v1');
    expect(sql).toMatch(/procurement_demand_lines[\s\S]+order by[\s\S]+for update[\s\S]+save_purchase_order_aggregate_v1/);
  });

  it('commits allocation through the shared G2 owner in the same transaction', () => {
    expect(sql).toContain('app_private.save_procurement_allocation_v1');
    expect(sql).toContain("'committed'");
    expect(sql).toContain("'po'");
    expect(sql).not.toMatch(/when[\s\S]+unique_violation[\s\S]+procurement_available_exceeded/);
  });

  it('uses the W2 aggregate owner and blocks legacy company links without allocation', () => {
    expect(sql).toContain('app_private.save_purchase_order_aggregate_v1');
    expect(sql).toContain('procurement_company_link_requires_allocation');
    expect(sql).toContain('constraint trigger');
    expect(sql).toContain('deferrable initially deferred');
  });

  it('recognizes an exact aggregate retry before checking changed demand versions', () => {
    expect(sql).toContain('procurement_purchase_order_commands');
    const replayGuard = sql.indexOf('if v_prior.result is not null');
    const demandLock = sql.indexOf('stable demand-line lock order');
    expect(replayGuard).toBeGreaterThan(0);
    expect(replayGuard).toBeLessThan(demandLock);
    expect(sql).toContain('v_prior.payload_hash <> v_payload_hash');
  });

  it('derives actor and exposes only an invoker wrapper', () => {
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).not.toContain('coalesce(p_actor_user_id');
    expect(sql).toMatch(/create function public\.create_procurement_purchase_order_v1[\s\S]+security invoker/);
  });
});
