import { describe, expect, it } from 'vitest';
import { assertOnlySourceTransitionPending, migration, readinessMigration, selectSourceTransitionMigrationFiles } from '../../tests/daily-log/source-transition-cloud-scope.mjs';

describe('Source lifecycle migration Cloud boundary', () => {
  const history = [{ version: '20260903063714', name: 'cloud_schema_baseline_v2' }];
  const files = ['20260903063714_cloud_schema_baseline_v2.sql', migration, readinessMigration, '20260927010000_unrelated_procurement.sql'];
  it('selects recorded history plus only the approved lifecycle migration', () => {
    expect(selectSourceTransitionMigrationFiles(history, files)).toEqual([files[0], migration, readinessMigration]);
  });
  it('fails closed when a recorded file is absent rather than repairing history', () => {
    expect(() => selectSourceTransitionMigrationFiles(history, [migration])).toThrow(/Unreconciled/);
  });
  it('rejects unrelated pending migrations and empty CLI dry-runs', () => {
    expect(() => assertOnlySourceTransitionPending(`Would apply ${migration}\n${files[3]}`)).toThrow();
    expect(() => assertOnlySourceTransitionPending('No pending migrations')).toThrow();
    expect(() => assertOnlySourceTransitionPending(`Would apply ${migration}`)).not.toThrow();
    expect(() => assertOnlySourceTransitionPending(`Would apply ${readinessMigration}`, [readinessMigration])).not.toThrow();
    expect(() => assertOnlySourceTransitionPending(`Would apply ${files[3]}`, [files[3]])).toThrow();
  });
});
