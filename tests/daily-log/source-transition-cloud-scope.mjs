export const migration='20260926165732_daily_log_source_return_resubmit_v2.sql';
export const readinessMigration='20260926174010_daily_log_source_readiness_scope_v2.sql';
export function selectSourceTransitionMigrationFiles(history,files) {
  const selected=history.map(({version,name})=>{
    const file=`${version}_${name}.sql`;
    if(files.filter(candidate=>candidate===file).length!==1) throw new Error(`Unreconciled recorded migration: ${version}`);
    return file;
  });
  if(!files.includes(migration)) throw new Error('Daily Log source transition migration missing');
  if(!files.includes(readinessMigration)) throw new Error('Daily Log source readiness migration missing');
  return [...new Set([...selected,migration,readinessMigration])];
}
export function assertOnlySourceTransitionPending(output,expected=[migration]) {
  const pending=[...new Set(output.match(/\d{14}_[\w]+\.sql/g) ?? [])];
  if(!expected.length || pending.length!==expected.length || pending.some(file=>!expected.includes(file))
    || expected.some(file=>![migration,readinessMigration].includes(file))) throw new Error('Dry-run did not select exactly the approved Daily Log source transition migrations');
}
