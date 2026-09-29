import { describe, expect, it } from 'vitest';
import { assertOnlySourceSelectionPending, migration, selectSourceSelectionMigrationFiles } from '../../tests/daily-log/source-selection-cloud-scope.mjs';

describe('Daily Log Cloud staging boundary', () => {
  it('includes recorded history and only the approved new migration', () => {
    expect(selectSourceSelectionMigrationFiles([{version:'20260923090000',name:'daily_log_wbs_area_foundation'}],
      ['20260923090000_daily_log_wbs_area_foundation.sql', '20260924094500_project_material_request_site_stock_context.sql', migration]))
      .toEqual(['20260923090000_daily_log_wbs_area_foundation.sql', migration]);
  });
  it('fails closed on unknown or ambiguous history', () => {
    expect(() => selectSourceSelectionMigrationFiles([{version:'20260924094500',name:'other_stream'}], [migration])).toThrow('Unreconciled');
    expect(() => selectSourceSelectionMigrationFiles([], [])).toThrow('missing');
  });
  it('rejects zero or additional pending files before any apply', () => {
    expect(() => assertOnlySourceSelectionPending('Up to date')).toThrow();
    expect(() => assertOnlySourceSelectionPending(`${migration}\n20260924094500_other_stream.sql`)).toThrow();
    expect(() => assertOnlySourceSelectionPending(`Would push: ${migration}`)).not.toThrow();
  });
});
