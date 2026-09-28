export const migration='20260927020541_daily_log_summary_pending_draft_v2.sql';
export const migrations=[migration,'20260927022904_daily_log_summary_source_metadata_snapshot_v2.sql','20260927031010_daily_log_summary_missing_unit_draft_guard_v2.sql','20260927032533_daily_log_summary_document_opt_in_v2.sql'];
export function selectSummaryDraftMigrationFiles(history,files) {
  const recorded=history.map(({version,name})=>{
    const file=`${version}_${name}.sql`;
    if(files.filter(candidate=>candidate===file).length!==1) throw new Error(`Unreconciled recorded migration: ${version}`);
    return file;
  });
  if(migrations.some(file=>!files.includes(file))) throw new Error('Approved summary-draft migration missing');
  return [...new Set([...recorded,...migrations])];
}
export function assertOnlySummaryDraftPending(output,expected=[migration]) {
  const pending=[...new Set(output.match(/\d{14}_[\w]+\.sql/g)??[])];
  if(!expected.length || expected.some(file=>!migrations.includes(file)) || JSON.stringify(pending)!==JSON.stringify(expected)) throw new Error('Dry-run did not select exactly the approved summary-draft migrations');
}
