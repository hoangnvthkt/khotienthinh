import type {
  MaterialIssueLineDisposition,
  MaterialIssueOrder,
  MaterialIssueReversalEligibility,
} from '../types';

const positiveNumber = (value: unknown): number => Math.max(Number(value) || 0, 0);

export const getMaterialIssueLineDisposition = (
  order: MaterialIssueOrder,
  issueLineId: string,
): MaterialIssueLineDisposition => {
  const line = order.lines.find(item => item.id === issueLineId);
  if (!line) throw new Error(`Không tìm thấy dòng xuất cấp ${issueLineId}.`);

  const openQty = Math.max(
    positiveNumber(line.issuedQty)
      - positiveNumber(line.returnedQty)
      - positiveNumber(line.consumedQty)
      - positiveNumber(line.lostQty),
    0,
  );
  const pendingReturnQty = (order.returns || [])
    .filter(materialReturn => materialReturn.status === 'pending')
    .flatMap(materialReturn => materialReturn.lines || [])
    .filter(returnLine => returnLine.issueLineId === issueLineId)
    .reduce((total, returnLine) => total + positiveNumber(returnLine.returnQty), 0);
  const returnableQty = Math.max(openQty - pendingReturnQty, 0);

  return {
    openQty,
    pendingReturnQty,
    returnableQty,
    settleableQty: returnableQty,
  };
};

const ineligible = (
  reasonCode: Exclude<MaterialIssueReversalEligibility['reasonCode'], 'eligible'>,
): MaterialIssueReversalEligibility => ({ eligible: false, reasonCode });

export const getMaterialIssueReversalEligibility = (
  order: MaterialIssueOrder,
): MaterialIssueReversalEligibility => {
  if (order.status !== 'issued') return ineligible('invalid_status');
  if (order.lines.length === 0 || order.lines.some(line => positiveNumber(line.issuedQty) <= 0)) {
    return ineligible('no_issued_quantity');
  }
  if (
    order.lines.some(line => positiveNumber(line.receivedQty) > 0)
    || (order.receipts || []).some(receipt => receipt.status === 'confirmed')
  ) {
    return ineligible('already_received');
  }
  if (
    order.lines.some(line => positiveNumber(line.returnedQty) > 0)
    || (order.returns || []).some(materialReturn => materialReturn.status === 'completed')
  ) {
    return ineligible('already_returned');
  }
  if (
    order.lines.some(line => positiveNumber(line.consumedQty) > 0 || positiveNumber(line.lostQty) > 0)
    || (order.settlements || []).some(settlement => settlement.status === 'posted')
  ) {
    return ineligible('already_settled');
  }
  if ((order.returns || []).some(materialReturn => materialReturn.status === 'pending')) {
    return ineligible('pending_return');
  }
  return { eligible: true, reasonCode: 'eligible' };
};
