import { expect,test } from '@playwright/test';
for (const width of [390,768,1440]) {
 test(`preserves all approved source fields at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await page.goto('/tests/procurement/external-intake-fixture.html');
  await expect(page.getByText('Đã tiếp nhận dữ liệu đã duyệt')).toBeVisible();
  const panel=page.getByRole('dialog');
  await expect(panel.getByText('SL Phê duyệt').filter({visible:true})).toBeVisible();
  await expect(panel.getByText('Mở phiếu nguồn')).toHaveAttribute('href','#/wf/fixture');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if(width<768) {
   const card=page.locator('article');
   await expect(card).toContainText('8');
   await expect(card).toContainText('KC-02');
   await expect(card.locator('dt').filter({hasText:'SL Phê duyệt'}).locator('xpath=following-sibling::dd[1]')).toHaveText('—');
  } else {
   await expect(page.locator('tbody td').nth(4)).toHaveText('—');
  }
  await expect(page.getByRole('button',{name:'Lập đơn hàng',exact:true})).toHaveCount(0);
  await page.screenshot({path:`/tmp/procurement-external-${width}.png`,fullPage:true});
 });
}
test('withdrawal clearly pauses handling',async({page})=>{
 await page.goto('/tests/procurement/external-intake-fixture.html?withdrawn=1');
 await expect(page.getByText('Nguồn đã thu hồi — tạm dừng xử lý')).toBeVisible();
 await expect(page.getByText('Chờ phiếu nguồn được duyệt lại.')).toBeVisible();
});
