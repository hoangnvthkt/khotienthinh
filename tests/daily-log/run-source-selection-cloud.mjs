import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchConfig, query, ref } from './cloud.mjs';
import { buildRollbackSql } from '../../scripts/lib/supabase-cloud-transaction.mjs';
import { assertOnlySourceSelectionPending, migration, selectSourceSelectionMigrationFiles } from './source-selection-cloud-scope.mjs';

const mode = process.argv[2] ?? '--rehearse';
if (!['--rehearse','--smoke','--dry-run','--apply','--advisors'].includes(mode)) throw new Error('Unsupported mode');
const smokeFiles = ['daily_log_source_selection_smoke.sql', 'daily_log_wbs_area_foundation_smoke.sql',
  'daily_log_summary_progress_publication_smoke.sql','daily_log_contribution_room_insert_smoke.sql',
  'daily_log_shadow_pilot_smoke.sql','daily_log_shadow_uncompared_smoke.sql',
  'daily_log_cutover_guard_smoke.sql','daily_log_returned_summary_source_guard_smoke.sql', 'resource_usage_evidence_smoke.sql'];

if (mode === '--rehearse' || mode === '--smoke') {
  const migrationSql = mode === '--rehearse' ? readFileSync(`supabase/migrations/${migration}`,'utf8') : '';
  for (const name of smokeFiles) {
    // The common transaction helper expects BEGIN first; retain all other SQL.
    const smoke = readFileSync(`supabase/tests/${name}`,'utf8').replace(/^(?:\s*--[^\n]*\n)*\s*/,'');
    await query(buildRollbackSql(migrationSql,[smoke]),false);
    console.log(JSON.stringify({ref,test:name,result:'PASS',writes:'rolled back'}));
  }
} else {
  const config = branchConfig();
  const db = new URL(config.POSTGRES_URL);
  if (!db.username.endsWith(`.${ref}`)) throw new Error('Database target mismatch');
  // Transaction pooler does not support the CLI's prepared statements.
  db.port='5432';
  const redact = value => {
    let output=String(value);
    for (const secret of [...Object.values(config),db.toString(),db.password,decodeURIComponent(db.password),process.env.SUPABASE_ACCESS_TOKEN]) {
      if (typeof secret === 'string' && secret) output=output.replaceAll(secret,'[REDACTED]');
    }
    return output;
  };
  const cli = args => {
    const result=spawnSync('npx',['--no-install','supabase',...args],{
      encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
    const output=redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    if (result.status!==0) throw new Error(output || 'Supabase CLI failed');
    return output;
  };
  if (mode === '--advisors') {
    console.log(redact(cli(['db','advisors','--db-url',db.toString(),'--type','security','--level','warn','--agent=no','-o','json'])));
  } else {
    const history=await query('select version,name from supabase_migrations.schema_migrations order by version');
    const selected=selectSourceSelectionMigrationFiles(history,readdirSync('supabase/migrations'));
    const staging=mkdtempSync(join(tmpdir(),'daily-log-source-selection-'));
    try {
      mkdirSync(join(staging,'supabase','migrations'),{recursive:true});
      copyFileSync('supabase/config.toml',join(staging,'supabase','config.toml'));
      for (const name of selected) copyFileSync(`supabase/migrations/${name}`,join(staging,'supabase','migrations',name));
      const args=['db','push','--workdir',staging,'--db-url',db.toString(),'--yes','--agent=no'];
      const dry=cli([...args,'--dry-run']);
      assertOnlySourceSelectionPending(dry);
      console.log(redact(dry));
      if (mode === '--apply') {
        // CLI owns migration history; never repair or write its ledger ourselves.
        console.log(redact(cli(args)));
        const after=await query('select version,name from supabase_migrations.schema_migrations order by version');
        if (after.length !== history.length+1 || JSON.stringify(after.slice(0,-1))!==JSON.stringify(history)
          || after.at(-1).version!=='20260926102824') throw new Error('Unexpected migration ledger change');
        console.log(JSON.stringify({ref,applied:migration,recordedVersions:after.length}));
      }
    } finally {
      // Only this explicitly created temporary staging tree is removed.
      rmSync(staging,{recursive:true,force:true});
    }
  }
}
