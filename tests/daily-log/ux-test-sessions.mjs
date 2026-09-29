import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {branchConfig,query,ref} from './cloud.mjs';
export {query};
const base='DL-WBS-PILOT-20260925';
const personas={
  authorA:['72000000-0000-4000-8000-000000000001','f30d5711-1a9d-47b2-a536-9424cc66b822'],
  authorB:['72000000-0000-4000-8000-000000000002','9d5a2f91-a8cb-4319-9188-3cad28fe4b48'],
  summarizer:['72000000-0000-4000-8000-000000000003','55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8'],
  cht:['72000000-0000-4000-8000-000000000004','195531b5-e124-41bb-8648-e7acb106971a'],
  reader:['72000000-0000-4000-8000-000000000005','89441ea9-ec40-46f3-b8ef-b647e6ede9b8'],
  denied:['72000000-0000-4000-8000-000000000006','47af03e4-4aa8-43b8-8b9f-540ca9099be1'],
};
export async function rpc(client,name,input={}) {
  const result=await client.rpc(name,input);
  assert.equal(result.error,null,`${name}: ${result.error?.code} ${result.error?.message}`);
  return result.data;
}
export async function createUxFixture() {
  let config;
  try {config=branchConfig();} // Guard exact authorized Cloud; no local/Docker.
  catch {throw new Error('Unable to resolve authorized test Cloud configuration; diagnostic output suppressed');}
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options),actors={};
  const project=`__DL_UX8_${crypto.randomUUID()}`,date='2099-08-07',log=`${project}_LOG`,task=`${project}_TASK`;
  const taskName='Đổ bê tông móng khu nhà xưởng và tuyến hạ tầng phía Đông — hạng mục có tên dài để kiểm tra đọc hiểu';
  const longReason='Đo lại khối lượng móng khu A, đối chiếu với bản vẽ và bổ sung nhân công thực tế; chỉ sửa phiếu khu A. Giữ nguyên phiếu khu B và khu C để bảo toàn trách nhiệm của từng kỹ sư.';
  const pilotBefore=await query(`select to_jsonb(s) snapshot from app_private.daily_log_wbs_rollout_scopes s where project_id='${base}'`);
  const bindingBefore=await query(`select to_jsonb(b) snapshot from app_private.project_permission_room_action_bindings b where room_code='payment' and action_code='view_resource_evidence'`);
  const cleanup=async()=>{
    // Exact UUID disposable project only; no persisted operator scope/history.
    await query(`delete from public.notifications where metadata->>'projectId'='${project}' and metadata->>'logId'='${log}' and source_id like 'dailylog_rejected_%';
      delete from public.notifications where metadata->>'projectId'='${project}' and metadata->>'deliveredBy'='daily_log_trigger';
      delete from public.app_assignment_events where assignment_id in(select id from public.app_assignments where scope_id='${project}' and subject_type='daily_log');
      delete from public.app_assignments where scope_id='${project}' and subject_type='daily_log';
      delete from public.daily_log_publish_commands where daily_log_id in(select id from public.daily_logs where project_id='${project}');
      delete from public.project_daily_task_progress where project_id='${project}';delete from public.weekly_progress_snapshots where project_id='${project}';delete from public.project_progress_period_states where project_id='${project}';
      delete from app_private.daily_log_shadow_comparisons where daily_log_id in(select id from public.daily_logs where project_id='${project}');
      delete from public.daily_progress_exception_audit where source_daily_log_id in(select id from public.daily_logs where project_id='${project}');
      delete from public.daily_log_contributions where project_id='${project}';delete from public.daily_logs where project_id='${project}';
      delete from app_private.daily_log_source_command_receipts where project_id='${project}';
      delete from app_private.daily_log_wbs_rollout_scopes where project_id='${project}';delete from public.project_tasks where project_id='${project}';delete from public.project_staff where project_id='${project}';
      delete from public.user_permission_grants where scope_type='project' and scope_id='${project}' and permission_code='project.daily_log.view';
      delete from public.projects where id='${project}' and name='Disposable Daily Log UX acceptance'`,false);
    const counts=await query(`select (select count(*) from public.projects where id='${project}')::int projects,
      (select count(*) from public.daily_logs where project_id='${project}')::int logs,
      (select count(*) from public.daily_log_contributions where project_id='${project}')::int sources,
      (select count(*) from app_private.daily_log_source_command_receipts where project_id='${project}')::int receipts,
      (select count(*) from public.user_permission_grants where scope_type='project' and scope_id='${project}')::int grants,
      (select count(*) from public.notifications where metadata->>'projectId'='${project}')::int notifications`);
    assert.deepEqual(counts,[{projects:0,logs:0,sources:0,receipts:0,grants:0,notifications:0}]);
    assert.deepEqual(await query(`select to_jsonb(s) snapshot from app_private.daily_log_wbs_rollout_scopes s where project_id='${base}'`),pilotBefore);
    assert.deepEqual(await query(`select to_jsonb(b) snapshot from app_private.project_permission_room_action_bindings b where room_code='payment' and action_code='view_resource_evidence'`),bindingBefore);
    await Promise.all(Object.values(actors).map(actor=>actor.client.auth.signOut({scope:'local'})));
  };
  try {
    for(const [key,[profile,authId]] of Object.entries(personas)) {
      const identity=await admin.auth.admin.getUserById(authId);assert.equal(identity.error,null);
      const link=await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user.email});assert.equal(link.error,null);
      const client=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);
      const signed=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});assert.equal(signed.error,null);
      assert.equal(await rpc(client,'is_admin'),false);actors[key]={client,session:signed.data.session,profile};
    }
    const cht=actors.cht.profile,ids=Object.values(actors).map(actor=>`'${actor.profile}'`).join(',');
    await query(`insert into public.projects(id,code,name,project_type,status) values('${project}','${project}','Disposable Daily Log UX acceptance','construction','active');
      insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,is_active,granted_by,grant_reason,expires_at)
      select actor.id,'project.daily_log.view','project','${project}',true,'${cht}','Disposable ERP entry only; Room still controls actions',now()+interval '1 hour'
      from public.users actor where actor.id in(${ids});
      insert into public.project_staff(id,project_id,user_id,position_id,start_date)
      select gen_random_uuid(),'${project}',user_id,position_id,current_date from public.project_staff where project_id='${base}' and construction_site_id is null and end_date is null and user_id in(${ids});
      insert into public.project_permission_room_members(id,project_id,room_code,project_staff_id,is_active,created_by)
      select gen_random_uuid(),'${project}',om.room_code,ns.id,true,'${cht}' from public.project_staff ns
      join public.project_staff os on os.user_id=ns.user_id and os.project_id='${base}' and os.end_date is null
      join public.project_permission_room_members om on om.project_staff_id=os.id and om.is_active
      where ns.project_id='${project}' and ns.user_id<>'${actors.denied.profile}'
        and (om.room_code='daily_log' or om.room_code='payment' and ns.user_id='${actors.reader.profile}');
      insert into public.project_permission_room_member_actions(room_member_id,action_code,is_active,granted_by,grant_source)
      select m.id,a.action_code,true,'${cht}','manual_room' from public.project_permission_room_members m
      join public.project_staff ns on ns.id=m.project_staff_id join public.project_staff os on os.user_id=ns.user_id and os.project_id='${base}' and os.end_date is null
      join public.project_permission_room_members om on om.project_staff_id=os.id and om.room_code=m.room_code and om.is_active
      join public.project_permission_room_member_actions a on a.room_member_id=om.id and a.is_active
      where m.project_id='${project}' and (m.room_code='daily_log' or a.action_code='view_resource_evidence');
      -- The old QS evidence membership is deliberately inactive. A temporary
      -- exact-project read-only grant is required for this acceptance persona;
      -- never activate its old membership or change the global action binding.
      insert into public.project_permission_room_members(id,project_id,room_code,project_staff_id,is_active,created_by)
      select gen_random_uuid(),'${project}','payment',s.id,true,'${cht}' from public.project_staff s
      where s.project_id='${project}' and s.user_id='${actors.reader.profile}'
        and not exists(select 1 from public.project_permission_room_members m where m.project_staff_id=s.id and m.room_code='payment');
      insert into public.project_permission_room_member_actions(room_member_id,action_code,is_active,granted_by,grant_source)
      select m.id,'view_resource_evidence',true,'${cht}','manual_room' from public.project_permission_room_members m
      join public.project_staff s on s.id=m.project_staff_id where m.project_id='${project}' and m.room_code='payment' and s.user_id='${actors.reader.profile}'
      on conflict(room_member_id,action_code) do nothing;
      insert into app_private.daily_log_wbs_rollout_scopes(project_id,mode,cutover_date,release_id,owner_user_id,reason,created_by)
      values('${project}','pilot','2026-09-25','${project}_RELEASE','${cht}','Disposable UX acceptance only','${cht}');
      insert into public.project_tasks(id,project_id,name,wbs_code,start_date,end_date,fallback_unit,provisional_quantity)
      values('${task}','${project}','${taskName}','UX8','${date}','2099-08-30','m³',100);
      insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,description)
      values('${log}','${project}','${date}','DL TEST Người tổng hợp','${actors.summarizer.profile}','draft','member_contributions','${date}T12:00:00Z','Bản tổng hợp nghiệm thu UX')`,false);
    return {project,date,log,task,taskName,longReason,actors,cleanup};
  } catch(error) {await cleanup();throw error;}
}
export async function openUxPage(browser,f,role,report=false) {
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${ref}-auth-token`,session:f.actors[role].session});
  await page.goto(`/#/da?projectId=${f.project}&tab=dailylog${report?`&dailyLogId=${f.log}`:''}`);
  if(role==='denied') return page;
  try {
    if(report) await page.getByRole('heading',{name:'Bản tổng hợp thi công ngày',exact:true}).waitFor({timeout:45000});
    else await page.getByText('07/08/2099',{exact:false}).first().waitFor({timeout:45000});
  } catch(error) {await context.close();throw error;}
  return page;
}
export async function captureUxLayouts(page,state,selector) {
  const node=page.locator(selector);
  // Toggle the existing app theme class within the live DOM, without remounting
  // or losing unsaved work. This validates scoped styling, not theme persistence.
  for(const theme of ['light','dark']) {
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
    for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[360,800]]) {
      await page.setViewportSize({width,height});
      await node.evaluate(element=>{let p=element.parentElement;while(p){if(p.scrollHeight>p.clientHeight)p.scrollTop=0;p=p.parentElement;}});
      // Finish finite theme transitions before measuring final colors.
      await page.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/ux8-${state}-${theme}-${width}.png`,animations:'disabled'});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${state}/${theme}/${width}: body overflow`);
      if(width===1440) {
        const treatment=await node.evaluate(element=>{
          const header=element.querySelector('.daily-log-document-header');
          const buttons=[...header.querySelectorAll('button')].map(button=>{
            const style=getComputedStyle(button);
            return {label:button.textContent.trim(),disabled:button.disabled,color:style.color,bg:style.backgroundColor,shadow:style.boxShadow};
          });
          return {shadow:getComputedStyle(header).boxShadow,buttons};
        });
        assert.notEqual(treatment.shadow,'none',`${state}/${theme}: document header needs subtle elevation`);
        for(const button of treatment.buttons) {
          if(/Gửi|Thử gửi|Đối chiếu/.test(button.label)) {
            const [r,g,b]=button.bg.match(/[\d.]+/g).slice(0,3).map(Number);
            assert.ok(b>g && b>r,`${button.label}: sending/testing must be blue, not approval green`);
          }
          if(button.label==='Duyệt & công bố') {
            const [r,g,b]=button.bg.match(/[\d.]+/g).slice(0,3).map(Number);
            assert.ok(g>r && g>b,`${button.label}: approval must be emerald`);
          }
        }
        const ratios=await node.evaluate(element=>{
          const rgb=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
          const luminance=color=>rgb(color).map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
          const ratio=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);};
          const header=element.querySelector('.daily-log-document-header'),style=getComputedStyle(header),bg=style.backgroundColor;
          return {title:ratio(getComputedStyle(header.querySelector('h2')).color,bg),metadata:ratio(getComputedStyle(header.querySelector('dt')).color,bg),
            status:ratio(getComputedStyle(header.querySelector('[role="status"]')).color,getComputedStyle(header.querySelector('[role="status"]')).backgroundColor),
            ...Object.fromEntries([...header.querySelectorAll('button:not(:disabled)')].map(button=>{const s=getComputedStyle(button);return [button.textContent.trim(),ratio(s.color,s.backgroundColor)];}))};
        });
        for(const [label,ratio] of Object.entries(ratios)) assert.ok(ratio>=4.5,`${state}/${theme}/${label}: contrast ${ratio}`);
        console.log(JSON.stringify({state,theme,contrast:ratios}));
      }
    }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  // The existing global reduced-motion rule uses !important 0.01ms, not 0s.
  // Wait for the browser media/style update; no arbitrary delay or global edit.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
  const durations=await node.locator('.daily-log-document-button').first().evaluate(button=>getComputedStyle(button).transitionDuration.split(',').map(value=>parseFloat(value)));
  assert.ok(durations.every(duration=>duration<=0.00001),`${state}: reduced motion must be immediate; got ${durations}`);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  await page.setViewportSize({width:1440,height:900});
}
