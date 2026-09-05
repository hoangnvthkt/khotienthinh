import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(
  join(process.cwd(), 'components/project/MaterialIssuePanel.tsx'),
  'utf8',
);

describe('MaterialIssuePanel reversal and safe-return contract', () => {
  it('renders the reversed terminal status and guarded approval-reversal action', () => {
    expect(panel).toContain("reversed: { label: 'Đã đảo'");
    expect(panel).toContain("type ActionType = 'receipt' | 'return' | 'consume' | 'loss' | 'cancel' | 'approval_reversal'");
    expect(panel).toContain('getMaterialIssueReversalEligibility(order)');
    expect(panel).toContain('canReverseWmsTransaction(user, order.sourceWarehouseId)');
    expect(panel).toContain('Hủy duyệt - hàng chưa giao');
    expect(panel).toContain('Hàng chưa rời kho');
    expect(panel).toContain('type="checkbox"');
  });

  it('uses reserved return disposition for list columns and action maximums', () => {
    expect(panel).toContain('getMaterialIssueLineDisposition(order, line.id)');
    expect(panel).toContain('Đang chờ hoàn');
    expect(panel).toContain('Có thể hoàn');
    expect(panel).toContain('disposition.returnableQty');
    expect(panel).toContain('disposition.settleableQty');
    expect(panel).toContain('max={maxQty}');
  });

  it('keeps returns at the source warehouse and explains the WMS completion boundary', () => {
    expect(panel).toContain('Kho nhận hoàn (cố định theo kho xuất)');
    expect(panel).toContain('readOnly');
    expect(panel).toContain('Chờ WMS kiểm nhận - chưa cộng tồn');
    expect(panel).not.toContain('onChange={event => setReturnWarehouseId(event.target.value)}');
  });

  it('keeps stable idempotency keys and refreshes the reversal transaction', () => {
    expect(panel).toContain('materialIssueService.reverseApproval({');
    expect(panel).toContain('idempotencyKey: actionIdempotencyKey');
    expect(panel).toContain("item.returnKind === 'approval_reversal'");
    expect(panel).toContain('touchedTransactionIds.push(approvalReversal.transactionId)');
  });

  it('renders return and reversal document history with audit details', () => {
    expect(panel).toContain('Lịch sử nhập hoàn / đảo phiếu');
    expect(panel).toContain("materialReturn.returnKind === 'approval_reversal'");
    expect(panel).toContain('materialReturn.transactionId');
    expect(panel).toContain('materialReturn.createdBy');
    expect(panel).toContain('materialReturn.completedBy');
    expect(panel).toContain('materialReturn.reason');
  });
});
