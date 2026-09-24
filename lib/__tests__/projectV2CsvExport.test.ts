import { describe, expect, it } from 'vitest';
import { exportProjectV2PlanCsv } from '../projectV2/csvExport';

const plan = { code: 'KH-10', title: 'Kế hoạch, tháng "Mười"',
  planType: 'month' as const, revision: 2 };
const lines = [{ id: 'line-1', displayCode: '=WEBSERVICE("x")',
  displayName: 'Bê tông,\nMóng "A"', unit: 'm3', quantity: '12.123456',
  unit_price_snapshot: '100.123456', work_start: '2026-10-01', work_end: '2026-10-05' }];

describe('Project V2 CSV export', () => {
  it('exports the viewed revision in Vietnamese with exact decimals and CSV quoting', () => {
    const csv = exportProjectV2PlanCsv({ plan, lines, priceVisible: true });
    expect(csv).toContain('KH-10');
    expect(csv).toContain('Bản 2');
    expect(csv).toContain('12.123456');
    expect(csv).toContain('100.123456');
    expect(csv).toContain('"Bê tông,\nMóng ""A"""');
  });

  it('never exports prices without capability', () => {
    const csv = exportProjectV2PlanCsv({ plan, lines, priceVisible: false });
    expect(csv).not.toContain('Đơn giá');
    expect(csv).not.toContain('100.123456');
  });

  it.each(['=1+1', '+cmd', '-cmd', '@SUM(1)', '\t=1+1', '\r=1+1'])(
    'neutralizes formula-like cell %j', value => {
      const csv = exportProjectV2PlanCsv({ plan, lines: [{ ...lines[0], displayName: value }],
        priceVisible: false });
      expect(csv).toContain(`'${value}`);
    });
});
