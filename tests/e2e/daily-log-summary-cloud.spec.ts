import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { branchConfig, query, ref } from '../daily-log/cloud.mjs';

test('real ERP summarizer selects two slips, saves pending draft and metadata without clearing physical copies',async({page})=>{
  test.setTimeout(180000);
  const config=branchConfig(),options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,options);
  const clients:any[]=[],sources:string[]=[],commands:string[]=[],payloads:any[]=[];
  const project='DL-WBS-PILOT-20260925',date='2099-08-05',run=crypto.randomUUID(),log=`__DL_UX6_BROWSER_${run}`,task=`__DL_UX6_BROWSER_TASK_${run}`;
  page.on('request',request=>{
    if(request.url().endsWith('/rpc/return_daily_log_source_v2')) {
      const input=request.postDataJSON()?.p_input;
      if(input?.dailyLogId===log && typeof input.commandId==='string') commands.push(input.commandId);
    }
  });
  const rpc=async(actor:any,name:string,input:any)=>{const result=await actor.rpc(name,input);expect(result.error,`${name}: ${result.error?.message}`).toBeNull();return result.data;};
  const login=async(authId:string)=>{
    const identity=await admin.auth.admin.getUserById(authId);expect(identity.error).toBeNull();
    const link=await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user!.email!});expect(link.error).toBeNull();
    const client=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,options);clients.push(client);
    const signed=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties!.hashed_token});expect(signed.error).toBeNull();expect((await client.rpc('is_admin')).data).toBe(false);
    return {client,session:signed.data.session};
  };
  const command=()=>{const id=crypto.randomUUID();commands.push(id);return id;};
  try {
    const author=await login('f30d5711-1a9d-47b2-a536-9424cc66b822'),sum=await login('55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8');
    await query(`insert into public.project_tasks(id,project_id,name,wbs_code,start_date,end_date,provisional_quantity) values('${task}','${project}','Móng UX6 browser','UX6B','${date}','2099-08-30',0)`,false);
    for (const area of ['A','B','C']) {
      const created=await rpc(author.client,'create_daily_log_source_v2',{p_command_id:command(),p_project_id:project,p_construction_site_id:null,p_log_date:date,p_work_area_code:`UX6B-${run}-${area}`,p_work_area_name:`UX6 browser Khu ${area}`});sources.push(created.contributionId);
      const bundle=await rpc(author.client,'get_daily_log_document_bundle_v2',{p_project_id:project,p_construction_site_id:null,p_log_date:date,p_daily_log_id:null,p_contribution_id:created.contributionId});
      const payload={contributionId:created.contributionId,expectedRowVersion:1,workAreaCode:`UX6B-${run}-${area}`,workAreaName:`UX6 browser Khu ${area}`,content:`UX6 browser ${area}`,issues:'Lối vào hẹp',photos:[],
        items:[{clientKey:'work',taskId:task,entryMode:'percent',enteredValue:30,baselineFingerprint:bundle.baselineQuantityFingerprints[task],forecastFinishDate:'2099-08-30'}],
        labor:area==='A'?[{workItemClientKey:'work',laborType:'Tổ móng A',peopleCount:5,hoursPerPerson:8,provider:{entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Tổ A thực tế'}}]:[],
        machines:area==='B'?[{workItemClientKey:'work',machineType:'Máy trộn B',machineCount:2,hoursPerMachine:6,provider:{entryMode:'manual',manualProviderType:'machine_owner',manualProviderName:'Chủ máy B'}}]:[]};
      payloads.push(payload);await rpc(author.client,'save_daily_log_source_document_v2',{p_input:payload});
      await rpc(author.client,'submit_daily_log_source_v2',{p_input:{commandId:command(),contributionId:created.contributionId,expectedRowVersion:2}});
    }
    await query(`insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,description)
      values('${log}','${project}','${date}','UX6 browser owner','72000000-0000-4000-8000-000000000003','draft','member_contributions','${date}T12:00:00Z','Bản tổng hợp kiểm thử')`,false);
    const excludedBefore=await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sources[2]}'`);
    await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${ref}-auth-token`,session:sum.session});
    await page.goto(`/#/da?projectId=${project}&tab=dailylog`);
    await expect(page.getByText('Nhật ký WBS — dữ liệu kiểm thử riêng').first()).toBeVisible({timeout:45000});
    const row=page.locator('div.group').filter({hasText:'05/08/2099'}).last();
    await row.getByRole('button',{name:'Tổng hợp',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Tổng hợp thi công ngày',exact:true})).toBeVisible();
    await page.getByLabel('Nội dung tổng hợp',{exact:true}).fill('Nội dung tổng hợp được lưu lần một');
    for(const area of ['A','B']) await page.getByRole('checkbox',{name:new RegExp(`UX6 browser Khu ${area}`)}).check();
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'Gửi CHT',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();
    await expect.poll(async()=>(await query(`select count(*)::int n from public.daily_log_summary_sources where daily_log_id='${log}'`))[0].n).toBe(2);
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    await page.getByLabel('Nội dung tổng hợp',{exact:true}).fill('Nội dung tổng hợp lần hai, giữ tài nguyên');
    await page.getByLabel('Kế hoạch ngày sau',{exact:true}).fill('Tiếp tục đổ móng khu A');
    const secondSave=page.waitForResponse(response=>response.url().endsWith('/rpc/save_daily_log_summary_work_v1'));
    await page.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();
    const secondSaveResponse=await secondSave;
    expect(secondSaveResponse.status()).toBe(200);
    expect(secondSaveResponse.request().postDataJSON().p_sources.map((source:any)=>source.summaryDocumentVersion)).toEqual([2,2]);
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    await expect.poll(async()=>(await query(`select description from public.daily_logs where id='${log}'`))[0].description).toBe('Nội dung tổng hợp lần hai, giữ tài nguyên');
    const resources=await query(`select (select count(*)::int from public.daily_log_labor where daily_log_id='${log}') labor,(select count(*)::int from public.daily_log_machines where daily_log_id='${log}') machines`);
    expect(resources[0]).toEqual({labor:1,machines:1});
    const lineage=await query(`select source_labor_line_id::text source from public.daily_log_labor where daily_log_id='${log}'`);
    expect(lineage[0].source).toBe((await query(`select id::text from public.daily_log_labor where contribution_id='${sources[0]}'`))[0].id);
    expect(await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sources[2]}'`)).toEqual(excludedBefore);
    expect((await query(`select count(*)::int n from public.daily_log_wbs_decisions where daily_log_id='${log}'`))[0].n).toBe(0);
    // Removal changes only summary selection; the engineer's source survives.
    const originalB=await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sources[1]}'`);
    let cardB=page.locator('[data-testid="daily-log-area-card"]').filter({has:page.getByRole('heading',{name:'UX6 browser Khu B',exact:true})});
    await cardB.locator('summary').filter({hasText:'Xem công việc, nguồn lực và ảnh'}).click();
    await cardB.getByRole('button',{name:'Bỏ khỏi bản tổng hợp',exact:true}).click();
    let saved=page.waitForResponse(response=>response.url().endsWith('/rpc/save_daily_log_summary_work_v1'));
    await page.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    expect((await query(`select count(*)::int n from public.daily_log_summary_sources where daily_log_id='${log}'`))[0].n).toBe(1);
    expect(await query(`select to_jsonb(c) snapshot from public.daily_log_contributions c where id='${sources[1]}'`)).toEqual(originalB);
    await page.locator('summary').filter({hasText:'Chọn phiếu để tổng hợp'}).click();
    await page.getByRole('checkbox',{name:/UX6 browser Khu B/}).check();
    saved=page.waitForResponse(response=>response.url().endsWith('/rpc/save_daily_log_summary_work_v1'));
    await page.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    let cardA=page.locator('[data-testid="daily-log-area-card"]').filter({has:page.getByRole('heading',{name:'UX6 browser Khu A',exact:true})});
    await cardA.locator('summary').filter({hasText:'Xem công việc, nguồn lực và ảnh'}).click();
    await cardA.locator('summary').filter({hasText:'Chỉnh số liệu trên bản sao'}).click();
    await cardA.getByLabel('Lý do chỉnh UX6 browser Khu A').fill('Đã đo kiểm tại móng');
    await cardA.getByLabel('% lũy kế UX6B',{exact:true}).fill('');
    await expect(cardA.getByLabel('% lũy kế UX6B',{exact:true})).toHaveValue('');
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeDisabled();
    await cardA.getByLabel('% lũy kế UX6B',{exact:true}).fill('35');
    saved=page.waitForResponse(response=>response.url().endsWith('/rpc/save_daily_log_summary_work_v1'));
    await page.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    expect(Number((await query(`select cumulative_progress_percent::numeric percent from public.daily_log_work_items where contribution_id='${sources[0]}'`))[0].percent)).toBe(30);
    const savedCard=(await query(`select source_version,source_fingerprint from public.daily_log_summary_sources where daily_log_id='${log}' and contribution_id='${sources[0]}'`))[0];
    await cardA.locator('summary').filter({hasText:'Xem công việc, nguồn lực và ảnh'}).click();
    await cardA.locator('summary').filter({hasText:'Trả phiếu cho kỹ sư'}).click();
    await cardA.getByLabel('Nhận xét UX6 browser Khu A').fill('Bổ sung ghi chú móng rõ hơn');
    const returned=page.waitForResponse(response=>response.url().endsWith('/rpc/return_daily_log_source_v2'));
    await cardA.getByRole('button',{name:'Trả phiếu cho kỹ sư',exact:true}).click();expect((await returned).status()).toBe(200);
    await expect(page.getByText('Bổ sung ghi chú móng rõ hơn').first()).toBeVisible();
    expect((await query(`select status from public.daily_log_contributions where id='${sources[1]}'`))[0].status).toBe('submitted');
    await rpc(author.client,'save_daily_log_source_document_v2',{p_input:{...payloads[0],expectedRowVersion:4,content:'UX6 browser A gửi lại',items:payloads[0].items.map((item:any)=>({...item,enteredValue:32}))}});
    await rpc(author.client,'submit_daily_log_source_v2',{p_input:{commandId:command(),contributionId:sources[0],expectedRowVersion:5}});
    await page.getByRole('button',{name:'Đóng',exact:true}).click();
    await row.getByRole('button',{name:'Tổng hợp',exact:true}).click();
    await expect(page.getByText('Có phiếu gửi lại').first()).toBeVisible();
    await expect(page.getByLabel('Nội dung tổng hợp',{exact:true})).toHaveValue('Nội dung tổng hợp lần hai, giữ tài nguyên');
    await expect(page.getByLabel('Kế hoạch ngày sau',{exact:true})).toHaveValue('Tiếp tục đổ móng khu A');
    await expect(cardA.getByText('35 %',{exact:true})).toBeVisible();
    expect((await query(`select source_version,source_fingerprint from public.daily_log_summary_sources where daily_log_id='${log}' and contribution_id='${sources[0]}'`))[0]).toEqual(savedCard);
    await cardA.getByRole('button',{name:'Cập nhật từ phiếu',exact:true}).click();
    await expect(cardA.getByText('32 %',{exact:true})).toBeVisible();
    await expect(cardA.getByText(/Phiếu nguồn v6/)).toBeVisible();
    saved=page.waitForResponse(response=>response.url().endsWith('/rpc/save_daily_log_summary_work_v1'));
    await page.getByRole('button',{name:'Lưu tổng hợp',exact:true}).click();expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button',{name:'Lưu tổng hợp',exact:true})).toBeEnabled();
    expect((await query(`select source_version from public.daily_log_summary_sources where daily_log_id='${log}' and contribution_id='${sources[0]}'`))[0].source_version).toBe(6);
    for(const theme of ['light','dark']) {
      if(theme==='dark') {
        await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Đóng',exact:true}).click();
        await page.getByRole('button',{name:'Dark Mode',exact:true}).click();await row.getByRole('button',{name:'Tổng hợp',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Tổng hợp thi công ngày',exact:true})).toBeVisible();
      }
      for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[360,800]]) {
      await page.setViewportSize({width,height});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width<=390) await expect(page.locator('.daily-log-summary dd').filter({hasText:'Lượt người theo hạng mục:'})).toHaveCSS('white-space','normal');
      await page.locator('.daily-log-summary').evaluate(node=>{let parent=node.parentElement;while(parent){if(parent.scrollHeight>parent.clientHeight)parent.scrollTop=0;parent=parent.parentElement;}});
      await page.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/summary-erp-${theme}-${width}.png`,fullPage:true});
      if(width===1440 || width===390) {
        const selected=page.getByRole('heading',{name:'Phiếu được chọn',exact:true});
        await selected.scrollIntoViewIfNeeded();
        const firstCard=page.locator('[data-testid="daily-log-area-card"]').first();
        const cardDetails=firstCard.locator('details').first();
        if(!await cardDetails.evaluate(node=>node.hasAttribute('open'))) await cardDetails.locator(':scope > summary').click();
        await page.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/summary-slips-${theme}-${width}.png`,fullPage:true});
      }
      }
    }
  } finally {
    await query(`delete from public.daily_logs where id='${log}' and project_id='${project}' and date='${date}';
      ${commands.length?`delete from app_private.daily_log_source_command_receipts where command_id in('${commands.join("','")}') and project_id='${project}';`:''}
      ${sources.length?`delete from public.daily_log_contributions where id in('${sources.join("','")}') and project_id='${project}';`:''}
      delete from public.project_tasks where id='${task}' and project_id='${project}';`,false);
    await Promise.all(clients.map(client=>client.auth.signOut({scope:'local'})));
    const remaining=await query(`select (select count(*)::int from public.daily_logs where id='${log}') logs,
      (select count(*)::int from public.daily_log_contributions where id in('${sources.join("','") || '00000000-0000-0000-0000-000000000000'}')) sources,
      (select count(*)::int from app_private.daily_log_source_command_receipts where receipt->>'dailyLogId'='${log}') receipts`);
    expect(remaining[0]).toEqual({logs:0,sources:0,receipts:0});
  }
});
