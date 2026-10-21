import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DailyLogDetailTabs, { type DailyLogDetailPrefill } from '../../components/project/DailyLogDetailTabs';

const prefill: DailyLogDetailPrefill = {
  sourceLogId: 'log-1',
  sourceLabel: 'nhật ký 11/10 của bạn',
  labor: [{ laborType: 'Tổ đội', groupName: 'Tổ anh Minh', count: 8, hours: 8, unit: 'người' }],
  machines: [],
};

const render = (over: Partial<React.ComponentProps<typeof DailyLogDetailTabs>>) => renderToStaticMarkup(
  <DailyLogDetailTabs
    volumes={[]} materials={[]} laborDetails={[]} machines={[]}
    onVolumesChange={() => {}} onMaterialsChange={() => {}} onLaborChange={() => {}} onMachinesChange={() => {}}
    {...over}
  />,
);

describe('DailyLogDetailTabs · gợi ý Như hôm qua', () => {
  it('tab Nhân công báo có gợi ý khi còn trống; tab Máy không báo vì nguồn không có máy', () => {
    const html = render({ prefill });
    expect(html.split('Có gợi ý như hôm qua').length - 1).toBe(1);
  });

  it('đã có dòng thì không gợi ý nữa', () => {
    const html = render({ prefill, laborDetails: [{ laborType: 'Tổ đội', groupName: 'Tổ B', count: 3, hours: 8 }] });
    expect(html).not.toContain('hôm qua');
  });

  it('không có nguồn thì không có gì thay đổi', () => {
    expect(render({})).not.toContain('hôm qua');
  });
});
