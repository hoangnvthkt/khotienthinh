import { describe, expect, it } from 'vitest';
import { migration, migrations, selectSummaryDraftMigrationFiles, assertOnlySummaryDraftPending } from '../../tests/daily-log/summary-draft-cloud-scope.mjs';
describe('approved summary-draft Cloud migration boundary',()=>{
  const history=[{version:'20260903063714',name:'cloud_schema_baseline_v2'}];
  it('selects recorded history and only the approved new file, leaving procurement files outside the run',()=>{
    expect(selectSummaryDraftMigrationFiles(history,['20260903063714_cloud_schema_baseline_v2.sql',...migrations,'20260927010000_procurement.sql']))
      .toEqual(['20260903063714_cloud_schema_baseline_v2.sql',...migrations]);
  });
  it('refuses absent or ambiguous recorded files rather than changing migration history',()=>{
    expect(()=>selectSummaryDraftMigrationFiles(history,[migration])).toThrow(/Unreconciled/);
    expect(()=>selectSummaryDraftMigrationFiles(history,['20260903063714_cloud_schema_baseline_v2.sql','20260903063714_cloud_schema_baseline_v2.sql',migration])).toThrow(/Unreconciled/);
  });
  it('permits only the newly approved metadata migration after the draft migration is recorded',()=>{
    const metadata='20260927022904_daily_log_summary_source_metadata_snapshot_v2.sql';
    const recorded=[...history,{version:migration.slice(0,14),name:migration.slice(15,-4)}];
    expect(selectSummaryDraftMigrationFiles(recorded,['20260903063714_cloud_schema_baseline_v2.sql',...migrations,'20260927010000_procurement.sql']))
      .toEqual(['20260903063714_cloud_schema_baseline_v2.sql',...migrations]);
    expect(()=>assertOnlySummaryDraftPending(metadata,[metadata])).not.toThrow();
    expect(()=>assertOnlySummaryDraftPending(migration,[metadata])).toThrow();
  });
  it('selects the missing-unit guard without replaying already recorded draft migrations',()=>{
    const guard='20260927031010_daily_log_summary_missing_unit_draft_guard_v2.sql';
    const recorded=[...history,...migrations.filter(file=>file!==guard).map(file=>({version:file.slice(0,14),name:file.slice(15,-4)}))];
    expect(selectSummaryDraftMigrationFiles(recorded,['20260903063714_cloud_schema_baseline_v2.sql',...new Set([...migrations,guard])]))
      .toContain(guard);
    expect(()=>assertOnlySummaryDraftPending(guard,[guard])).not.toThrow();
    expect(()=>assertOnlySummaryDraftPending(migration,[guard])).toThrow();
  });
  it('refuses a CLI dry-run with zero or unrelated migrations',()=>{
    expect(()=>assertOnlySummaryDraftPending('No pending migrations')).toThrow();
    expect(()=>assertOnlySummaryDraftPending(`${migration}\n20260927010000_procurement.sql`)).toThrow();
    expect(()=>assertOnlySummaryDraftPending(migration)).not.toThrow();
  });
});
