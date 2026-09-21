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

  it('requires budget, work, item and unit identities to agree', () => {
    expect(sql).toMatch(/budget\.work_boq_item_id is not distinct from line\.work_boq_item_id/);
    expect(sql).toMatch(/budget\.work_boq_item_id is not distinct from source\.work_id/);
  });

  it('scopes issued-request subtraction by both request and line identity', () => {
    expect(sql).toMatch(/issue\.material_request_id request_id[\s\S]+line\.material_request_line_id request_line_id/);
    expect(sql).toMatch(/linked\.request_id = request\.id[\s\S]+linked\.request_line_id = registry\.source_line_id/);
  });

  it('returns decimal strings, whole-filter totals and a stable page cursor', () => {
    expect(sql).toContain("'metricversion'");
    expect(sql).toContain("'nextcursor'");
    expect(sql).toContain("'totals'");
    expect(sql).toContain("'unallocatedeffectcount'");
    expect(sql).toContain('::text');
    expect(sql).toContain('p_cursor');
  });

  it('versions contributing quantities and identities rather than counts alone', () => {
    const versionSource = sql.match(/version_source as \([\s\S]+?\n  \),\n  line_json as/)?.[0] || '';
    expect(versionSource).toContain('string_agg');
    expect(versionSource).toContain('budget_qty');
    expect(versionSource).toContain('issued_net');
    expect(versionSource).toContain('request_status');
  });

  it('keeps the synthetic unallocated node reachable after paginated work nodes', () => {
    expect(sql).toMatch(/select '__unallocated__'[\s\S]+p_cursor is null or \(2147483647, '__unallocated__'/);
    expect(sql).toContain("when p_cursor = '__unallocated__' then 2147483647");
  });

  it('retains the ancestor path when search matches only a child work or material', () => {
    expect(sql).toContain('with recursive');
    expect(sql).toMatch(/matched_work as materialized[\s\S]+work_filter_tree as \([\s\S]+join work_filter_tree child/);
  });

  it('does not grant new direct table access', () => {
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)[\s\S]+on\s+(table\s+)?public\./);
  });
});
