import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../pages/project/SupplyChainTab.tsx', import.meta.url),
  'utf8',
);
const cockpitPath = new URL('../../components/project/PurchaseOrderCockpitDrawer.tsx', import.meta.url);
const cockpitSource = existsSync(cockpitPath) ? readFileSync(cockpitPath, 'utf8') : '';
const combinedSource = `${source}\n${cockpitSource}`;

describe('purchase order drawer regression guard', () => {
  it('opens purchase order details in the right drawer instead of expanding rows in the list', () => {
    expect(source).toContain('const [selectedPoId, setSelectedPoId]');
    expect(combinedSource).toContain('fixed inset-0 z-[1000]');
    expect(combinedSource).toContain('max-w-[min(1320px,calc(100vw-24px))]');
    expect(source).toContain('const openPoDetail = (po: PurchaseOrder) => {');
    expect(source).toContain('setSelectedPoId(po.id);');
    expect(source).toContain('PurchaseOrderCockpitDrawer');

    expect(source).not.toContain('const [expandedPoId, setExpandedPoId]');
    expect(source).not.toContain('const togglePoExpanded');
    expect(source).not.toContain('onClick={() => togglePoExpanded(po)}');
  });

  it('renders the PO cockpit with tabs and a dedicated action sidebar', () => {
    expect(combinedSource).toContain('PO_DETAIL_TABS');
    expect(combinedSource).toContain('role="tab"');
    expect(combinedSource).toContain('Việc cần làm');
    expect(combinedSource).toContain('Tổng quan');
    expect(combinedSource).toContain('Hàng hóa');
    expect(combinedSource).toContain('Đợt giao');
    expect(combinedSource).toContain('Chứng từ');
    expect(combinedSource).toContain('Lịch sử');

    expect(combinedSource).not.toContain('Thao tác phê duyệt & trạng thái');
  });

  it('keeps material lines visible inside the goods tab instead of a collapsed description table', () => {
    expect(combinedSource).toContain('po-items-table');
    expect(combinedSource).toContain('SL đặt');
    expect(combinedSource).toContain('Đã nhận');
    expect(combinedSource).toContain('Còn thiếu');

    expect(source).not.toContain('const [isPoItemsExpanded, setIsPoItemsExpanded]');
    expect(source).not.toContain('aria-expanded={isPoItemsExpanded}');
    expect(source).not.toContain('const [isPoMetaExpanded, setIsPoMetaExpanded]');
    expect(source).not.toContain('aria-expanded={isPoMetaExpanded}');
  });

  it('renders PO unit prices with decimal precision when needed', () => {
    expect(cockpitSource).toContain('const fmtUnitPrice =');
    expect(cockpitSource).toContain('maximumFractionDigits: 3');
    expect(cockpitSource).toContain('{fmtUnitPrice(lineAmount.unitPrice)}');
  });

  it('renders supplemental delivery groups in the delivery tab even without schedule batches', () => {
    expect(cockpitSource).toContain('deliveryTimelineGroups');
    expect(cockpitSource).toContain("source: 'print_group'");
    expect(cockpitSource).toContain('deliveryTimelineGroups.length === 0');
    expect(cockpitSource).not.toContain('deliveryBatches.length === 0 ? (');
  });

  it('reloads delivery groups immediately after a supplemental delivery draft is submitted', () => {
    expect(source).toContain('await loadPoDeliveryPrintGroups(deliveryPo, true);');
  });

  it('keeps the WMS/QR action available for proactive planned delivery batches', () => {
    expect(cockpitSource).toContain("['confirmed', 'in_transit'].includes(po.status)");
    expect(cockpitSource).toContain("batch.status === 'planned'");
    expect(cockpitSource).not.toContain("po.sourceMode === 'from_request' &&");
  });

  it('routes practical PO approval and delivery drafts through neutral commands', () => {
    expect(source).toContain("case 'approve_package':");
    expect(source).toContain('purchasePackageService.approveSingle');
    expect(source).toContain('purchasePackageService.submitBatch');
    expect(source).toContain('purchasePackageService.approveBatch');
    expect(source).toContain('result?.delivery?.wmsTransactionId');
    expect(source).toContain('refreshWmsRecords({ transactionIds: [result.delivery.wmsTransactionId] })');
    expect(source).toContain('existingBatches={poDeliveryBatchesByPo[packageDeliveryEditor.po.id] || []}');
  });

  it('renders a real delivery QR instead of falling back to a token toast', () => {
    expect(source).toContain('purchaseDeliveryQrPreview');
    expect(source).toContain('buildPurchaseDeliveryReceiveUrl');
    expect(source).toContain('<QRCodeSVG value={purchaseDeliveryQrPreview.url}');
    expect(source).not.toContain("toast.info('QR đợt giao', action.qrToken ? `Token: ${action.qrToken}` : 'Đợt giao chưa có WMS/QR đang tải.');");
  });

  it('prints delivery approval requests with the delivery batch amount instead of the package total', () => {
    expect(source).toContain('totalAmountOverride: getDeliveryPrintGroupSummary(po, group).totalAmount');
    expect(source).toContain('buildPurchaseOrderApprovalDeliveryBatches(printablePo, approvalGroups)');
    expect(source).toContain('const latestSchedules = await poDeliveryScheduleService.listByPurchaseOrderIds([po.id]);');
    expect(source).toContain('const approvalGroups = await loadPoDeliveryPrintGroups(po, true);');
    expect(source).toContain('vatRateOverride: normalizeVatRate(group.scheduleBatch?.vatRate ?? po.vatRate)');
    expect(source).toContain('ĐỀ NGHỊ DUYỆT ĐỢT GIAO');
  });
});
