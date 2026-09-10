import { describe, expect, it } from 'vitest';

import type { MaterialIssueOrder } from '../../types';
import {
  getMaterialIssueLineDisposition,
  getMaterialIssueReversalEligibility,
} from '../materialIssueReturnPolicy';

const order = (overrides: Partial<MaterialIssueOrder> = {}): MaterialIssueOrder => ({
  id: 'order-1',
  issueNo: 'PX-001',
  sourceWarehouseId: 'wh-source',
  recipientType: 'employee',
  recipientName: 'Nguyễn Văn A',
  status: 'issued',
  transactionId: 'tx-export-1',
  lines: [{
    id: 'line-1',
    issueOrderId: 'order-1',
    itemId: 'item-1',
    itemNameSnapshot: 'Mũ bảo hộ',
    unit: 'Cái',
    requestedQty: 10,
    approvedQty: 10,
    issuedQty: 10,
    receivedQty: 0,
    consumedQty: 0,
    returnedQty: 0,
    lostQty: 0,
    unitPrice: 0,
  }],
  receipts: [],
  returns: [],
  settlements: [],
  ...overrides,
});

describe('material issue return policy', () => {
  it('returns all ten units when nothing has been settled', () => {
    expect(getMaterialIssueLineDisposition(order(), 'line-1')).toEqual({
      openQty: 10,
      pendingReturnQty: 0,
      returnableQty: 10,
      settleableQty: 10,
    });
  });

  it('returns only the five unused units after five were consumed', () => {
    const issued = order();
    issued.lines[0].consumedQty = 5;

    expect(getMaterialIssueLineDisposition(issued, 'line-1')).toEqual({
      openQty: 5,
      pendingReturnQty: 0,
      returnableQty: 5,
      settleableQty: 5,
    });
  });

  it('reserves pending returns from both return and settlement capacity', () => {
    const issued = order({
      returns: [{
        id: 'return-1',
        issueOrderId: 'order-1',
        returnNo: 'PNH-001',
        returnKind: 'unused_return',
        targetWarehouseId: 'wh-source',
        status: 'pending',
        transactionId: 'tx-import-1',
        reason: 'Vật tư thừa',
        idempotencyKey: 'return-1-key',
        metadata: {},
        createdAt: '2026-09-05T00:00:00.000Z',
        lines: [{
          id: 'return-line-1',
          issueReturnId: 'return-1',
          issueLineId: 'line-1',
          itemId: 'item-1',
          returnQty: 3,
        }],
      }],
    });
    issued.lines[0].consumedQty = 5;

    expect(getMaterialIssueLineDisposition(issued, 'line-1')).toEqual({
      openQty: 5,
      pendingReturnQty: 3,
      returnableQty: 2,
      settleableQty: 2,
    });
  });

  it('does not reserve cancelled or completed return documents twice', () => {
    const returnDocument = (status: 'completed' | 'cancelled') => ({
      id: `return-${status}`,
      issueOrderId: 'order-1',
      returnNo: `PNH-${status}`,
      returnKind: 'unused_return' as const,
      targetWarehouseId: 'wh-source',
      status,
      transactionId: `tx-${status}`,
      reason: 'Vật tư thừa',
      idempotencyKey: `key-${status}`,
      metadata: {},
      createdAt: '2026-09-05T00:00:00.000Z',
      lines: [{
        id: `line-${status}`,
        issueReturnId: `return-${status}`,
        issueLineId: 'line-1',
        itemId: 'item-1',
        returnQty: 3,
      }],
    });
    const issued = order({ returns: [returnDocument('completed'), returnDocument('cancelled')] });
    issued.lines[0].returnedQty = 3;

    expect(getMaterialIssueLineDisposition(issued, 'line-1')).toEqual({
      openQty: 7,
      pendingReturnQty: 0,
      returnableQty: 7,
      settleableQty: 7,
    });
  });

  it('allows reversal only for an untouched issued document', () => {
    expect(getMaterialIssueReversalEligibility(order())).toEqual({
      eligible: true,
      reasonCode: 'eligible',
    });
    expect(getMaterialIssueReversalEligibility(order({ status: 'draft' }))).toEqual({
      eligible: false,
      reasonCode: 'invalid_status',
    });

    const received = order();
    received.lines[0].receivedQty = 1;
    expect(getMaterialIssueReversalEligibility(received).reasonCode).toBe('already_received');

    const returned = order();
    returned.lines[0].returnedQty = 1;
    expect(getMaterialIssueReversalEligibility(returned).reasonCode).toBe('already_returned');

    const settled = order();
    settled.lines[0].lostQty = 1;
    expect(getMaterialIssueReversalEligibility(settled).reasonCode).toBe('already_settled');

    const pending = order({
      returns: [{
        id: 'return-1',
        issueOrderId: 'order-1',
        returnNo: 'PNH-001',
        returnKind: 'unused_return',
        targetWarehouseId: 'wh-source',
        status: 'pending',
        transactionId: 'tx-import-1',
        reason: 'Vật tư thừa',
        idempotencyKey: 'return-1-key',
        metadata: {},
        createdAt: '2026-09-05T00:00:00.000Z',
        lines: [],
      }],
    });
    expect(getMaterialIssueReversalEligibility(pending).reasonCode).toBe('pending_return');
  });
});
