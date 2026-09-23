import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260923100750_material_plan_procurement_intake.sql', import.meta.url), 'utf8');

describe('Project V2 material plan canonical intake migration', () => {
  it('uses the canonical source document, immutable revision, registry and demand tables', () => {
    for (const name of ['procurement_source_documents', 'procurement_source_line_registry',
      'procurement_source_revisions', 'procurement_demands', 'procurement_demand_lines',
      'procurement_demand_revisions']) expect(sql).toContain(name);
    expect(sql).toContain("source_adapter = 'material_plan'");
    expect(sql).toContain('on conflict (source_document_id, source_line_id)');
    expect(sql).toContain('on conflict (source_document_id, revision)');
  });

  it('publishes in the same approval transaction with replay and source change controls', () => {
    expect(sql).toContain('sync_material_plan_demand_v1');
    expect(sql).toContain("p_operation = 'approve'");
    expect(sql).toContain('project_v2_validate_sources');
    expect(sql).toContain('procurement_events_outbox');
    expect(sql).toContain('source_changed');
    expect(sql).toContain('reconciliation_required');
    expect(sql).toContain('allocated_quantity');
  });
});
