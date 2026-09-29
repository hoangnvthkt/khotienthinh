import { describe, expect, it } from 'vitest';
import { assertOnlySourceQuantityPending, boundsMigration, conflictMigration, migration, missingBasisMigration, selectSourceQuantityMigrationFiles } from '../../tests/daily-log/source-quantity-cloud-scope.mjs';

describe('Whole-source quantity Cloud staging boundary', () => {
  it('includes recorded history, excludes parallel work, and selects exactly one new Daily Log migration', () => {
    expect(selectSourceQuantityMigrationFiles([{version:'20260926102824',name:'daily_log_source_selection_v2'}],
      ['20260926102824_daily_log_source_selection_v2.sql','20260926120000_project_v2_parallel.sql',migration,conflictMigration,boundsMigration,missingBasisMigration]))
      .toEqual(['20260926102824_daily_log_source_selection_v2.sql',migration,conflictMigration,boundsMigration,missingBasisMigration]);
  });
  it('fails closed when recorded migrations are unreconciled or the approved file is absent', () => {
    expect(() => selectSourceQuantityMigrationFiles([{version:'20260926102824',name:'missing'}],[migration])).toThrow('Unreconciled');
    expect(() => selectSourceQuantityMigrationFiles([],[])).toThrow('missing');
  });
  it('rejects zero or extra pending migrations before apply', () => {
    expect(() => assertOnlySourceQuantityPending('Up to date')).toThrow();
    expect(() => assertOnlySourceQuantityPending(`${missingBasisMigration}\n20260926120000_project_v2_parallel.sql`)).toThrow();
    expect(() => assertOnlySourceQuantityPending(`Would push ${missingBasisMigration}`)).not.toThrow();
    expect(() => assertOnlySourceQuantityPending(`Would push ${migration}`)).toThrow();
    expect(() => assertOnlySourceQuantityPending(`${migration}\n${conflictMigration}`,[migration,conflictMigration])).not.toThrow();
  });
});
