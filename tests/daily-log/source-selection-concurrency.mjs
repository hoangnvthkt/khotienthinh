import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { branchConfig, query, ref } from './cloud.mjs';

const config=branchConfig();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options);
const actorId='72000000-0000-4000-8000-000000000001';
const authId='f30d5711-1a9d-47b2-a536-9424cc66b822';
const {data:profile,error:profileError}=await admin.from('users').select('id,auth_id,role').eq('id',actorId).single();
assert.equal(profileError,null);
assert.equal(profile.auth_id,authId);
assert.equal(profile.role,'EMPLOYEE');
const {data:identity,error:identityError}=await admin.auth.admin.getUserById(authId);
assert.equal(identityError,null);
assert.equal(identity.user.email,'dl-wbs-author_a-20260925@example.invalid');
const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:identity.user.email});
assert.equal(linkError,null);
const actor=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);
const {data:login,error:loginError}=await actor.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'});
assert.equal(loginError,null);
assert.equal(login.user.id,authId);
try {
  const {data:isAdmin,error:adminCheckError}=await actor.rpc('is_admin');
  assert.equal(adminCheckError,null);
  assert.equal(isAdmin,false);
  const counts=()=>query(`select (select count(*) from public.daily_logs) logs,
    (select count(*) from public.daily_log_labor) labor,(select count(*) from public.daily_log_machines) machines,
    (select count(*) from public.project_daily_task_progress) progress,(select count(*) from public.project_transactions) transactions`);
  const before=await counts();
  const runId=randomUUID().slice(0,8).toUpperCase();
  const params={p_project_id:'DL-WBS-PILOT-20260925',p_construction_site_id:null,p_log_date:'2099-02-02',
    p_work_area_code:`UX-RETRY-${runId}`,p_work_area_name:`Concurrency retry ${runId}`,p_command_id:randomUUID()};
  const retry=await Promise.all([actor.rpc('create_daily_log_source_v2',params),actor.rpc('create_daily_log_source_v2',params)]);
  assert.equal(retry[0].error,null);
  assert.equal(retry[1].error,null);
  assert.deepEqual(retry[0].data,retry[1].data);
  const area={...params,p_work_area_code:`UX-AREA-${runId}`,p_work_area_name:`Concurrency area ${runId}`};
  const race=await Promise.all([actor.rpc('create_daily_log_source_v2',{...area,p_command_id:randomUUID()}),
    actor.rpc('create_daily_log_source_v2',{...area,p_command_id:randomUUID()})]);
  const success=race.filter(result=>!result.error), conflict=race.filter(result=>result.error);
  assert.equal(success.length,1);
  assert.equal(conflict.length,1);
  assert.equal(conflict[0].error.code,'23505');
  assert.equal(conflict[0].error.message,'DAILY_LOG_SOURCE_AREA_EXISTS');
  assert.equal(JSON.parse(conflict[0].error.details).contributionId,success[0].data.contributionId);
  const ids=[retry[0].data.contributionId,success[0].data.contributionId];
  const persisted=await query(`select id,status,source_document_version from public.daily_log_contributions
    where id in ('${ids[0]}'::uuid,'${ids[1]}'::uuid) order by id`);
  assert.equal(persisted.length,2);
  assert.ok(persisted.every(row=>row.status==='draft' && row.source_document_version===2));
  assert.deepEqual(await counts(),before);
  const receipts=await query(`select count(*)::int count from app_private.daily_log_source_command_receipts
    where receipt->>'contributionId' in ('${ids[0]}','${ids[1]}')`);
  assert.equal(receipts[0].count,2);
  console.log(JSON.stringify({ref,persona:'non-admin EMPLOYEE / anon client + Auth session',result:'PASS',
    sameCommand:'identical receipts',sameArea:'one source + conflict with existing ID',retainedDraftIds:ids,
    financialOrProgressOrResourceWrites:0}));
} finally {
  // Only our test session, never the user's existing sessions or passwords.
  await actor.auth.signOut({scope:'local'});
}
