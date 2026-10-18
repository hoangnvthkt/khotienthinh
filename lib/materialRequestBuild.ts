// Dựng phiếu đề xuất vật tư từ các dòng nháp — dùng chung cho form Đề xuất (RequestModal) và form gọn trong khung chat Trợ lý
// (chủ SP 18/10/2026: đủ ngữ cảnh thì sửa + gửi ngay trong chat). Một chỗ dựng để hai nơi không lệch nhau. Không gọi máy chủ.
import { MaterialRequestFulfillmentMode, RequestStatus, type MaterialRequest, type MaterialRequestMaterialGroupSnapshotData, type RequestItem } from '../types';
import { parseNonNegativeLocaleNumber } from './localeNumberInput';

export type MaterialRequestLineDraft = {
  lineId: string;
  itemId: string;
  qty: number | string;
  workBoqItemId?: string | null;
  workBoqItemName?: string | null;
  materialBudgetItemId?: string | null;
  materialBudgetItemName?: string | null;
  neededDate?: string;
  note?: string;
  overBudgetReason?: string;
  isManualItem?: boolean;
  itemNameSnapshot?: string;
  unitSnapshot?: string;
  skuSnapshot?: string;
  specification?: string;
  manualReason?: string;
  materialGroupKey?: string | null;
  materialGroupSource?: 'summary_aggregate' | string | null;
  materialGroupSnapshot?: MaterialRequestMaterialGroupSnapshotData | null;
};

/** Số liệu BOQ chụp lại theo dòng lúc lập phiếu (form tính từ BOQ của dự án). */
export interface LineBudgetValues {
  budget?: { itemName?: string; unit?: string };
  budgetQty: number;
  reservedBeforeQty: number;
  previousRequested: number;
  overBudgetQty: number;
  overBudgetPercent: number;
}
/** Dòng ngoài BOQ: không có định mức nên mọi số chụp là 0 (đúng như form tính cho dòng không gắn BOQ). */
export const OUTSIDE_BOQ_BUDGET: LineBudgetValues = { budgetQty: 0, reservedBeforeQty: 0, previousRequested: 0, overBudgetQty: 0, overBudgetPercent: 0 };

type InventoryLike = { name?: string; unit?: string; sku?: string } | undefined;

export const toRequestItem = (i: MaterialRequestLineDraft, snapshot: LineBudgetValues, inventory?: InventoryLike, workName?: string | null): RequestItem => {
  const overReason = i.overBudgetReason || undefined;
  return {
    lineId: i.lineId,
    itemId: i.itemId,
    requestQty: parseNonNegativeLocaleNumber(i.qty),
    approvedQty: 0,
    workBoqItemId: i.workBoqItemId || null,
    workBoqItemName: i.workBoqItemName || workName || null,
    materialBudgetItemId: i.materialBudgetItemId || null,
    materialBudgetItemName: i.materialBudgetItemName || snapshot.budget?.itemName || null,
    neededDate: i.neededDate || undefined,
    note: i.note || undefined,
    budgetQtySnapshot: snapshot.budgetQty,
    reservedBeforeQtySnapshot: snapshot.reservedBeforeQty,
    previousRequestedQtySnapshot: snapshot.previousRequested,
    isOverBoq: snapshot.overBudgetQty > 0,
    overQty: snapshot.overBudgetQty,
    overPercent: snapshot.overBudgetPercent,
    overReason,
    overBudgetQtySnapshot: snapshot.overBudgetQty,
    overBudgetPercentSnapshot: snapshot.overBudgetPercent,
    overBudgetReason: overReason,
    isManualItem: i.isManualItem || false,
    itemNameSnapshot: i.itemNameSnapshot || inventory?.name || snapshot.budget?.itemName || undefined,
    unitSnapshot: i.unitSnapshot || inventory?.unit || snapshot.budget?.unit || undefined,
    skuSnapshot: i.skuSnapshot || inventory?.sku || undefined,
    specification: i.specification?.trim() || undefined,
    manualReason: i.manualReason || undefined,
    materialGroupKey: i.materialGroupKey || undefined,
    materialGroupSource: i.materialGroupSource || undefined,
    materialGroupSnapshot: i.materialGroupSnapshot || undefined,
  };
};

export interface MaterialRequestRecordInput {
  /** Phiếu đang sửa (nháp cũ) — giữ các trường đã có. */
  base?: MaterialRequest;
  code: string;
  title: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  requestOrigin: 'project' | 'wms';
  siteWarehouseId: string;
  sourceWarehouseId?: string;
  requesterId: string;
  workflowPatch: Partial<MaterialRequest>;
  now: string;
  expectedDate?: string;
  note?: string;
  fulfillmentMode: MaterialRequestFulfillmentMode;
  items: RequestItem[];
  userId: string;
}

/** Phiếu ở trạng thái Nháp (lưu nháp, hoặc bước đầu trước khi gửi duyệt). */
export const toMaterialRequestRecord = (p: MaterialRequestRecordInput): MaterialRequest => {
  const isExistingDraft = !!p.base && p.base.status === RequestStatus.DRAFT;
  return {
    ...(p.base || {}),
    id: p.base?.id || `mr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    code: p.code,
    title: p.title.trim() || p.base?.title || 'Đề xuất vật tư',
    projectId: p.projectId,
    constructionSiteId: p.constructionSiteId,
    requestOrigin: p.requestOrigin,
    siteWarehouseId: p.siteWarehouseId,
    sourceWarehouseId: p.sourceWarehouseId || undefined,
    requesterId: p.base?.requesterId || p.requesterId,
    status: RequestStatus.DRAFT,
    submittedToUserId: null,
    submittedToName: null,
    submittedToPermission: null,
    submissionNote: null,
    ...p.workflowPatch,
    createdDate: p.base?.createdDate || p.now,
    expectedDate: p.expectedDate || new Date(Date.now() + 86400000 * 3).toISOString(),
    note: p.note,
    fulfillmentMode: p.fulfillmentMode,
    items: p.items,
    logs: [
      ...(p.base?.logs || []),
      { action: isExistingDraft ? 'UPDATED_DRAFT' : 'CREATED_DRAFT', userId: p.userId, timestamp: p.now },
    ],
  };
};
