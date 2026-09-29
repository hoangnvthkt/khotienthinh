import { describe, expect, it } from 'vitest';
import { buildDailyLogSummaryPrefill } from '../dailyLogWorkflow';

describe('buildDailyLogSummaryPrefill', () => {
  it('starts the summary from sent slips only, one line per front', () => {
    expect(buildDailyLogSummaryPrefill([
      { status: 'submitted', workAreaName: 'Mũi 1', authorName: 'KS. Minh', content: 'Đổ bê tông lót móng trục A', issues: '' },
      { status: 'included', workAreaCode: 'M2', authorName: 'KS. Lan', content: 'Buộc thép cổ cột', issues: 'Mưa ngập hố móng' },
      { status: 'draft', workAreaName: 'Mũi 3', content: 'Chưa gửi', issues: 'Nháp' },
      { status: 'returned', workAreaName: 'Mũi 4', content: 'Bị trả', issues: 'Bị trả' },
    ])).toEqual({
      description: '- Mũi 1 (KS. Minh): Đổ bê tông lót móng trục A\n- M2 (KS. Lan): Buộc thép cổ cột',
      issues: '- M2 (KS. Lan): Mưa ngập hố móng',
    });
  });
});
