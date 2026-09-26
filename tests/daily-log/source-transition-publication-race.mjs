import assert from 'node:assert/strict';
import pg from 'pg';
import { branchConfig, query, ref } from './cloud.mjs';

// A disposable, isolated fixture scope only. Never promote the existing pilot.
const config=branchConfig(), db=new URL(config.POSTGRES_URL);
assert.ok(db.username.endsWith(`.${ref}`));db.port='5432';
const project=`__DL_UX_RACE_${crypto.randomUUID()}`;
const authorId='72000000-0000-4000-8000-000000000001',chtId='72000000-0000-4000-8000-000000000004';
const authorAuth='f30d5711-1a9d-47b2-a536-9424cc66b822',chtAuth='195531b5-e124-41bb-8648-e7acb106971a';
const connections=[];
const connect=async()=>{const client=new pg.Client({connectionString:db.toString(),connectionTimeoutMillis:10000,statement_timeout:30000});
  await client.connect();connections.push(client);return client;};
const asActor=async(client,authId)=>{
  await client.query('begin');await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:authId,role:'authenticated'})]);
  await client.query('set local role authenticated');assert.equal((await client.query('select public.is_admin() value')).rows[0].value,false);
};
const rpc=async(client,sql,params)=> (await client.query(sql,params)).rows[0].receipt;
const seed=await connect(),first=await connect(),second=await connect();
const pilotBefore=await query("select mode,cutover_date,release_id,owner_user_id,updated_at from app_private.daily_log_wbs_rollout_scopes where project_id='DL-WBS-PILOT-20260925' and construction_site_id is null");
let created=false;
try {
  await seed.query(`insert into public.projects(id,code,name,project_type,status) values($1,$1,'Disposable Daily Log race fixture','construction','active')`,[project]);created=true;
  await seed.query(`insert into public.project_staff(id,project_id,user_id,position_id,start_date)
    select gen_random_uuid(),$1,s.user_id,s.position_id,current_date from public.project_staff s where s.project_id='DL-WBS-PILOT-20260925'
      and s.user_id in($2,$3) and s.end_date is null and s.construction_site_id is null`,[project,authorId,chtId]);
  await seed.query(`insert into public.project_permission_room_members(id,project_id,room_code,project_staff_id,is_active,created_by)
    select gen_random_uuid(),$1,'daily_log',s.id,true,$2 from public.project_staff s where s.project_id=$1`,[project,chtId]);
  await seed.query(`insert into public.project_permission_room_member_actions(room_member_id,action_code,is_active,granted_by,grant_source)
    select m.id,a.action_code,true,$2,'manual_room' from public.project_permission_room_members m
    join public.project_staff new_staff on new_staff.id=m.project_staff_id
    join public.project_staff original on original.user_id=new_staff.user_id and original.project_id='DL-WBS-PILOT-20260925' and original.end_date is null
    join public.project_permission_room_members old_m on old_m.project_staff_id=original.id and old_m.room_code='daily_log' and old_m.is_active
    join public.project_permission_room_member_actions a on a.room_member_id=old_m.id and a.is_active where m.project_id=$1`,[project,chtId]);
  await seed.query(`insert into app_private.daily_log_wbs_rollout_scopes(project_id,mode,cutover_date,reason,created_by)
    values($1,'enforced','2026-09-25','Disposable Task4 race fixture only; not an operator rollout',$2)`,[project,chtId]);
  for(const winner of ['approve','return']) {
    const task=`${project}_${winner}`,date='2099-09-02',log=`${project}_${winner}_target`,otherLog=`${project}_${winner}_other`;
    await seed.query(`insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
      values($1,$2,'Race leaf','2099-09-01','2099-09-30','m3',100)`,[task,project]);
    await asActor(first,authorAuth);
    const made=await rpc(first,'select public.create_daily_log_source_v2($1,$2,null,$3,$4,$4) receipt',[crypto.randomUUID(),project,date,winner.toUpperCase()]);
    const bundle=await rpc(first,'select public.get_daily_log_document_bundle_v2($1,null,$2,null,$3) receipt',[project,date,made.contributionId]);
    await rpc(first,'select public.save_daily_log_source_document_v2($1) receipt',[{contributionId:made.contributionId,expectedRowVersion:1,
      workAreaCode:winner.toUpperCase(),workAreaName:winner.toUpperCase(),content:'Race physical source',issues:'',photos:[],
      items:[{clientKey:'w',taskId:task,entryMode:'daily_quantity',enteredValue:12,forecastFinishDate:'2099-09-30',baselineFingerprint:bundle.baselineQuantityFingerprints[task]}],labor:[],machines:[]}]);
    await rpc(first,'select public.submit_daily_log_source_v2($1) receipt',[{commandId:crypto.randomUUID(),contributionId:made.contributionId,expectedRowVersion:2}]);
    await first.query('commit');
    const card=crypto.randomUUID(),otherCard=crypto.randomUUID();
    await seed.query(`insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,submitted_to_user_id)
      values($1,$3,$4,'Race fixture',$5,'submitted','member_contributions',$6,$5),($2,$3,$4,'Other pending',$5,'draft','member_contributions',$6,null)`,
      [log,otherLog,project,date,chtId,`${date}T12:00:00Z`]);
    await seed.query(`insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status)
      select x.id,x.log,c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'ready' from public.daily_log_contributions c
      cross join(values($1::uuid,$2::text),($3::uuid,$4::text)) x(id,log) where c.id=$5`,[card,log,otherCard,otherLog,made.contributionId]);
    await seed.query(`insert into public.daily_log_work_items(daily_log_id,summary_source_id,source_work_item_id,project_id,task_id,work_area_code,work_area_name_snapshot,
      task_name_snapshot,unit_snapshot,planned_quantity_snapshot,baseline_progress_percent,baseline_quantity_done,baseline_fingerprint,cumulative_progress_percent,
      cumulative_quantity_done,daily_quantity_done,schedule_finish_date_snapshot,forecast_finish_date)
      select $1,$2,w.id,w.project_id,w.task_id,w.work_area_code,w.work_area_name_snapshot,w.task_name_snapshot,w.unit_snapshot,w.planned_quantity_snapshot,
      w.baseline_progress_percent,w.baseline_quantity_done,w.baseline_fingerprint,w.cumulative_progress_percent,w.cumulative_quantity_done,w.daily_quantity_done,
      w.schedule_finish_date_snapshot,w.forecast_finish_date from public.daily_log_work_items w where w.contribution_id=$3`,[log,card,made.contributionId]);
    await seed.query(`insert into public.daily_log_wbs_decisions(daily_log_id,task_id,official_cumulative_percent,official_cumulative_quantity,official_daily_quantity,
      forecast_finish_date,aggregation_method,daily_quantity_method,included_source_work_item_ids,source_fingerprint)
      select $1,$2,12,12,12,'2099-09-30','single_source','sum_non_overlapping',jsonb_build_array(id),'race-decision' from public.daily_log_work_items where contribution_id=$3`,[log,task,made.contributionId]);
    await seed.query('select app_private.create_daily_log_assignment($1,$2)',[log,chtId]);
    const otherBefore=(await seed.query('select to_jsonb(s) card from public.daily_log_summary_sources s where id=$1',[otherCard])).rows;
    const input={commandId:crypto.randomUUID(),dailyLogId:log,summarySourceId:card,contributionId:made.contributionId,
      expectedSummaryUpdatedAt:`${date}T12:00:00Z`,expectedRowVersion:3,reason:'Concurrent correction'};
    const approve=client=>rpc(client,'select public.publish_daily_log_summary_v1($1,$2,$3) receipt',[log,`${date}T12:00:00Z`,crypto.randomUUID()]);
    const returnSource=client=>rpc(client,'select public.return_daily_log_source_v2($1) receipt',[input]);
    await asActor(first,chtAuth);await asActor(second,chtAuth);
    // The pooler's protocol PID is not necessarily PostgreSQL's backend PID.
    const waitPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
    const outcome=await (winner==='approve' ? approve(first) : returnSource(first));
    let secondDone=false;
    const competing=(winner==='approve' ? returnSource(second) : approve(second)).then(value=>({value}),error=>({error})).finally(()=>{secondDone=true;});
    let blocked=false;
    for(let attempt=0;attempt<60 && !secondDone;attempt++) {
      blocked=(await seed.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[waitPid])).rows[0]?.blocked;
      if(blocked) break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(blocked,true,'competing command did not wait on the common lock prefix');
    await first.query('commit');
    const lost=await competing;assert.ok(lost.error,'both mutually exclusive commands committed');
    assert.equal(lost.error.code,'42501');assert.equal(lost.error.message,winner==='approve' ? 'VERIFIED_SOURCE_IMMUTABLE' : 'SUBMITTED_SUMMARY_REQUIRED');
    await second.query('rollback');
    const state=(await seed.query(`select l.status summary,c.status source,c.row_version,(select count(*) from public.project_daily_task_progress where project_id=$1 and task_id=$2) progress
      from public.daily_logs l join public.daily_log_contributions c on c.id=$3 where l.id=$4`,[project,task,made.contributionId,log])).rows[0];
    assert.equal(state.summary,winner==='approve' ? 'verified':'rejected');assert.equal(state.source,winner==='approve' ? 'included':'returned');
    assert.equal(Number(state.row_version),winner==='approve' ? 3:4);assert.equal(Number(state.progress),winner==='approve' ? 1:0);
    assert.deepEqual((await seed.query('select to_jsonb(s) card from public.daily_log_summary_sources s where id=$1',[otherCard])).rows,otherBefore);
    assert.equal(outcome[winner==='approve' ? 'publishedProgress':'status'],winner==='approve' ? true:'returned');
    console.log(JSON.stringify({ref,winner,concurrency:'competing command blocked then denied',halfState:false,otherPendingSnapshot:'unchanged'}));
  }
} catch(error) {
  // Do not print connection strings or a driver error containing its config.
  console.log(JSON.stringify({failure:{message:error.message,code:error.code},fixtureProjectId:project}));
  throw new Error('Publication race failed; see redacted failure above');
} finally {
  await Promise.all([first.query('rollback'),second.query('rollback')]);
  if(created) {
    await seed.query('begin');
    const cleanup=`
    delete from public.app_assignment_events where assignment_id in(select id from public.app_assignments where scope_id=$1 and subject_type='daily_log');
    delete from public.app_assignments where scope_id=$1 and subject_type='daily_log';
    delete from public.daily_log_publish_commands where daily_log_id in(select id from public.daily_logs where project_id=$1);
    delete from public.project_daily_task_progress where project_id=$1;
    delete from public.weekly_progress_snapshots where project_id=$1;
    delete from public.project_progress_period_states where project_id=$1;
    delete from public.daily_log_contributions where project_id=$1;
    delete from public.daily_logs where project_id=$1;
    delete from app_private.daily_log_source_command_receipts where project_id=$1;
    delete from app_private.daily_log_wbs_rollout_scopes where project_id=$1;
    delete from public.project_tasks where project_id=$1;
    delete from public.project_staff where project_id=$1;
    delete from public.projects where id=$1 and name='Disposable Daily Log race fixture';`;
    for(const statement of cleanup.split(';').map(value=>value.trim()).filter(Boolean)) await seed.query(statement,[project]);
    await seed.query('commit');
  }
  await Promise.all(connections.map(client=>client.end()));
  assert.deepEqual(await query("select mode,cutover_date,release_id,owner_user_id,updated_at from app_private.daily_log_wbs_rollout_scopes where project_id='DL-WBS-PILOT-20260925' and construction_site_id is null"),pilotBefore);
  assert.equal((await query(`select count(*) n from public.projects where id='${project}'`))[0].n,0);
  console.log(JSON.stringify({cleanup:'disposable race scope removed',existingPilot:'unchanged'}));
}
