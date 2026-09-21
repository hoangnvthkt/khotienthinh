import { calculateDemandBalance } from './balance';
import { formatDecimal6, parseDecimal6 } from './decimal';

const withUnit = (value: string, unit: string) => `${value} ${unit}`;

export const formatProcurementQuantity = (value: string | null): string => {
  if (value == null) return 'Chưa xác định';
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return value;
  const fraction = (match[3] || '').replace(/0+$/, '');
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${match[1]}${integer}${fraction ? `,${fraction}` : ''}`;
};

export const presentDemandBalance = (input: {
  approved: string | null;
  fulfilled: string;
  closed: string;
  reserved: string;
  committed: string;
  unit: string;
}) => {
  const balance = calculateDemandBalance(input);
  if (input.approved == null || balance.openNeed == null || balance.availableToPlan == null) {
    return { known: false, availableToPlan: 'Chưa xác định' };
  }
  return {
    approved: withUnit(input.approved, input.unit),
    fulfilled: withUnit(input.fulfilled, input.unit),
    closed: withUnit(input.closed, input.unit),
    reserved: withUnit(input.reserved, input.unit),
    committed: withUnit(input.committed, input.unit),
    openNeed: withUnit(balance.openNeed, input.unit),
    availableToPlan: withUnit(balance.availableToPlan, input.unit),
    known: true,
  };
};

export const summarizeProcurementSelection = (lines: Array<{ quantity: string; unit: string }>): string => {
  const units = new Set(lines.map(line => line.unit.trim()).filter(Boolean));
  if (units.size !== 1) return `${lines.length} dòng · ${units.size} đơn vị`;
  const quantity = lines.reduce((sum, line) => sum + parseDecimal6(line.quantity), 0n);
  return `${formatDecimal6(quantity)} ${Array.from(units)[0]} · ${lines.length} dòng`;
};
