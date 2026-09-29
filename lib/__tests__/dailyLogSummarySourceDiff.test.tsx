import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it, expect } from 'vitest';
import { DailyLogSourceDiff } from '../../components/project/daily-log/DailyLogSourceDiff';
import { buildDailyLogSummaryDraft } from '../../components/project/daily-log/DailyLogSummaryWorkspace';
import { summaryBundle } from '../../tests/daily-log/summary-bundle';
it('shows changed quantities, notes, photos, hours and removed resources, not a false no-change message',()=>{
  const card=buildDailyLogSummaryDraft(summaryBundle).cards[0];
  const html=renderToStaticMarkup(<DailyLogSourceDiff sourceItems={card.sourceItems} editedItems={card.editedItems.map(item=>({...item,dailyQuantityDone:40,note:'Ghi chú mới',attachments:[]}))} sourceResources={card.sourceResources} editedResources={[{...card.resources[0],totalHours:48}]} />);
  expect(html).toContain('khối lượng hôm nay');expect(html).toContain('ghi chú');expect(html).toContain('ảnh');expect(html).toContain('48');expect(html).toContain('Đã bỏ');
  expect(html).not.toContain('Không có thay đổi');
});
it('formats forecast comparisons as Vietnamese dates',()=>{
  const item=summaryBundle.workItems[0];
  const html=renderToStaticMarkup(<DailyLogSourceDiff sourceItems={[{...item,forecastFinishDate:'2026-10-01'}]} editedItems={[{...item,forecastFinishDate:'2026-10-02'}]} />);
  expect(html).toContain('01/10/2026');expect(html).toContain('02/10/2026');
});
