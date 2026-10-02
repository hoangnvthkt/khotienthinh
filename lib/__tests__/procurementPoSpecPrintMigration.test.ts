import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261008133200_procurement_po_spec_print.sql'), 'utf8');

describe('Mua hàng — quy cách dòng đơn chủ động + dữ liệu mẫu in', () => {
  it('stores a trimmed display specification on proactive lines and returns it with the order', () => {
    expect(sql).toContain("'specification', nullif(left(btrim(coalesce(it->>'specification', '')), 160), '')");
    expect(sql).toContain("'specification', x.value->>'specification'");
  });
  it('returns the creator job title for the approval print', () => {
    expect(sql).toContain("'createdByTitle', (select e.title from public.employees e");
  });
});
