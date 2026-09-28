export const migration='20260927075421_daily_log_summary_resubmit_route_v2.sql';
export function selectResubmitMigrationFiles(history,files) {
  const recorded=history.map(({version,name})=>{
    const file=`${version}_${name}.sql`;
    if(files.filter(candidate=>candidate===file).length!==1) throw new Error(`Unreconciled recorded migration: ${version}`);
    return file;
  });
  if(files.filter(file=>file===migration).length!==1) throw new Error('Approved resubmit migration missing or ambiguous');
  return [...new Set([...recorded,migration])];
}
export function assertOnlyResubmitPending(output) {
  const pending=output.match(/\d{14}_[\w]+\.sql/g)??[];
  if(pending.length!==1 || pending[0]!==migration) throw new Error('Dry-run did not select only the approved resubmit migration');
}
