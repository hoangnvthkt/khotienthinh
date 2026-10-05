import {test,expect} from '@playwright/test';
for(const width of [390,768,1440]) test(`HR waits for Office and source links work at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 await page.goto('/tests/transfer/fixture.html');
 await expect(page.getByText('Chờ phát hành Office',{exact:true}).last()).toBeVisible();
 await expect(page.getByRole('button',{name:'Duyệt điều động',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Kết thúc sớm',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Mở thông báo Office'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.screenshot({path:`.office-run-logs/transfer-live/hr-${width}.png`,fullPage:true});
 await page.getByRole('link',{name:'Mở thông báo Office'}).click();
 await expect(page.getByRole('heading',{name:'Thông báo Office đã liên kết'})).toBeVisible();
 await page.goBack();
 await page.getByRole('link',{name:'Xem yêu cầu nguồn'}).click();
 await expect(page.getByRole('heading',{name:'Yêu cầu nguồn đã liên kết'})).toBeVisible();
 await page.goto('/tests/transfer/fixture.html#/notice-preview');
 const positions=await page.locator('.office-rich-view p').evaluate(p=>{
  const n=p.firstChild!; const t=n.textContent!;
  return [0,t.indexOf('Nơi đến'),t.indexOf('Bắt đầu')].map(start=>{const r=document.createRange();r.setStart(n,start);r.setEnd(n,start+1);return r.getBoundingClientRect().top;});
 });
 expect(positions[1]).toBeGreaterThan(positions[0]);
 expect(positions[2]).toBeGreaterThan(positions[1]);
});
