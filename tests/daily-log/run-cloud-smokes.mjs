import { readFileSync } from 'node:fs';
import { query, ref } from './cloud.mjs';
// This runner intentionally refuses main and uses the same branch guard as E2E.
for (const name of ['daily_log_wbs_area_foundation_smoke.sql','daily_log_summary_progress_publication_smoke.sql',
  'daily_log_contribution_room_insert_smoke.sql','daily_log_shadow_pilot_smoke.sql',
  'daily_log_shadow_uncompared_smoke.sql','daily_log_cutover_guard_smoke.sql']) {
  await query(readFileSync(`supabase/tests/${name}`,'utf8'),false);
  console.log(JSON.stringify({ref,test:name,result:'PASS',writes:'rolled back'}));
}
const operation=readFileSync('supabase/operations/daily_log_wbs_area_pilot.sql','utf8');
let rejected=false;
try { await query(`begin; ${operation} rollback;`,false); }
catch(error) { if(!String(error).includes('DAILY_LOG_OPERATION_PARAMETERS_REQUIRED')) throw error; rejected=true; }
if(!rejected) throw new Error('Operator script accepted missing parameters');
const config={projectId:'DL-WBS-PILOT-20260925',constructionSiteId:null,mode:'paused',cutoverDate:'2026-09-25',
  releaseId:'daily-log-operator-smoke',ownerUserId:'72000000-0000-4000-8000-000000000004',reason:'Operator rollback rehearsal'};
const literal=JSON.stringify(config).replaceAll("'","''");
await query(`begin; select set_config('app.daily_log_operation','${literal}',true); ${operation} rollback;`,false);
console.log(JSON.stringify({ref,test:'operator parameters / pause audit',result:'PASS',writes:'rolled back'}));
