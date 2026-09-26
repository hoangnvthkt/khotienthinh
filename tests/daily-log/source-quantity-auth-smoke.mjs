import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { branchConfig, query, ref } from './cloud.mjs';

const config=branchConfig();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,init) => {
  const path=new URL(url).pathname;
  console.log(JSON.stringify({phase:'request',path}));
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});
  console.log(JSON.stringify({phase:'response',path,status:response.status}));
  return response;
}}};
const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options);
const actor=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);
const authId='f30d5711-1a9d-47b2-a536-9424cc66b822';
const {data:identity,error:identityError}=await admin.auth.admin.getUserById(authId);
assert.equal(identityError,null);
const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:identity.user.email});
assert.equal(linkError,null);
const {error:loginError}=await actor.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'});
assert.equal(loginError,null);
const rpc=async(name,input)=>{
  const result=await actor.rpc(name,input);
  assert.equal(result.error,null,JSON.stringify(result.error));
  return result.data;
};
try {
  assert.equal(await rpc('is_admin'),false);
  const counts=()=>query(`select (select count(*) from public.daily_logs) logs,
    (select count(*) from public.project_daily_task_progress) progress,(select count(*) from public.project_transactions) transactions`);
  const before=await counts();
  const scope={p_project_id:'DL-WBS-PILOT-20260925',p_construction_site_id:null,p_log_date:'2099-02-02',p_daily_log_id:null};
  const ids=['4308aec9-8cfd-4378-af32-ee2e78e6397e','4fd1cca2-dc16-4e04-870a-73bdb0628ed5'];
  const a=await rpc('get_daily_log_document_bundle_v2',{...scope,p_contribution_id:ids[0]});
  const b=await rpc('get_daily_log_document_bundle_v2',{...scope,p_contribution_id:ids[1]});
  assert.equal(a.contribution.status,'draft'); assert.equal(b.contribution.status,'draft');
  const leaf=a.tasks.find(task=>!a.tasks.some(child=>child.parentId===task.id));
  assert.ok(leaf,'scoped pilot leaf missing');
  const provider={entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Tổ UX Auth'};
  const input={contributionId:ids[0],expectedRowVersion:a.contribution.row_version,
    workAreaCode:a.contribution.work_area_code,workAreaName:a.contribution.work_area_name,
    content:'UX Auth: nội dung đã sửa',issues:'UX Auth: không mất metadata',photos:[{name:'Ảnh UX Auth',url:'https://example.invalid/ux-auth.jpg'}],
    items:[{clientKey:'auth-work',taskId:leaf.id,entryMode:'percent',enteredValue:100,
      baselineFingerprint:a.baselineQuantityFingerprints[leaf.id]}],
    labor:[{workItemClientKey:'auth-work',laborType:'Tổ UX Auth',peopleCount:5,hoursPerPerson:8,provider}],
    machines:[{workItemClientKey:'auth-work',machineName:'Máy UX Auth',machineType:'Máy trộn',machineCount:2,hoursPerMachine:6,
      provider:{entryMode:'manual',manualProviderType:'machine_owner',manualProviderName:'Chủ máy UX Auth'}}]};
  const race=await Promise.all([actor.rpc('save_daily_log_source_document_v2',{p_input:input}),actor.rpc('save_daily_log_source_document_v2',{p_input:input})]);
  const success=race.filter(r=>!r.error),conflict=race.filter(r=>r.error);
  assert.equal(success.length,1); assert.equal(conflict.length,1);
  assert.equal(conflict[0].status,409); assert.equal(conflict[0].error.code,'PT409'); assert.equal(conflict[0].error.message,'ROW_VERSION_CONFLICT');
  const aAfter=await rpc('get_daily_log_document_bundle_v2',{...scope,p_contribution_id:ids[0]});
  const bAfter=await rpc('get_daily_log_document_bundle_v2',{...scope,p_contribution_id:ids[1]});
  assert.deepEqual(bAfter.contribution,b.contribution,'saving A changed B');
  assert.equal(aAfter.contribution.content,input.content); assert.equal(aAfter.contribution.issues,input.issues);
  assert.deepEqual(aAfter.contribution.photos,input.photos);
  assert.equal(aAfter.labor.length,1); assert.equal(aAfter.machines.length,1);
  assert.equal(Number(aAfter.labor[0].total_labor_hours),40); assert.equal(Number(aAfter.machines[0].total_machine_hours),12);
  const denied=await actor.rpc('save_daily_log_source_document_v2',{p_input:{...input,expectedRowVersion:success[0].data.rowVersion,price:123}});
  assert.equal(denied.error.message,'RESOURCE_PRICE_FIELDS_NOT_ALLOWED');
  assert.deepEqual((await rpc('get_daily_log_document_bundle_v2',{...scope,p_contribution_id:ids[0]})).contribution,aAfter.contribution);
  const savedB=await rpc('save_daily_log_source_document_v2',{p_input:{contributionId:ids[1],expectedRowVersion:b.contribution.row_version,
    workAreaCode:b.contribution.work_area_code,workAreaName:b.contribution.work_area_name,
    content:'UX Auth independent B',issues:'',photos:[],items:[],labor:[],machines:[]}});
  assert.equal(savedB.rowVersion,b.contribution.row_version+1);
  assert.deepEqual(await counts(),before,'draft save created official progress/log/finance');
  console.log(JSON.stringify({ref,persona:'EMPLOYEE / anon key + real Auth',result:'PASS',
    concurrency:'one atomic save + version conflict',areaIsolation:'A did not modify B',retainedDraftIds:ids,
    normalizedPhysicalRows:'A: labor40h + machines12h',officialProgressOrLogOrFinancialWrites:0}));
} finally { await actor.auth.signOut({scope:'local'}); }
