import type { ProjectV2PlanType } from '../../types/projectV2';

type CsvLine = Record<string, unknown> & { id: string; quantity: string | null };
export interface ProjectV2CsvInput {
  plan: { code: string; title: string; planType: ProjectV2PlanType; revision: number };
  lines: CsvLine[];
  priceVisible: boolean;
}

const text = (value: unknown) => value === null || value === undefined ? '' : String(value);
const safe = (value: unknown) => {
  const raw = text(value);
  const neutralized = /^[\s]*[=+\-@]/.test(raw) || /^[\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
};
const row = (values: unknown[]) => values.map(safe).join(',');

export function exportProjectV2PlanCsv({ plan, lines, priceVisible }: ProjectV2CsvInput): string {
  const includePrice = plan.planType === 'month' && priceVisible;
  const header = ['Mã', 'Công việc / vật tư', 'Đơn vị', 'Khối lượng',
    ...(includePrice ? ['Đơn giá', 'Thành tiền'] : []), 'Ngày bắt đầu / ngày cần', 'Ngày kết thúc / điểm nhận'];
  const records = lines.map(line => {
    const quantity = line.quantity === null ? 'Chưa xác định' : line.quantity;
    const price = line.unit_price_snapshot;
    const total = includePrice && quantity !== 'Chưa xác định' && price !== null && price !== undefined
      ? calculateAmount(quantity, text(price)) : '';
    return row([line.displayCode, line.displayName, line.unit, quantity,
      ...(includePrice ? [price ?? 'Chưa xác định', total || 'Chưa xác định'] : []),
      line.needed_date ?? line.work_start, line.destination_id ?? line.work_end]);
  });
  return `\uFEFF${row(['Kế hoạch', plan.code, plan.title, `Bản ${plan.revision}`])}\r\n${row(header)}\r\n${records.join('\r\n')}${records.length ? '\r\n' : ''}`;
}

function calculateAmount(quantity: string, price: string): string | null {
  const match = (value: string) => /^\d+(?:\.\d{1,6})?$/.test(value);
  if (!match(quantity) || !match(price)) return null;
  const scaled = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  };
  const amount = (scaled(quantity) * scaled(price) + 500_000n) / 1_000_000n;
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}
