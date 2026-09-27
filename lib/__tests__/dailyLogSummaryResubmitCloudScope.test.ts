import {describe,it,expect} from 'vitest';
import {migration,selectResubmitMigrationFiles,assertOnlyResubmitPending} from '../../tests/daily-log/summary-resubmit-cloud-scope.mjs';
describe('V2 resubmit migration isolation',()=>{
  const base='20260903063714_cloud_schema_baseline_v2.sql',history=[{version:'20260903063714',name:'cloud_schema_baseline_v2'}];
  it('selects recorded history and only the approved suffix, excluding parallel work',()=>{
    expect(selectResubmitMigrationFiles(history,[base,migration,'20260927070000_procurement.sql'])).toEqual([base,migration]);
  });
  it('rejects absent or duplicated history and a missing approved suffix',()=>{
    expect(()=>selectResubmitMigrationFiles(history,[migration])).toThrow(/Unreconciled/);
    expect(()=>selectResubmitMigrationFiles(history,[base,base,migration])).toThrow(/Unreconciled/);
    expect(()=>selectResubmitMigrationFiles(history,[base])).toThrow(/missing/);
  });
  it('refuses a dry-run with unrelated, zero, or repeated files',()=>{
    expect(()=>assertOnlyResubmitPending('No pending migrations')).toThrow();
    expect(()=>assertOnlyResubmitPending(`${migration}\n20260927070000_procurement.sql`)).toThrow();
    expect(()=>assertOnlyResubmitPending(`${migration}\n${migration}`)).toThrow();
    expect(()=>assertOnlyResubmitPending(migration)).not.toThrow();
  });
});
