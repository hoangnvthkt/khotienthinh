import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchConfig, query, ref } from './cloud.mjs';
import { buildRollbackSql } from '../../scripts/lib/supabase-cloud-transaction.mjs';
import { assertOnlyResubmitPending, migration, selectResubmitMigrationFiles } from './summary-resubmit-cloud-scope.mjs';

const migrations=[migration];
const mode=process.argv[2] ?? '--rehearse';
if(!['--rehearse','--smoke','--dry-run','--apply','--advisors'].includes(mode)) throw new Error('Unsupported mode');
const smokeFiles=['daily_log_summary_resubmit_route_v2_smoke.sql','daily_log_summary_pending_draft_v2_smoke.sql','daily_log_summary_legacy_source_draft_opt_in_smoke.sql','daily_log_source_return_resubmit_smoke.sql','daily_log_source_submit_readiness_smoke.sql','daily_log_source_v2_publication_smoke.sql','daily_log_source_quantity_smoke.sql','daily_log_source_area_quantity_smoke.sql','daily_log_source_save_boundary_smoke.sql',
  'daily_log_source_selection_smoke.sql','daily_log_wbs_area_foundation_smoke.sql','daily_log_summary_progress_publication_smoke.sql',
  'daily_log_contribution_room_insert_smoke.sql','daily_log_shadow_pilot_smoke.sql','daily_log_shadow_uncompared_smoke.sql',
  'daily_log_cutover_guard_smoke.sql','daily_log_returned_summary_source_guard_smoke.sql','resource_usage_evidence_smoke.sql'];
if(mode==='--rehearse' || mode==='--smoke') {
  const history=await query('select version,name from supabase_migrations.schema_migrations order by version');
  const pending=migrations.filter(file=>!history.some(row=>row.version===file.slice(0,14)));
  const sql=mode==='--rehearse' ? pending.map(file=>readFileSync(`supabase/migrations/${file}`,'utf8')).join('\n') : '';
  for(const name of smokeFiles) {
    const smoke=readFileSync(`supabase/tests/${name}`,'utf8').replace(/^(?:\s*--[^\n]*\n)*\s*/,'');
    await query(buildRollbackSql(sql,[smoke]),false);
    console.log(JSON.stringify({ref,test:name,result:'PASS',writes:'rolled back'}));
  }
} else {
  const config=branchConfig();
  const db=new URL(config.POSTGRES_URL);
  if(!db.username.endsWith(`.${ref}`)) throw new Error('Database target mismatch');
  db.port='5432';
  const redact=value => {
    let output=String(value);
    for(const secret of [...Object.values(config),db.toString(),db.password,decodeURIComponent(db.password),process.env.SUPABASE_ACCESS_TOKEN]) {
      if(typeof secret==='string' && secret) output=output.replaceAll(secret,'[REDACTED]');
    }
    return output;
  };
  const cli=args => {
    const result=spawnSync('npx',['--no-install','supabase',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
    const output=redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    if(result.status!==0) throw new Error(output || 'Supabase CLI failed');
    return output;
  };
  if(mode==='--advisors') console.log(cli(['db','advisors','--db-url',db.toString(),'--type','security','--level','warn','--agent=no','-o','json']));
  else {
    const history=await query('select version,name from supabase_migrations.schema_migrations order by version');
    const pending=migrations.filter(file=>!history.some(row=>row.version===file.slice(0,14)));
    if(!pending.length) throw new Error('Summary draft migration already recorded; use --smoke instead');
    const selected=selectResubmitMigrationFiles(history,readdirSync('supabase/migrations'));
    const staging=mkdtempSync(join(tmpdir(),'daily-log-summary-resubmit-'));
    try {
      mkdirSync(join(staging,'supabase','migrations'),{recursive:true});
      copyFileSync('supabase/config.toml',join(staging,'supabase','config.toml'));
      for(const name of selected) copyFileSync(`supabase/migrations/${name}`,join(staging,'supabase','migrations',name));
      const args=['db','push','--workdir',staging,'--db-url',db.toString(),'--yes','--agent=no'];
      const dry=cli([...args,'--dry-run']);
      assertOnlyResubmitPending(dry);
      console.log(dry);
      if(mode==='--apply') {
        console.log(cli(args));
        const after=await query('select version,name from supabase_migrations.schema_migrations order by version');
        if(after.length!==history.length+pending.length || JSON.stringify(after.slice(0,history.length))!==JSON.stringify(history)
          || JSON.stringify(after.slice(history.length).map(row=>`${row.version}_${row.name}.sql`))!==JSON.stringify(pending)) throw new Error('Unexpected migration ledger change');
        console.log(JSON.stringify({ref,applied:pending,recordedVersions:after.length}));
      }
    } finally {
      // Remove only this freshly created CLI staging directory, never a checkout.
      rmSync(staging,{recursive:true,force:true});
    }
  }
}
