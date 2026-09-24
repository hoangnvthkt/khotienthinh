import { formatDecimal6, parseQuantity6 } from '../procurement/decimal';

interface MaterialBoqLine {
  quantity: string;
  unit: string;
}

export interface ProjectV2MaterialBoqPositionInput {
  unit: string;
  boqLines: readonly MaterialBoqLine[] | null;
  receivedQuantity: string | null;
  pendingQuantity: string | null;
}

export interface ProjectV2MaterialBoqPosition {
  state: 'known' | 'unknown' | 'outside_boq';
  boqQuantity: string | null;
  receivedQuantity: string | null;
  remainingQuantity: string | null;
  pendingQuantity: string | null;
}

const canonical = (value: bigint): string => {
  const formatted = formatDecimal6(value);
  const [whole, fraction = ''] = formatted.split('.');
  return `${whole}.${fraction.padEnd(6, '0')}`;
};

export function calculateProjectV2MaterialBoqPosition(
  input: ProjectV2MaterialBoqPositionInput,
): ProjectV2MaterialBoqPosition {
  const received = input.receivedQuantity === null ? null : parseQuantity6(input.receivedQuantity);
  const pending = input.pendingQuantity === null ? null : parseQuantity6(input.pendingQuantity);
  const receivedQuantity = received === null ? null : canonical(received);
  const pendingQuantity = pending === null ? null : canonical(pending);
  if (input.boqLines === null) return { state: 'unknown', boqQuantity: null,
    receivedQuantity, remainingQuantity: null, pendingQuantity };
  if (!input.boqLines.length) return { state: 'outside_boq', boqQuantity: null,
    receivedQuantity, remainingQuantity: null, pendingQuantity };
  if (!input.unit || input.boqLines.some(line => line.unit !== input.unit))
    throw new Error('INVALID_UNIT: Resolve BOQ units before aggregation.');
  const boq = input.boqLines.reduce((sum, line) => sum + parseQuantity6(line.quantity), 0n);
  parseQuantity6(formatDecimal6(boq));
  return { state: received === null ? 'unknown' : 'known', boqQuantity: canonical(boq),
    receivedQuantity, remainingQuantity: received === null ? null : canonical(boq - received),
    pendingQuantity };
}
