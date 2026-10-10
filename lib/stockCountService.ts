import { supabase } from './supabase';

// K5 — kiểm kê có duyệt: lập phiên (chụp tồn sổ), đếm (mặc định đếm mù), nộp, giải trình, duyệt ghi sổ.

export type StockCountStatus = 'counting' | 'submitted' | 'posted' | 'cancelled';
export type VarianceReason = 'NATURAL_LOSS' | 'DAMAGE' | 'THEFT' | 'MEASUREMENT' | 'EXPIRED' | 'PROCESS_WASTE'
  | 'UNRECORDED_ISSUE' | 'RECORDING_ERROR' | 'UNRECORDED_RECEIPT' | 'RETURNED_FROM_SITE';

export interface StockCountSummary {
  id: string; countNo: string; warehouseId: string; warehouseName: string; status: StockCountStatus; reason: string; blind: boolean;
  createdAt: string; createdByName: string | null; submittedAt: string | null; postedAt: string | null; rejected: boolean;
  lineCount: number; countedCount: number; varianceCount: number | null; varianceValue: number | null;
}

export interface StockCountLine {
  id: string; itemId: string; name: string; sku: string | null; unit: string | null;
  /** null khi đang đếm mù. */
  snapshotQty: number | null; cacheQtyAtSnapshot: number | null; expectedQty: number | null;
  countedQty: number | null; varianceQty: number | null; varianceReason: VarianceReason | null; note: string | null;
  unitCost: number | null; countedBy: string | null; countedAt: string | null; addedDuringCount: boolean;
  /** V4: đếm theo quy cách (mã có quy cách tại kho). snapshotQty ẩn khi đếm mù. */
  specCounts?: Array<{ specification: string | null; snapshotQty?: number | null; countedQty: number | null; added?: boolean }> | null;
}

export interface StockCountDetail {
  id: string; countNo: string; warehouseId: string; warehouseName: string; status: StockCountStatus; reason: string; blind: boolean;
  revision: number; snapshotAt: string; createdAt: string;
  createdBy: { id: string; name: string | null };
  submittedBy: { id: string; name: string | null; at: string } | null;
  approvedBy: { id: string; name: string | null; at: string } | null;
  cancelled: { name: string | null; at: string; reason: string } | null;
  rejection: { byName: string | null; at: string; reason: string } | null;
  metadata: { openDocsAtStart?: number; openReconciliationsAtStart?: number; scope?: string };
  adjustmentTransactionId: string | null; issueTransactionId: string | null;
  systemVisible: boolean;
  lines: StockCountLine[];
  events: Array<{ action: string; actorName: string | null; at: string; note: string | null; payload: Record<string, unknown> }>;
  can: { count: boolean; explain: boolean; submit: boolean; approve: boolean; reject: boolean; cancel: boolean };
}

export interface StockCountList {
  canApprove: boolean;
  warehouses: Array<{ id: string; name: string; openDocs: number; openReconciliations: number }>;
  counts: StockCountSummary[];
}

const ERRORS: Record<string, string> = {
  STOCK_COUNT_DENIED: 'Chỉ thủ kho của kho này, quản trị kho hoặc Admin được kiểm kê.',
  STOCK_COUNT_APPROVE_DENIED: 'Chỉ Admin hoặc quản trị kho được duyệt kiểm kê.',
  STOCK_COUNT_SAME_PERSON: 'Người lập hoặc người nộp phiên kiểm không tự duyệt được. Nhờ người duyệt khác.',
  STOCK_COUNT_ALREADY_OPEN: 'Kho này đang có một phiên kiểm kê chưa xong. Hoàn tất hoặc hủy phiên đó trước.',
  STOCK_COUNT_WAREHOUSE_REASON_REQUIRED: 'Chọn kho và nhập lý do kiểm kê.',
  STOCK_COUNT_ITEMS_REQUIRED: 'Kho chưa có vật tư nào để kiểm.',
  STOCK_COUNT_NOT_COUNTING: 'Phiên kiểm không còn ở bước đếm. Tải lại.',
  STOCK_COUNT_NOT_SUBMITTED: 'Phiên kiểm không còn chờ duyệt. Tải lại.',
  STOCK_COUNT_NOT_OPEN: 'Phiên kiểm đã ghi sổ hoặc đã hủy.',
  STOCK_COUNT_UNCOUNTED_LINES: 'Còn dòng chưa có số đếm. Nhập đủ rồi nộp.',
  STOCK_COUNT_COUNTS_LOCKED: 'Đã nộp: số đếm đã khóa, chỉ còn giải trình nguyên nhân. Muốn đếm lại thì nhờ người duyệt từ chối.',
  STOCK_COUNT_REASON_REQUIRED: 'Còn dòng chênh lệch chưa có nguyên nhân — người đếm cần giải trình trước.',
  STOCK_COUNT_REASON_DIRECTION: 'Nguyên nhân không hợp chiều chênh lệch (vd. "mất cắp" cho dòng dư). Sửa lại giải trình.',
  STOCK_COUNT_REJECT_REASON_REQUIRED: 'Nhập lý do từ chối để người đếm biết cần làm lại gì.',
  STOCK_COUNT_CANCEL_REASON_REQUIRED: 'Nhập lý do hủy phiên kiểm.',
  STOCK_COUNT_REVISION_CONFLICT: 'Phiên kiểm vừa được người khác cập nhật. Tải lại để xem bản mới.',
  STOCK_COUNT_QTY_INVALID: 'Số đếm phải là số không âm.',
  STOCK_COUNT_LINE_NOT_FOUND: 'Dòng kiểm không còn. Tải lại.',
  STOCK_COUNT_ITEM_INVALID: 'Vật tư không có trong danh mục.',
  STOCK_COUNT_NOT_FOUND: 'Không tìm thấy phiên kiểm hoặc bạn không có quyền xem.',
  INVENTORY_NEGATIVE_STOCK: 'Ghi sổ làm tồn âm (đã xuất sau khi nộp). Từ chối để đếm lại dòng đó.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERRORS).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERRORS[code] : 'Không thực hiện được thao tác kiểm kê. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const stockCountService = {
  list: () => call<StockCountList>('list_stock_counts_v1', { p_filter: {} }),
  get: (id: string) => call<StockCountDetail>('get_stock_count_v1', { p_count_id: id }),
  start: (input: { warehouseId: string; reason: string; blind: boolean }) => call<StockCountDetail>('start_stock_count_v1', { p_input: input }),
  addItem: (input: { countId: string; itemId: string }) => call<StockCountDetail>('add_stock_count_item_v1', { p_input: input }),
  saveLines: (input: { countId: string; lines: Array<{ lineId: string; countedQty?: number | null; varianceReason?: VarianceReason | null; note?: string;
    specCounts?: Array<{ specification: string | null; countedQty: number | null }> }> }) =>
    call<StockCountDetail>('save_stock_count_lines_v1', { p_input: input }),
  submit: (input: { countId: string; revision: number }) => call<StockCountDetail>('submit_stock_count_v1', { p_input: input }),
  decide: (input: { countId: string; revision: number; action: 'approve' | 'reject'; reason?: string }) =>
    call<StockCountDetail>('decide_stock_count_v1', { p_input: input }),
  cancel: (input: { countId: string; reason: string }) => call<StockCountDetail>('cancel_stock_count_v1', { p_input: input }),
};

export const SHORTAGE_REASONS: Array<[VarianceReason, string]> = [
  ['UNRECORDED_ISSUE', 'Đã dùng thi công, chưa lập phiếu xuất'], ['NATURAL_LOSS', 'Hao hụt tự nhiên'], ['DAMAGE', 'Hư hỏng'],
  ['THEFT', 'Thất thoát / mất cắp'], ['EXPIRED', 'Hết hạn / biến chất'], ['PROCESS_WASTE', 'Hao hụt gia công'],
  ['MEASUREMENT', 'Sai lệch đo lường'], ['RECORDING_ERROR', 'Ghi sổ sai trước đây'],
];
export const SURPLUS_REASONS: Array<[VarianceReason, string]> = [
  ['UNRECORDED_RECEIPT', 'Hàng về chưa nhập sổ'], ['RETURNED_FROM_SITE', 'Công trường trả về chưa lập phiếu'],
  ['MEASUREMENT', 'Sai lệch đo lường'], ['RECORDING_ERROR', 'Ghi sổ sai trước đây'],
];
export const REASON_LABEL = Object.fromEntries([...SHORTAGE_REASONS, ...SURPLUS_REASONS]) as Record<VarianceReason, string>;

export const STOCK_COUNT_STATUS_LABEL: Record<StockCountStatus, string> = {
  counting: 'Đang đếm', submitted: 'Chờ duyệt', posted: 'Đã ghi sổ', cancelled: 'Đã hủy',
};
export const STOCK_COUNT_EVENT_LABEL: Record<string, string> = {
  start: 'Lập phiên, chụp tồn sổ', add_item: 'Thêm vật tư ngoài sổ', save: 'Lưu số đếm / giải trình', submit: 'Nộp duyệt',
  reject: 'Từ chối — đếm lại', approve: 'Duyệt, ghi sổ', cancel: 'Hủy phiên',
};
