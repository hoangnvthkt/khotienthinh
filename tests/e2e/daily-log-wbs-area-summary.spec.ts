import { expect, test, type Page } from '@playwright/test';
import { loginPersonas } from '../daily-log/personas.mjs';
import { query, ref } from '../daily-log/cloud.mjs';

let sessions: Awaited<ReturnType<typeof loginPersonas>>;
let startDate: string;
const project='DL-WBS-PILOT-20260925';
const owner='72000000-0000-4000-8000-000000000004';
const configure=(mode:string,date:string)=>query(`select app_private.configure_daily_log_pilot_v1('${project}',null,'${mode}',
  '2026-09-25','browser-${date}','${owner}','Live browser acceptance ${mode}')`,false);
test.beforeAll(async()=>{
  sessions=await loginPersonas();
  const rows=await query(`select greatest(coalesce(max(date),'2026-09-25'::date),'2026-09-25'::date)+1 next from public.daily_log_contributions where project_id='${project}'`);
  startDate=rows[0].next;
});
async function enter(page:Page,persona:string,screen:string,date:string) {
  await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{
    key:`sb-${ref}-auth-token`,session:sessions[persona].session,
  });
  await page.goto(`/tests/daily-log/cloud-fixture.html?persona=${persona}&screen=${screen}&date=${date}`);
}
for(const [index,width] of [1440,900,390].entries()) {
  test(`live two-area publication and rollback at ${width}px`,async({page})=>{
    const date=new Date(Date.parse(startDate)+index*86400000).toISOString().slice(0,10);
    await page.setViewportSize({width,height:1000});
    await configure('pilot',date);
    try {
      for(const [persona,area] of [['author_a','A'],['author_b','B']]) {
        await enter(page,persona,'source',date);
        await page.getByLabel('Mã khu vực/mũi thi công').fill(area);
        await page.getByLabel('Tên khu vực/mũi thi công').fill(`Khu ${area}`);
        await page.getByRole('button',{name:'Chọn WBS',exact:true}).click();
        await page.getByRole('checkbox').first().check();
        await page.getByRole('button',{name:'Đưa vào phiếu'}).click();
        if(width<768) await page.getByRole('button',{name:/1.1 Bê tông móng/}).click();
        else await page.getByRole('button',{name:'Mở nguồn lực Bê tông móng'}).click();
        await page.locator('input[aria-label="% lũy kế"]:visible').fill('30');
        const resource=page.locator('section').filter({has:page.getByRole('heading',{name:area==='A'?'Nhân công hôm nay':'Máy hôm nay',exact:true})}).last();
        await resource.getByRole('button',{name:'Thêm dòng'}).click();
        if(area==='A') {
          await page.getByLabel('Nguồn cung cấp nhân công 1').filter({visible:true}).selectOption('catalog:DL-WBS-PILOT-PROVIDER');
          await page.getByLabel('Nhóm nhân công').filter({visible:true}).fill('Tổ bê tông');
          await page.getByLabel('Số người',{exact:true}).filter({visible:true}).fill('5');
          await page.getByLabel('Giờ mỗi người').filter({visible:true}).fill('8');
        } else {
          await page.getByLabel('Nguồn cung cấp máy 1').filter({visible:true}).selectOption('manual');
          await page.getByLabel('Tên nguồn').filter({visible:true}).fill('Chủ máy anh Bình');
          await page.getByLabel('Loại máy').filter({visible:true}).fill('Máy trộn');
          await page.getByLabel('Số máy',{exact:true}).filter({visible:true}).fill('2');
          await page.getByLabel('Giờ mỗi máy').filter({visible:true}).fill('6');
        }
        await page.getByRole('button',{name:'Gửi tổng hợp',exact:true}).click();
        await expect(page.getByRole('status')).toContainText('Đã gửi tổng hợp');
        const sources=await query(`select row_version,source_fingerprint from public.daily_log_contributions where project_id='${project}' and date='${date}' and author_user_id='${sessions[persona].person.id}'`);
        expect(Number(sources[0].row_version)).toBe(2);
        expect(sources[0].source_fingerprint).toBeTruthy();
      }
      expect((await query(`select count(*)::int n from public.project_daily_task_progress where project_id='${project}' and progress_date='${date}'`))[0].n).toBe(0);
      await enter(page,'summarizer','summary',date);
      await expect(page.getByTestId('daily-log-area-card')).toHaveCount(2);
      await expect(page.getByRole('button',{name:'Gửi CHT',exact:true})).toBeDisabled();
      await page.getByLabel('Cách xử lý').selectOption('manual_override');
      await page.getByLabel('% chính thức 1.1').fill('30');
      await page.getByLabel('Lý do quyết định').fill('Hai khu vực chưa phân bổ; chốt theo biên bản kiểm thử');
      await page.getByLabel('Khối lượng lũy kế chính thức',{exact:true}).fill('30');
      await page.getByLabel('Khối lượng trong ngày chính thức',{exact:true}).fill('0');
      await page.screenshot({path:`.superpowers/sdd/2026-09-23-daily-log-wbs-area-summary-progress/summary-${width}.png`,fullPage:true});
      await page.getByRole('button',{name:'Gửi CHT',exact:true}).click();
      await expect(page.getByRole('status')).toContainText('Đã gửi CHT');
      await enter(page,'reader','review',date);
      await expect(page.getByTestId('daily-log-area-card')).toHaveCount(2);
      await expect(page.getByRole('button',{name:'Đối chiếu thử nghiệm'})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Trả lại toàn bộ'})).toHaveCount(0);
      await enter(page,'denied','review',date);
      await expect(page.getByRole('alert')).toBeVisible();
      await enter(page,'approver','review',date);
      await page.getByRole('button',{name:'Đối chiếu thử nghiệm'}).click();
      await expect(page.getByRole('status')).toContainText('1 WBS còn sai khác');
      await expect(configure('enforced',date)).rejects.toThrow(/PILOT_SHADOW_UNRESOLVED/);
      const saved=await sessions.approver.client.rpc('save_project_progress_period',{p_project_id:project,p_construction_site_id:null,
        p_period_type:'daily',p_period_start:date,p_rows:[{taskId:'DL-WBS-PILOT-TASK',progressPercent:30,quantityDone:30,dailyQuantityDone:0}],
        p_snapshot:{constructionProgressPercent:30,valueProgressPercent:0,progressMode:'manual'}});
      expect(saved.error).toBeNull();
      await page.getByRole('button',{name:'Đối chiếu thử nghiệm'}).click();
      await expect(page.getByRole('status')).toContainText('Đối chiếu thử nghiệm khớp');
      await configure('enforced',date);
      await page.reload();
      await page.getByRole('button',{name:'Duyệt & công bố'}).click();
      await expect(page.getByRole('status')).toContainText('Đã duyệt và công bố tiến độ');
      await enter(page,'approver','progress',date);
      await expect(page.getByText('1 dòng tiến độ chính thức')).toBeVisible();
      await expect(page.getByText('NCC kiểm thử Nhật ký',{exact:true})).toBeVisible();
      await expect(page.getByText('Chủ máy anh Bình',{exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'Trả lại toàn bộ'})).toHaveCount(0);
      await expect(page.getByText(/Đơn giá|Thành tiền|Accrual/)).toHaveCount(0);
      if(width===390) {
        const card=page.getByTestId('daily-log-area-card').first();
        await card.locator('summary').click();
        await expect(card.locator('details')).not.toHaveAttribute('open','');
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.superpowers/sdd/2026-09-23-daily-log-wbs-area-summary-progress/verified-${width}.png`,fullPage:true});
      await page.getByRole('link',{name:'Mở nhật ký'}).click();
      await expect(page).toHaveURL(new RegExp(`#/da\\?tab=dailylog&dailyLogId=DL-WBS-E2E-${date}$`));
    } finally {
      await configure('paused',date);
    }
  });
}
