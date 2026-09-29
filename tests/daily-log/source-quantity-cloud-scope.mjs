export const migration='20260926113919_daily_log_source_quantity_entry_v2.sql';
export const conflictMigration='20260926163158_daily_log_source_save_conflict_http_v2.sql';
export const boundsMigration='20260926163810_daily_log_source_entry_bounds_v2.sql';
export const missingBasisMigration='20260926164443_daily_log_source_missing_basis_null_v2.sql';
export function selectSourceQuantityMigrationFiles(history,files) {
  const selected=history.map(({version,name}) => {
    const matches=files.filter(file=>file===`${version}_${name}.sql`);
    if(matches.length!==1) throw new Error(`Unreconciled recorded migration: ${version}`);
    return matches[0];
  });
  if(!files.includes(migration)) throw new Error('Daily Log quantity migration missing');
  if(!files.includes(conflictMigration)) throw new Error('Daily Log HTTP-conflict migration missing');
  if(!files.includes(boundsMigration)) throw new Error('Daily Log entry-bounds migration missing');
  if(!files.includes(missingBasisMigration)) throw new Error('Daily Log missing-basis migration missing');
  return [...new Set([...selected,migration,conflictMigration,boundsMigration,missingBasisMigration])];
}
export function assertOnlySourceQuantityPending(output,expected=[missingBasisMigration]) {
  const pending=[...new Set(output.match(/\d{14}_[\w]+\.sql/g) ?? [])];
  if(!expected.length || pending.length!==expected.length || pending.some(file=>!expected.includes(file))
    || expected.some(file=>![migration,conflictMigration,boundsMigration,missingBasisMigration].includes(file))) throw new Error('Dry-run did not select exactly the approved Daily Log quantity migrations');
}
