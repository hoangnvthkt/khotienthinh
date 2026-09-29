import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { branchConfig, query, ref } from './cloud.mjs';

const config=branchConfig();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(30000)})}};
const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options);
const project='DL-WBS-PILOT-20260925',date='2099-08-04',run=crypto.randomUUID();
const logId=`__DL_UX6_SUMMARY_${run}`, tasks=[1,2,3].map(n=>`__DL_UX6_TASK_${run}_${n}`);
const sources=[],commands=[],actors=[],payloads=[];
const command=()=>{const id=crypto.randomUUID();commands.push(id);return id;};
const camel=value=>Array.isArray(value)?value.map(camel):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),camel(item)])):value;
const rpc=async(actor,name,input)=>{const result=await actor.rpc(name,input);assert.equal(result.error,null,`${name}: ${result.error?.code} ${result.error?.message}`);return name==='get_daily_log_wbs_bundle_v1'?camel(result.data):result.data;};
const login=async authId=>{
  const identity=await admin.auth.admin.getUserById(authId);assert.equal(identity.error,null);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user.email});assert.equal(link.error,null);
  const actor=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);
  const signed=await actor.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});assert.equal(signed.error,null);
  actors.push(actor);assert.equal(await rpc(actor,'is_admin'),false);return actor;
};
const counts=()=>query(`select (select count(*) from public.daily_logs) logs,(select count(*) from public.daily_log_contributions) sources,
  (select count(*) from public.project_daily_task_progress) progress,(select count(*) from public.project_transactions) transactions`);
const before=await counts();
try {
  const [author,sum,cht]=await Promise.all(['f30d5711-1a9d-47b2-a536-9424cc66b822','55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8','195531b5-e124-41bb-8648-e7acb106971a'].map(login));
  await query(`insert into public.project_tasks(id,project_id,name,wbs_code,start_date,end_date,fallback_unit,provisional_quantity) values
    ('${tasks[0]}','${project}','UX6 shared scope','UX6.1','${date}','2099-08-30',null,0),
    ('${tasks[1]}','${project}','UX6 A physical work','UX6.2','${date}','2099-08-30','m³',100),
    ('${tasks[2]}','${project}','UX6 excluded work','UX6.3','${date}','2099-08-30','m²',100)`,false);
  const get=actor=>rpc(actor,'get_daily_log_wbs_bundle_v1',{p_project_id:project,p_construction_site_id:null,p_log_date:date,p_daily_log_id:logId});
  for(const [index,area] of ['A','B','C'].entries()) {
    const created=await rpc(author,'create_daily_log_source_v2',{p_command_id:command(),p_project_id:project,p_construction_site_id:null,p_log_date:date,p_work_area_code:`UX6-${run}-${area}`,p_work_area_name:`UX6 Khu ${area}`});
    sources.push(created.contributionId);
    const loaded=await rpc(author,'get_daily_log_document_bundle_v2',{p_project_id:project,p_construction_site_id:null,p_log_date:date,p_daily_log_id:null,p_contribution_id:created.contributionId});
    const items=area==='A'?[{clientKey:'shared',taskId:tasks[0],entryMode:'percent',enteredValue:30},{clientKey:'physical',taskId:tasks[1],entryMode:'daily_quantity',enteredValue:12}]
      :area==='B'?[{clientKey:'shared',taskId:tasks[0],entryMode:'percent',enteredValue:30}]:[{clientKey:'excluded',taskId:tasks[2],entryMode:'daily_quantity',enteredValue:5}];
    const payload={contributionId:created.contributionId,expectedRowVersion:1,workAreaCode:`UX6-${run}-${area}`,workAreaName:`UX6 Khu ${area}`,content:`UX6 ${area}`,issues:area==='A'?'Lối vào hẹp':'',photos:[],
      items:items.map(item=>({...item,baselineFingerprint:loaded.baselineQuantityFingerprints[item.taskId],forecastFinishDate:'2099-08-30'})),
      labor:area==='A'?[{workItemClientKey:'shared',laborType:'Tổ móng',peopleCount:5,hoursPerPerson:8,provider:{entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Tổ A'}},
        {workItemClientKey:'physical',laborType:'Tổ tường',peopleCount:2,hoursPerPerson:8,provider:{entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Tổ tường A'}}]:[],
      machines:area==='B'?[{workItemClientKey:'shared',machineType:'Máy trộn',machineCount:2,hoursPerMachine:6,provider:{entryMode:'manual',manualProviderType:'machine_owner',manualProviderName:'Chủ máy B'}}]:[]};
    payloads.push(payload);
    await rpc(author,'save_daily_log_source_document_v2',{p_input:payload});
    await rpc(author,'submit_daily_log_source_v2',{p_input:{commandId:command(),contributionId:created.contributionId,expectedRowVersion:2}});
  }
  await query(`insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,description)
    values('${logId}','${project}','${date}','UX6 summarizer','72000000-0000-4000-8000-000000000003','draft','member_contributions','${date}T12:00:00Z','UX6 daily summary')`,false);
  const excludedBefore=await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sources[2]}'`);
  let bundle=await get(sum);
  const build=(bundle,refresh=false)=>{
    const originals=bundle.workItems.filter(item=>sources.slice(0,2).includes(item.contributionId)&&!item.dailyLogId);
    const key=item=>`summary-${item.id}`;
    const input={p_daily_log_id:logId,p_expected_updated_at:bundle.summaryLog.lastActionAt||bundle.summaryLog.createdAt,
      p_sources:sources.slice(0,2).map(id=>{const c=bundle.contributionsForSummary.find(source=>source.id===id);return{contributionId:id,sourceVersion:c.rowVersion,sourceFingerprint:c.sourceFingerprint,refreshSource:refresh,includedText:true,includedPhotos:[]};}),
      p_items:originals.map(item=>({clientKey:key(item),contributionId:item.contributionId,sourceWorkItemId:item.id,taskId:item.taskId,cumulativeProgressPercent:item.cumulativeProgressPercent,cumulativeQuantityDone:item.cumulativeQuantityDone,dailyQuantityDone:item.dailyQuantityDone,forecastFinishDate:item.forecastFinishDate})),
      p_decisions:[{taskId:tasks[0],officialCumulativePercent:null,officialCumulativeQuantity:null,officialDailyQuantity:null,aggregationMethod:'manual_override',dailyQuantityMethod:'manual_override',resolutionReason:'',pending:true,includedSourceWorkItemIds:originals.filter(item=>item.taskId===tasks[0]).map(item=>item.id)},
        {taskId:tasks[1],officialCumulativePercent:12,officialCumulativeQuantity:12,officialDailyQuantity:12,aggregationMethod:'single_source',dailyQuantityMethod:'sum_non_overlapping',includedSourceWorkItemIds:originals.filter(item=>item.taskId===tasks[1]).map(item=>item.id)}],
      p_labor:bundle.labor.filter(line=>sources.slice(0,2).includes(line.contributionId)).map(line=>({workItemClientKey:`summary-${line.dailyLogWorkItemId}`,laborType:line.laborType,peopleCount:line.peopleCount,hoursPerPerson:line.hoursPerPerson,sourceLaborLineId:line.id,provider:{entryMode:'manual',manualProviderType:line.manualProviderType,manualProviderName:line.manualProviderName}})),
      p_machines:bundle.machines.filter(line=>sources.slice(0,2).includes(line.contributionId)).map(line=>({workItemClientKey:`summary-${line.dailyLogWorkItemId}`,machineType:line.machineType,machineCount:line.machineCount,hoursPerMachine:line.hoursPerMachine,sourceMachineLineId:line.id,provider:{entryMode:'manual',manualProviderType:line.manualProviderType,manualProviderName:line.manualProviderName}}))};return input;
  };
  const first=build(bundle);
  await rpc(sum,'save_daily_log_summary_work_v1',first); // RED: existing save rejects the pending decision.
  bundle=await get(sum);
  assert.equal(bundle.decisions.find(d=>d.taskId===tasks[0]).officialCumulativePercent,null);
  assert.equal(bundle.decisions.find(d=>d.taskId===tasks[0]).pending,true);
  assert.equal((await query(`select count(*)::int n from public.daily_log_wbs_decisions where daily_log_id='${logId}' and task_id='${tasks[0]}'`))[0].n,0,'pending decision leaked into official table');
  assert.deepEqual(await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sources[2]}'`),excludedBefore);
  const submit=()=>sum.rpc('submit_daily_log_summary_v1',{p_daily_log_id:logId,p_expected_updated_at:bundle.summaryLog.lastActionAt,p_approver_user_id:'72000000-0000-4000-8000-000000000004'});
  assert.equal((await submit()).error?.message,'SUMMARY_DECISION_INCOMPLETE');
  const adjusted=build(bundle);
  const adjustedIndex=adjusted.p_items.findIndex(item=>item.contributionId===sources[0]&&item.taskId===tasks[0]);
  const adjustedWorkId=adjusted.p_items[adjustedIndex].sourceWorkItemId;
  adjusted.p_sources[0]={...adjusted.p_sources[0],hasAdjustments:true,adjustmentReason:'Đã đối chiếu hiện trường'};
  adjusted.p_items[adjustedIndex]={...adjusted.p_items[adjustedIndex],cumulativeProgressPercent:35};
  await rpc(sum,'save_daily_log_summary_work_v1',adjusted);
  bundle=await get(sum);
  assert.equal(bundle.workItems.find(item=>item.dailyLogId===logId&&item.sourceWorkItemId===adjustedWorkId).cumulativeProgressPercent,35);
  const card=bundle.summarySources.find(s=>s.contributionId===sources[0]);
  assert.equal(card.sourceSnapshot.content,'UX6 A','copy metadata must be version-qualified, not read from a newer source');
  const returned=await rpc(sum,'return_daily_log_source_v2',{p_input:{commandId:command(),dailyLogId:logId,summarySourceId:card.id,contributionId:sources[0],expectedSummaryUpdatedAt:bundle.summaryLog.lastActionAt,expectedRowVersion:3,reason:'Bổ sung ảnh móng'}});
  await rpc(author,'save_daily_log_source_document_v2',{p_input:{...payloads[0],content:'UX6 corrected A',expectedRowVersion:returned.rowVersion,items:payloads[0].items.map((item,i)=>i===0?{...item,enteredValue:32}:item)}});
  await rpc(author,'submit_daily_log_source_v2',{p_input:{commandId:command(),contributionId:sources[0],expectedRowVersion:5}});
  bundle=await get(sum);
  const kept=build(bundle);
  kept.p_sources[0]={...kept.p_sources[0],hasAdjustments:true,adjustmentReason:'Đã đối chiếu hiện trường'};
  const keptIndex=kept.p_items.findIndex(item=>item.sourceWorkItemId===adjustedWorkId);
  kept.p_items[keptIndex]={...kept.p_items[keptIndex],cumulativeProgressPercent:35};
  await rpc(sum,'save_daily_log_summary_work_v1',kept);
  bundle=await get(sum);
  const keptCard=bundle.summarySources.find(s=>s.contributionId===sources[0]);
  assert.equal(keptCard.sourceVersion,3);assert.equal(keptCard.sourceFingerprint,card.sourceFingerprint);assert.equal(keptCard.sourceState,'changed');
  assert.equal(keptCard.sourceSnapshot.content,'UX6 A');
  assert.equal(bundle.workItems.find(item=>item.dailyLogId===logId&&item.sourceWorkItemId===adjustedWorkId).cumulativeProgressPercent,35);
  const refreshed=build(bundle,true);
  await rpc(sum,'save_daily_log_summary_work_v1',refreshed);bundle=await get(sum);
  assert.equal(bundle.workItems.find(item=>item.dailyLogId===logId&&item.sourceWorkItemId===adjustedWorkId).cumulativeProgressPercent,32);
  assert.equal(bundle.summarySources.find(s=>s.contributionId===sources[0]).reviewStatus,'ready');
  assert.equal(bundle.summarySources.find(s=>s.contributionId===sources[0]).sourceSnapshot.content,'UX6 corrected A');
  const resolved=build(bundle);
  resolved.p_decisions[0]={...resolved.p_decisions[0],officialCumulativePercent:32,pending:false,resolutionReason:'Cùng WBS toàn phạm vi, chốt 32% sau đối chiếu'};
  await rpc(sum,'save_daily_log_summary_work_v1',resolved);bundle=await get(sum);
  await rpc(sum,'submit_daily_log_summary_v1',{p_daily_log_id:logId,p_expected_updated_at:bundle.summaryLog.lastActionAt,p_approver_user_id:'72000000-0000-4000-8000-000000000004'});
  bundle=await get(cht);
  const publication=await rpc(cht,'publish_daily_log_summary_v1',{p_command_id:crypto.randomUUID(),p_daily_log_id:logId,p_expected_updated_at:bundle.summaryLog.lastActionAt});
  assert.equal(publication.publishedProgress,false);
  const after=await counts();assert.equal(after[0].progress,before[0].progress);assert.equal(after[0].transactions,before[0].transactions);
  console.log(JSON.stringify({ref,result:'PASS',persona:'three non-admin Auth accounts',selected:2,excludedUnchanged:true,pendingOfficialRows:0,adjustedSnapshot:'kept until explicit refresh',pilot:'shadow only'}));
} finally {
  await query(`delete from public.app_assignment_events where assignment_id in(select id from public.app_assignments where subject_type='daily_log' and subject_id='${logId}');
    delete from public.app_assignments where subject_type='daily_log' and subject_id='${logId}';
    delete from app_private.daily_log_shadow_comparisons where daily_log_id='${logId}' and project_id='${project}';
    delete from public.daily_logs where id='${logId}' and project_id='${project}' and date='${date}';
    ${commands.length?`delete from app_private.daily_log_source_command_receipts where command_id in('${commands.join("','")}') and project_id='${project}' and log_date='${date}';`:''}
    ${sources.length?`delete from public.daily_log_contributions where id in('${sources.join("','")}') and project_id='${project}' and date='${date}';`:''}
    delete from public.project_tasks where id in('${tasks.join("','")}') and project_id='${project}';`,false);
  await Promise.all(actors.map(actor=>actor.auth.signOut({scope:'local'})));
  assert.deepEqual(await counts(),before,'owned fixtures did not restore baseline counts');
  console.log(JSON.stringify({cleanup:'only this run’s exact fixtures removed',retainedFixtures:0}));
}
