import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260921084500_boq_material_planning_read_model.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('BOQ material planning read model migration', () => {
  it('exposes an invoker wrapper over a pinned private owner', () => {
    expect(sql).toMatch(/create function app_private\.list_boq_material_planning_v1[\s\S]+security definer\s+set search_path = ''/);
    expect(sql).toMatch(/create function public\.list_boq_material_planning_v1[\s\S]+security invoker\s+set search_path = ''/);
    expect(sql).toMatch(/revoke all on function public\.list_boq_material_planning_v1[\s\S]+from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.list_boq_material_planning_v1[\s\S]+to authenticated, service_role/);
  });

  it('checks planning read and price capabilities independently before aggregation', () => {
    expect(sql).toContain("'material_planning', 'view'");
    expect(sql).toContain("'material_po', 'view'");
    expect(sql).toContain('boq_material_planning_read_denied');
    expect(sql).toMatch(/scoped_budget as materialized[\s\S]+material_budget_items/);
  });

  it('uses exact source identities and keeps unattributed effects explicit', () => {
    expect(sql).toContain('material_budget_item_id');
    expect(sql).toContain('material_request_line_id');
    expect(sql).toContain('procurement_source_line_registry');
    expect(sql).toContain('boq_issue_allocation_missing');
    expect(sql).toContain('boq_request_allocation_missing');
    expect(sql).not.toMatch(/lower\([^)]*item_name[^)]*\)\s*=/);
  });

  it('returns decimal strings, whole-filter totals and a stable page cursor', () => {
    expect(sql).toContain("'metricversion'");
    expect(sql).toContain("'nextcursor'");
    expect(sql).toContain("'totals'");
    expect(sql).toContain("'unallocatedeffectcount'");
    expect(sql).toContain('::text');
    expect(sql).toContain('p_cursor');
  });

  it('does not grant new direct table access', () => {
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)[\s\S]+on\s+(table\s+)?public\./);
  });
});
