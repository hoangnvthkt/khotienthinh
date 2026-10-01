import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260930220000_procurement_inbox.sql'), 'utf8').toLowerCase();

describe('Mua hàng inbox migration', () => {
  it('receives approved needs from every source', () => {
    expect(sql).toContain("where r.request_origin = 'project' and r.status in ('approved', 'in_transit')");
    expect(sql).toContain("where p.status = 'approved'");
  });

  it('treats an older approvedQty of 0 as approved as requested', () => {
    expect(sql).toContain("coalesce(nullif(nullif(x.value->>'approvedqty', '')::numeric, 0), nullif(x.value->>'requestqty', '')::numeric, 0)");
  });

  it('counts only live purchase orders and casts the text delivery date safely', () => {
    expect(sql).toContain("o.status not in ('cancelled', 'returned')");
    expect(sql).toContain("case when expected_delivery_date ~ '^\\d{4}-\\d{2}-\\d{2}' then left(expected_delivery_date, 10)::date end < v_today");
  });

  it('is limited to the company procurement permission', () => {
    expect(sql).toContain("'system.procurement.' || p_action");
    expect(sql).toContain("message = 'procurement_view_denied'");
    expect(sql).toContain("message = 'procurement_manage_denied'");
  });

  it('writes assignments only through the RPC and notifies the assignee', () => {
    expect(sql).toContain('alter table public.procurement_inbox_assignments enable row level security');
    expect(sql).toContain('revoke insert, update, delete on public.procurement_inbox_assignments from authenticated');
    expect(sql).toContain("'procurement_inbox_assigned'");
  });
});
