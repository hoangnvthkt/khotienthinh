import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260923092758_project_v2_material_candidates.sql', import.meta.url), 'utf8');

describe('Project V2 material candidate migration', () => {
  it('resolves only scoped, approved construction source revisions', () => {
    expect(sql).toContain('list_project_v2_material_candidates_v1');
    expect(sql).toContain('p.effective_revision_no');
    expect(sql).toContain('p.plan_type = \'construction\'');
    expect(sql).toContain('p.workspace_id = v_workspace.id');
  });

  it('uses exact norm and inventory identity without name or SKU matching', () => {
    expect(sql).toContain('project_work_boq_norm_component_estimates');
    expect(sql).toContain('material_budget_items');
    expect(sql).toContain('source_norm_component_estimate_id');
    expect(sql).toContain('contract_item_resources');
    expect(sql).not.toMatch(/items\.sku\s*=|items\.name\s*=/);
  });

  it('keeps unknown quantities and server-computed previous allocation', () => {
    expect(sql).toContain('availableQty');
    expect(sql).toContain('alreadyPlannedQty');
    expect(sql).toContain('derived_quantity');
    expect(sql).toContain('missing_conversion');
    expect(sql).toContain('ambiguous_mapping');
  });

  it('allows incomplete drafts but requires exact identity, calculation, allocation and an override reason at submit', () => {
    expect(sql).toContain("or plan_type = 'material'");
    expect(sql).toContain('project_v2_validate_material_sources');
    expect(sql).toContain('allocated_quantity');
    expect(sql).toContain('calculated_quantity');
    expect(sql).toContain('override_reason');
    expect(sql).toContain('v_reserved + v_requested > v_source.derived_quantity');
    expect(sql).toContain('PROJECT_V2_MATERIAL_NORM_STALE');
  });
});
