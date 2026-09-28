import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = () => readFileSync(
  'supabase/migrations/20260925161000_verified_resource_usage_evidence.sql', 'utf8',
);

describe('verified resource usage evidence migration', () => {
  it('exposes only verified normalized summaries behind an explicit Payment Room action', () => {
    const sql = migration();
    expect(sql).toContain('get_verified_resource_usage_evidence_v1');
    expect(sql).toContain("summary_source_type = 'member_contributions'");
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("'view_resource_evidence'");
    expect(sql).toContain('resource_semantics_version = 2');
    expect(sql).toContain('RESOURCE_EVIDENCE_SCOPE_DENIED');
  });

  it('uses explicit JSON fields and never references pricing or transaction data', () => {
    const sql = migration();
    expect(sql).toContain('jsonb_build_object');
    expect(sql).toContain("'resourceLineId'");
    expect(sql).toContain("'revisionState'");
    expect(sql).not.toContain('unit_cost');
    expect(sql).not.toContain('total_cost');
    expect(sql).not.toContain('internal_price_book');
    expect(sql).not.toContain('project_transactions');
  });

  it('blocks verified summary table bypass but retains a scoped physical Daily Log read', () => {
    const sql = migration();
    expect(sql).toContain('drop policy daily_log_labor_select');
    expect(sql).toContain('drop policy daily_log_machines_select');
    expect(sql).toContain('get_daily_log_physical_resources_v1');
    expect(sql).toContain('DAILY_LOG_RESOURCE_ACCESS_DENIED');
  });
});
