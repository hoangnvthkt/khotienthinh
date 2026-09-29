import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { branchConfig, query, ref } from '../daily-log/cloud.mjs';

test('real ERP engineer chooses A/B, saves physical quantities and metadata then submits own slip', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  const commands:string[] = [], directStatusWrites:string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if(url.pathname.includes('/rpc/')) commands.push(url.pathname.split('/').pop()!);
    if(request.method() === 'PATCH' && url.pathname.endsWith('/daily_log_contributions') && request.postDataJSON()?.status) directStatusWrites.push(url.pathname);
  });
  test.setTimeout(180000);
  const config = branchConfig();
  const options = { auth:{persistSession:false,autoRefreshToken:false} };
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, options);
  const identity = await admin.auth.admin.getUserById('f30d5711-1a9d-47b2-a536-9424cc66b822');
  expect(identity.error).toBeNull();
  const link = await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user!.email!});
  expect(link.error).toBeNull();
  const actor = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options);
  const login = await actor.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties!.hashed_token});
  expect(login.error).toBeNull();
  expect((await actor.rpc('is_admin')).data).toBe(false);
  const project = 'DL-WBS-PILOT-20260925', date = '2099-08-03';
  const task = `__DL_UX5_BROWSER_${crypto.randomUUID()}`;
  const before = await query(`select count(*)::int n from public.daily_log_contributions where project_id='${project}' and date='${date}'`);
  expect(before[0].n).toBe(0);
  await query(`insert into public.project_tasks(id,project_id,name,wbs_code,start_date,end_date,fallback_unit,provisional_quantity)
    values('${task}','${project}','Bê tông kiểm thử UX5','UX5','${date}','2099-08-30','m³',100)`,false);
  try {
    await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${ref}-auth-token`,session:login.data.session});
    await page.goto(`/#/da?projectId=${project}&tab=dailylog`);
    await expect(page.getByText('Nhật ký WBS — dữ liệu kiểm thử riêng').first()).toBeVisible({timeout:45000});
    await page.getByRole('button',{name:/Ghi nhật ký|Thêm nhật ký/}).first().click();
    await page.getByLabel('Ngày lập phiếu').fill(date);
    await expect(page.getByText('Chọn phiếu của bạn')).toBeVisible();
    for (const area of ['A','B']) {
      if(area === 'B') await page.locator('summary').filter({hasText:'Đổi ngày hoặc phiếu'}).click();
      await page.getByRole('button',{name:'Tạo phiếu khu vực khác'}).click();
      await page.getByLabel('Mã khu vực mới').fill(`UX5-${area}`);
      await page.getByLabel('Tên khu vực mới').fill(`Khu kiểm thử ${area}`);
      await page.getByRole('button',{name:'Tạo phiếu',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Phiếu thi công ngày'})).toBeVisible();
      if(area === 'B') break;
      await page.getByRole('button',{name:'Chọn công việc',exact:true}).click();
      await page.getByRole('checkbox',{name:'Chọn UX5 Bê tông kiểm thử UX5'}).check();
      await page.getByRole('button',{name:'Đưa vào phiếu'}).click();
      await page.getByLabel('Cách nhập khối lượng',{exact:true}).filter({visible:true}).selectOption('daily_quantity');
      await page.getByLabel('Khối lượng hôm nay',{exact:true}).filter({visible:true}).fill('12,5');
      await page.getByRole('button',{name:/Công tác thực hiện/}).filter({visible:true}).first().click();
      await page.getByRole('textbox',{name:'Công tác thực hiện',exact:true}).filter({visible:true}).fill('Nội dung A lưu cùng khối lượng');
      await page.getByRole('textbox',{name:'Sự cố / vướng mắc',exact:true}).filter({visible:true}).fill('Lối vào hẹp');
      await page.getByRole('button',{name:'Chi tiết',exact:true}).filter({visible:true}).click();
      const labor = page.locator('section').filter({has:page.getByRole('heading',{name:'Nhân công hôm nay',exact:true})}).last();
      await labor.getByRole('button',{name:'Thêm dòng'}).click();
      await page.getByLabel('Nguồn cung cấp nhân công 1').filter({visible:true}).selectOption('manual');
      await page.getByLabel('Tên nguồn').filter({visible:true}).fill('Tổ anh Minh, tên dài để kiểm tra bố trí nguồn lực');
      await page.getByLabel('Nhóm nhân công').filter({visible:true}).fill('Tổ bê tông');
      await page.getByLabel('Số người',{exact:true}).filter({visible:true}).fill('5');
      await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();
      await expect(page.getByText('Đã lưu phiếu. Có thể tiếp tục ghi hoặc gửi tổng hợp.')).toBeVisible();
    }
    await expect(page.getByText('Chưa có công việc. Chọn hạng mục thi công để ghi khối lượng, nhân công và máy.')).toBeVisible();
    await page.locator('summary').filter({hasText:'Đổi ngày hoặc phiếu'}).click();
    const sourceA = page.getByRole('radio',{name:/Khu kiểm thử A/});
    await sourceA.click();
    await expect(page.getByRole('radio',{name:/Khu kiểm thử A/,includeHidden:true})).toBeChecked();
    await expect(page.locator('details.dl-slip-selection')).not.toHaveAttribute('open','');
    await page.getByRole('button',{name:/Công tác thực hiện/}).filter({visible:true}).first().click();
    await expect(page.getByRole('textbox',{name:'Công tác thực hiện',exact:true}).filter({visible:true})).toHaveValue('- Nội dung A lưu cùng khối lượng');
    await expect(page.getByLabel('Khối lượng hôm nay',{exact:true}).filter({visible:true})).toHaveValue('12,5');
    for (const [width,height] of [[1440,900],[768,1024],[390,844]]) {
      await page.setViewportSize({width,height});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/engineer-erp-${width}.png`,fullPage:true});
    }
    await page.getByRole('button',{name:'Gửi tổng hợp',exact:true}).click();
    await expect.poll(async()=>(await query(`select status from public.daily_log_contributions where project_id='${project}' and date='${date}' and work_area_code='UX5-A'`))[0]?.status).toBe('submitted');
    const sources = await query(`select id,work_area_code,status,row_version,source_draft_payload from public.daily_log_contributions where project_id='${project}' and date='${date}' order by work_area_code`);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({work_area_code:'UX5-A',status:'submitted',row_version:4});
    expect(sources[1]).toMatchObject({work_area_code:'UX5-B',status:'draft',row_version:1});
    expect(sources[0].source_draft_payload.content).toContain('  - Nội dung A lưu cùng khối lượng');
    expect(sources[0].source_draft_payload.issues).toContain('  - Lối vào hẹp');
    expect(sources[0].source_draft_payload.items[0]).toMatchObject({note:'- Nội dung A lưu cùng khối lượng',issues:'- Lối vào hẹp'});
    const work = (await query(`select cumulative_quantity_done,daily_quantity_done from public.daily_log_work_items where contribution_id='${sources[0].id}'`))[0];
    expect(Number(work.cumulative_quantity_done)).toBe(12.5); expect(Number(work.daily_quantity_done)).toBe(12.5);
    expect((await query(`select count(*)::int n from public.project_daily_task_progress where project_id='${project}' and progress_date='${date}'`))[0].n).toBe(0);
    expect(commands.filter(name => name === 'save_daily_log_source_document_v2')).toHaveLength(2);
    expect(commands.filter(name => name === 'submit_daily_log_source_v2')).toHaveLength(1);
    expect(directStatusWrites).toEqual([]);
  } finally {
    await query(`delete from app_private.daily_log_source_command_receipts where project_id='${project}' and log_date='${date}'
      and receipt->>'contributionId' in(select id::text from public.daily_log_contributions where project_id='${project}' and date='${date}' and work_area_code in('UX5-A','UX5-B'));`,false);
    await query(`delete from public.daily_log_contributions where project_id='${project}' and date='${date}' and work_area_code in('UX5-A','UX5-B');`,false);
    await query(`delete from public.project_tasks where id='${task}' and project_id='${project}'`,false);
    await actor.auth.signOut({scope:'local'});
  }
});
