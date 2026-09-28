import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DailyLogWorkItemReadTable} from '../../components/project/daily-log/DailyLogWorkItemReadTable';
import {buildDailyLogSummaryDraft} from '../../components/project/daily-log/DailyLogSummaryWorkspace';
import {summaryBundle} from '../../tests/daily-log/summary-bundle';
describe('read-only construction report',()=>{
  const card=buildDailyLogSummaryDraft(summaryBundle).cards[0];
  it.each(['review','verified'] as const)('renders physical work without editor controls in %s',mode=>{
    const html=renderToStaticMarkup(<DailyLogWorkItemReadTable items={card.editedItems} resources={card.resources} mode={mode}/>);
    expect(html).toContain('Bê tông móng');expect(html).toContain('30 %');expect(html).toContain('30 m²');
    expect(html).not.toMatch(/<(input|select|textarea|button)\b/);expect(html).not.toMatch(/Đơn giá|Thành tiền/);
  });
  it('keeps providers and photographs under their work item',()=>{
    const html=renderToStaticMarkup(<DailyLogWorkItemReadTable items={card.editedItems} resources={card.resources} mode="verified"/>);
    expect(html).toMatch(/data-work-item-id="work-A-1"[\s\S]*?Nguồn móng A[\s\S]*?Ảnh móng A[\s\S]*?data-work-item-id="work-A-2"[\s\S]*?Nguồn tường A/);
    expect(html).toContain('5 người');expect(html).toContain('40 giờ');expect(html).toContain('16 giờ');
  });
  it('does not invent units or convert unknown historical quantities to zero',()=>{
    const html=renderToStaticMarkup(<DailyLogWorkItemReadTable items={[{...card.editedItems[0],unit:null,cumulativeQuantityDone:30,dailyQuantityDone:null}]} resources={[]} mode="verified"/>);
    expect(html).toContain('Chưa xác định đơn vị');expect(html).toContain('Chưa xác định');expect(html).not.toContain('30 m³');
    expect(html).toContain('Giữ nguyên số liệu đã lưu');
  });
});
