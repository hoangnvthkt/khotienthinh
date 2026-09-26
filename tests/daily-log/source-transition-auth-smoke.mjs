import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { branchConfig, query, ref } from './cloud.mjs';

const config=branchConfig();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(30000)})}};
const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options);
const actors=[]; const sourceIds=[]; const commandIds=[];
const command=()=>{const id=crypto.randomUUID();commandIds.push(id);return id;};
const project='DL-WBS-PILOT-20260925',date='2099-08-02',task='__DL_UX_AUTH_TRANSITION_TASK';
const logIds=[`__DL_UX_AUTH_TRANSITION_${crypto.randomUUID()}`,`__DL_UX_AUTH_TRANSITION_${crypto.randomUUID()}`];
const cardIds=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
const rpc=async(actor,name,input)=>{const result=await actor.rpc(name,input);assert.equal(result.error,null,JSON.stringify(result.error));return result.data;};
const login=async authId=>{
  const identity=await admin.auth.admin.getUserById(authId);assert.equal(identity.error,null);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user.email});assert.equal(link.error,null);
  const actor=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);
  const signed=await actor.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'magiclink'});assert.equal(signed.error,null);
  actors.push(actor);assert.equal(await rpc(actor,'is_admin'),false);return actor;
};
const counts=()=>query(`select (select count(*) from public.daily_logs) logs,
  (select count(*) from public.project_daily_task_progress) progress,(select count(*) from public.project_transactions) transactions,
  (select count(*) from public.daily_log_contributions) sources,(select count(*) from public.daily_log_labor) labor,
  (select count(*) from public.daily_log_machines) machines`);
const before=await counts();let createdTask=false;
try {
  const [author,otherAuthor,summarizer,cht,reader]=await Promise.all([
    'f30d5711-1a9d-47b2-a536-9424cc66b822','9d5a2f91-a8cb-4319-9188-3cad28fe4b48','55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8',
    '195531b5-e124-41bb-8648-e7acb106971a','89441ea9-ec40-46f3-b8ef-b647e6ede9b8'].map(login));
  assert.equal((await query(`select count(*) n from public.project_tasks where id='${task}'`))[0].n,0,'pre-existing fixture must not be overwritten');
  await query(`insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
    values('${task}','${project}','Auth lifecycle leaf','2099-08-01','2099-08-30','m3',100)`,false);createdTask=true;
  const scope={p_project_id:project,p_construction_site_id:null,p_log_date:date,p_daily_log_id:null};
  const bundle=id=>rpc(author,'get_daily_log_document_bundle_v2',{...scope,p_contribution_id:id});
  const payloads=[];
  for(const area of ['A','B']) {
    const created=await rpc(author,'create_daily_log_source_v2',{p_command_id:command(),p_project_id:project,p_construction_site_id:null,
      p_log_date:date,p_work_area_code:`UX-AUTH-T-${area}`,p_work_area_name:`Auth lifecycle ${area}`});
    sourceIds.push(created.contributionId);
    const loaded=await bundle(created.contributionId);
    const payload={contributionId:created.contributionId,expectedRowVersion:1,workAreaCode:`UX-AUTH-T-${area}`,workAreaName:`Auth lifecycle ${area}`,
      content:`Auth lifecycle ${area}`,issues:'',photos:[],items:[{clientKey:'w',taskId:task,entryMode:'daily_quantity',enteredValue:12,
        forecastFinishDate:'2099-08-30',baselineFingerprint:loaded.baselineQuantityFingerprints[task]}],
      labor:[{workItemClientKey:'w',laborType:'Auth crew',peopleCount:5,hoursPerPerson:8,
        provider:{entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Auth crew'}}],machines:[]};
    payloads.push(payload);await rpc(author,'save_daily_log_source_document_v2',{p_input:payload});
    if(area==='A') {
      await query(`update public.daily_log_labor set project_id=null where contribution_id='${created.contributionId}'`,false);
      const denied=await author.rpc('submit_daily_log_source_v2',{p_input:{commandId:command(),contributionId:created.contributionId,expectedRowVersion:2}});
      assert.equal(denied.error?.message,'DAILY_LOG_SOURCE_NOT_COMPLETE','HTTP submit accepted mismatched resource scope');
      await query(`update public.daily_log_labor set project_id='${project}' where contribution_id='${created.contributionId}'`,false);
    }
    const input={commandId:command(),contributionId:created.contributionId,expectedRowVersion:2};
    const concurrent=await Promise.all([author.rpc('submit_daily_log_source_v2',{p_input:input}),author.rpc('submit_daily_log_source_v2',{p_input:input})]);
    assert.ok(concurrent.every(result=>!result.error));assert.deepEqual(concurrent[0].data,concurrent[1].data);
    assert.equal(concurrent[0].data.rowVersion,3);
  }
  await query(`insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,submitted_to_user_id)
    values('${logIds[0]}','${project}','${date}','Auth lifecycle','72000000-0000-4000-8000-000000000003','submitted','member_contributions','${date}T12:00:00Z','72000000-0000-4000-8000-000000000004'),
      ('${logIds[1]}','${project}','${date}','Other pending','72000000-0000-4000-8000-000000000003','draft','member_contributions','${date}T12:00:00Z',null);
    insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status)
      select case c.id when '${sourceIds[0]}' then '${cardIds[0]}' else '${cardIds[1]}' end::uuid,'${logIds[0]}',c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'ready'
      from public.daily_log_contributions c where c.id in('${sourceIds[0]}','${sourceIds[1]}');
    insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status)
      select '${cardIds[2]}','${logIds[1]}',c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'ready' from public.daily_log_contributions c where c.id='${sourceIds[0]}';
    select app_private.create_daily_log_assignment('${logIds[0]}','72000000-0000-4000-8000-000000000003');`,false);
  const bBefore=await bundle(sourceIds[1]);
  const otherBefore=await query(`select to_jsonb(s) card from public.daily_log_summary_sources s where id='${cardIds[2]}'`);
  const returnInput={commandId:command(),dailyLogId:logIds[0],summarySourceId:cardIds[0],contributionId:sourceIds[0],
    expectedSummaryUpdatedAt:`${date}T12:00:00Z`,expectedRowVersion:3,reason:'Auth: bổ sung khối lượng'};
  assert.equal((await reader.rpc('return_daily_log_source_v2',{p_input:{...returnInput,commandId:command()}})).error.message,'DAILY_LOG_SOURCE_RETURN_DENIED');
  assert.equal((await otherAuthor.rpc('submit_daily_log_source_v2',{p_input:{commandId:command(),contributionId:sourceIds[0],expectedRowVersion:3}})).error.message,'DAILY_LOG_SOURCE_SUBMIT_DENIED');
  const race=await Promise.all([cht.rpc('return_daily_log_source_v2',{p_input:returnInput}),cht.rpc('return_daily_log_source_v2',{p_input:{...returnInput,commandId:command()}})]);
  assert.equal(race.filter(r=>!r.error).length,1);assert.equal(race.filter(r=>r.error).length,1);
  const rejected=race.find(r=>r.error);assert.equal(rejected.status,409);assert.equal(rejected.error.code,'PT409');
  const winner=race.find(r=>!r.error).data;assert.equal(winner.rowVersion,4);
  const winnerInput=race[0].error ? {...returnInput,commandId:commandIds.at(-1)} : returnInput;
  assert.deepEqual(await rpc(cht,'return_daily_log_source_v2',{p_input:winnerInput}),winner);
  assert.deepEqual((await bundle(sourceIds[1])).contribution,bBefore.contribution,'A return changed B');
  assert.deepEqual(await query(`select to_jsonb(s) card from public.daily_log_summary_sources s where id='${cardIds[2]}'`),otherBefore);
  const corrected=await rpc(author,'save_daily_log_source_document_v2',{p_input:{...payloads[0],expectedRowVersion:4,content:'Auth: đã sửa'}});
  assert.equal(corrected.rowVersion,5);
  const resubmit={commandId:command(),contributionId:sourceIds[0],expectedRowVersion:5};
  assert.equal((await rpc(author,'submit_daily_log_source_v2',{p_input:resubmit})).rowVersion,6);
  const audit=await query(`select status,review_comment,source_version from public.daily_log_summary_sources s
    join public.daily_logs l on l.id=s.daily_log_id where s.id='${cardIds[0]}'`);
  assert.equal(audit[0].status,'rejected');assert.equal(audit[0].review_comment,returnInput.reason);assert.equal(audit[0].source_version,3);
  await rpc(summarizer,'return_daily_log_source_v2',{p_input:{commandId:command(),dailyLogId:logIds[0],summarySourceId:cardIds[1],
    contributionId:sourceIds[1],expectedSummaryUpdatedAt:winner.summaryUpdatedAt,expectedRowVersion:3,reason:'Auth summarizer correction'}});
  const after=await counts();assert.equal(after[0].progress,before[0].progress);assert.equal(after[0].transactions,before[0].transactions);
  assert.equal((await query(`select count(*) n from app_private.daily_log_source_command_receipts where receipt->>'contributionId'='${sourceIds[0]}' and operation='return'`))[0].n,1);
  console.log(JSON.stringify({ref,persona:'5 EMPLOYEE accounts / anon key + real Auth',result:'PASS',submitRetry:'one receipt/version',
    returnConcurrency:'one return + HTTP409',areaIsolation:'B unchanged when A returned',resubmitVersion:6,reviewHistory:'preserved',officialOrFinancialWrites:0}));
} finally {
  // Delete only artifacts created by this run, with exact IDs and fixture scope.
  if(sourceIds.length || createdTask) await query(`
    delete from public.app_assignment_events where assignment_id in(select id from public.app_assignments where subject_type='daily_log' and subject_id in('${logIds.join("','")}'));
    delete from public.app_assignments where subject_type='daily_log' and subject_id in('${logIds.join("','")}');
    delete from public.daily_logs where id in('${logIds.join("','")}') and project_id='${project}' and date='${date}';
    ${sourceIds.length ? `delete from public.daily_log_contributions where id in('${sourceIds.join("','")}') and project_id='${project}' and date='${date}';` : ''}
    ${commandIds.length ? `delete from app_private.daily_log_source_command_receipts where command_id in('${commandIds.join("','")}') and project_id='${project}' and log_date='${date}';` : ''}
    ${createdTask ? `delete from public.project_tasks where id='${task}' and project_id='${project}';` : ''}`,false);
  await Promise.all(actors.map(actor=>actor.auth.signOut({scope:'local'})));
  assert.deepEqual(await counts(),before,'test fixture cleanup did not restore counts');
  console.log(JSON.stringify({cleanup:'only this run’s named fixtures removed',retainedFixtures:0}));
}
