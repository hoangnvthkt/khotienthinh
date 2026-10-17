import { supabase } from './supabase';
import { uploadTransactionAttachments, cleanupTransactionAttachmentPaths } from './wmsTransactionAttachmentService';
import { foldVi } from './wmsCatalogService';

// Văn phòng phẩm (17/10/2026): Đề xuất → Duyệt (trưởng phòng, duyệt thay, vượt ngưỡng) → Cấp phát ở Kho VPP.
// Máy chủ quyết định ai thấy gì (supabase/migrations/20261018100100_vpp_requests.sql); client chỉ hiển thị cờ `can`.

export type VppStatus = 'pending' | 'pending_threshold' | 'returned' | 'approved' | 'partial' | 'issued' | 'closed' | 'rejected' | 'cancelled';
export type VppView = 'mine' | 'approve' | 'issue' | 'all';

export const VPP_STATUS_LABEL: Record<VppStatus, string> = {
  pending: 'Chờ duyệt', pending_threshold: 'Chờ duyệt vượt ngưỡng', returned: 'Cần sửa', approved: 'Chờ cấp',
  partial: 'Cấp một phần', issued: 'Đã cấp', closed: 'Đã đóng', rejected: 'Từ chối', cancelled: 'Đã hủy',
};
export const VPP_OPEN: VppStatus[] = ['pending', 'pending_threshold', 'returned', 'approved', 'partial'];

export type VppCatalogItem = { itemId: string; sku: string; name: string; unit: string; inStock: boolean };
export type VppUncoded = { name: string; unit: string; times: number };
export type VppHome = {
  warehouseId: string | null; warehouseName: string | null;
  me: { id: string; name: string; orgUnitId: string | null; orgUnitName: string | null; approverName: string | null };
  can: { manage: boolean; report: boolean; keeper: boolean; approve: boolean };
  catalog: VppCatalogItem[]; uncoded: VppUncoded[];
};

export type VppRow = {
  id: string; code: string; status: VppStatus; requesterId: string; requesterName: string; orgUnitName: string | null;
  approverName: string | null; submittedAt: string; updatedAt: string; note: string | null; thresholdRequired: boolean;
  estimatedAmount: number | null; myTurn: boolean; lineCount: number; summary: string | null;
};
export type VppList = { counts: { mine: number; approve: number; issue: number }; rows: VppRow[] };

export type VppLine = {
  id: string; lineNo: number; itemId: string | null; sku: string | null; name: string; unit: string;
  requestedQty: number; approvedQty: number | null; issuedQty: number; returnedQty: number; note: string | null;
  stock: number | null; unitCost: number | null;
};
export type VppEvent = { action: string; at: string; note: string | null; payload: Record<string, unknown>; actorName: string | null; onBehalfOfName: string | null };
export type VppMove = { transactionId: string; type: string; event: string; date: string; code: string | null; reason: string | null };
export type VppDetail = {
  id: string; code: string; status: VppStatus; note: string | null; rowVersion: number;
  warehouseId: string; warehouseName: string; requesterId: string; requesterName: string; orgUnitId: string | null; orgUnitName: string | null;
  approverId: string | null; approverName: string | null; approvedByName: string | null; approvedAt: string | null;
  thresholdRequired: boolean; thresholdApprovedByName: string | null; thresholdApprovedAt: string | null;
  estimatedAmount: number | null; submittedAt: string; updatedAt: string; closedReason: string | null;
  lines: VppLine[]; events: VppEvent[]; moves: VppMove[];
  can: { approve: boolean; onBehalf: boolean; edit: boolean; cancel: boolean; issue: boolean; close: boolean; return: boolean };
};

export type VppDraftLine = { key: string; itemId: string | null; name: string; unit: string; qty: number; note?: string };
export type VppReceiptLine = { key: string; itemId: string | null; name: string; unit: string; qty: number; price: number };
export type VppReceipt = {
  transactionId: string; date: string; supplierName: string | null; invoiceNo: string | null; note: string | null;
  attachments: number; code: string | null; amount: number | null; byName: string | null;
  lines: Array<{ name: string; sku: string | null; unit: string; qty: number; price: number }>;
};
export type VppDepartment = { orgUnitId: string; code: string | null; name: string; members: number; approverId: string | null; deputyId: string | null; suggestedId: string | null };
export type VppSettings = {
  warehouseId: string; thresholdAmount: number; rowVersion: number; thresholdApproverId: string | null; fallbackApproverId: string | null;
  departments: VppDepartment[]; people: Array<{ id: string; name: string }>;
};

export type VppXntRow = {
  itemId: string; sku: string | null; name: string; unit: string;
  openQty: number; inQty: number; outQty: number; closeQty: number;
  openValue: number; inValue: number; outValue: number; closeValue: number; unitPrice: number; note: string | null;
};
export type VppPersonItem = { name: string; unit: string; requestedQty: number; issuedQty: number; value: number };
export type VppPersonRow = { userId: string; name: string | null; orgUnitName: string; requestCount: number; requestedQty: number; issuedQty: number; value: number; items: VppPersonItem[] | null };
export type VppDeptRow = { orgUnitId: string | null; name: string; people: number; requestCount: number; requestedQty: number; issuedQty: number; issuedValue: number; returnedValue: number; value: number };
export type VppPostingLine = { orgUnitId: string | null; name: string; issuedValue: number; returnedValue: number; value: number; requestCount: number; people: number };
export type VppPosting = {
  month: string; liveTotal: number; liveIssued: number; liveReturned: number; closed: boolean;
  allocation: { code: string; status: 'draft' | 'submitted' | 'confirmed' } | null;
  posted: { id: string; code: string; total: number; postedAt: string; postedByName: string | null; note: string | null; lines: VppPostingLine[] | null } | null;
  history: Array<{ code: string; status: string; total: number; postedAt: string; postedByName: string | null; reversedAt: string | null; reversedByName: string | null; reverseReason: string | null }>;
};
export type VppReport = {
  month: string; warehouseId: string; warehouseName: string | null; firstMonth: string | null;
  can: { post: boolean; reverse: boolean };
  totals: { openValue: number; inValue: number; outValue: number; closeValue: number; cost: number; returned: number; requestCount: number; issuedRequestCount: number };
  xnt: VppXntRow[]; people: VppPersonRow[]; departments: VppDeptRow[]; posting: VppPosting;
};

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Phiên đăng nhập đã hết. Đăng nhập lại để tiếp tục.',
  ROW_VERSION_CONFLICT: 'Phiếu vừa được người khác cập nhật. Đã tải lại, kiểm tra rồi làm lại.',
  VPP_REQUEST_NOT_FOUND: 'Không tìm thấy phiếu hoặc bạn không được xem phiếu này.',
  VPP_LINES_REQUIRED: 'Chưa có món nào.',
  VPP_TOO_MANY_LINES: 'Một phiếu tối đa 60 món.',
  VPP_LINE_INVALID: 'Số lượng hoặc tên món chưa hợp lệ.',
  VPP_ITEM_NOT_FOUND: 'Mã VPP đã ngừng dùng. Chọn lại món.',
  VPP_WAREHOUSE_MISSING: 'Chưa thiết lập kho VPP.',
  VPP_REQUEST_LOCKED: 'Phiếu đã được duyệt, không sửa được nữa.',
  VPP_APPROVE_DENIED: 'Bạn không phải người duyệt phiếu này.',
  VPP_REASON_REQUIRED: 'Cần ghi lý do.',
  VPP_APPROVE_EMPTY: 'Phải duyệt ít nhất một món. Muốn bỏ cả phiếu thì bấm Từ chối.',
  VPP_CANCEL_DENIED: 'Chỉ người đề xuất hủy được phiếu chưa cấp.',
  VPP_CLOSE_DENIED: 'Bạn không đóng được phiếu này.',
  VPP_ACTION_INVALID: 'Thao tác không hợp lệ.',
  VPP_ISSUE_DENIED: 'Chỉ thủ kho VPP được cấp phát.',
  VPP_REQUEST_STATE: 'Phiếu không còn ở bước chờ cấp. Đã tải lại.',
  VPP_DATE_FUTURE: 'Ngày chứng từ không được sau hôm nay.',
  VPP_ISSUE_QTY_INVALID: 'Số cấp vượt số còn phải cấp.',
  VPP_ITEM_REQUIRED: 'Món chưa có mã: chọn mã VPP trước khi cấp.',
  VPP_STOCK_SHORT: 'Kho không đủ hàng để cấp',
  VPP_RETURN_DENIED: 'Chỉ thủ kho VPP được nhận trả lại.',
  VPP_RETURN_QTY_INVALID: 'Số trả lại vượt số đã cấp.',
  VPP_RECEIVE_DENIED: 'Chỉ thủ kho VPP được nhập kho VPP.',
  VPP_ATTACHMENT_INVALID: 'Tệp đính kèm không hợp lệ.',
  VPP_MANAGE_DENIED: 'Cần quyền Quản trị VPP.',
  VPP_THRESHOLD_INVALID: 'Ngưỡng tiền chưa hợp lệ.',
  VPP_DEPUTY_SAME: 'Người duyệt thay phải khác người duyệt.',
  VPP_REPORT_DENIED: 'Cần quyền Xem báo cáo VPP, thủ kho VPP hoặc quyền xem Tài chính.',
  VPP_MONTH_INVALID: 'Tháng chưa hợp lệ.',
  VPP_MONTH_OPEN: 'Tháng chưa kết thúc, chưa chốt được.',
  VPP_COST_CHANGED: 'Số liệu vừa thay đổi. Đã tải lại, kiểm tra rồi chốt lại.',
  VPP_POSTING_NOT_FOUND: 'Tháng này chưa có bản chốt. Đã tải lại.',
  VPP_ALLOCATION_LOCKED: 'Phân bổ tháng này đã gửi chốt / đã chốt. Trả lại hoặc đảo phân bổ trước.',
  FINANCE_RECORD_DENIED: 'Cần quyền Tài chính — Ghi nhận.',
};

export const vppErrorMessage = (error: unknown, fallback = 'Chưa thực hiện được. Thử lại sau.') => {
  const e = error as { message?: string; details?: string } | null;
  const code = Object.keys(MESSAGES).find(k => e?.message?.includes(k));
  if (!code) return e?.message && !/^[A-Z_]+$/.test(e.message) ? e.message : fallback;
  return code === 'VPP_STOCK_SHORT' && e?.details ? `${MESSAGES[code]}: ${e.details}.` : MESSAGES[code];
};
export const isVppConflict = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'PT409' || !!e?.message?.includes('ROW_VERSION_CONFLICT') || !!e?.message?.includes('VPP_COST_CHANGED');
};

const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

export const officeSupplyService = {
  home: () => rpc<VppHome>('get_office_supply_home_v1'),
  list: (view: VppView) => rpc<VppList>('list_office_supply_requests_v1', { p: { view } }),
  get: (id: string) => rpc<VppDetail>('get_office_supply_request_v1', { p_id: id }),
  save: (input: { id?: string; expectedRowVersion?: number; note?: string; lines: VppDraftLine[] }) =>
    rpc<VppDetail>('save_office_supply_request_v1', { p: {
      id: input.id, expectedRowVersion: input.expectedRowVersion, note: input.note,
      lines: input.lines.map(l => ({ itemId: l.itemId, name: l.name, unit: l.unit, qty: l.qty, note: l.note })),
    } }),
  act: (input: { id: string; action: 'approve' | 'reject' | 'return' | 'cancel' | 'close'; expectedRowVersion: number; reason?: string | null;
    lines?: Array<{ lineId: string; approvedQty: number }> }) => rpc<VppDetail>('act_office_supply_request_v1', { p: input }),
  issue: (input: { id: string; expectedRowVersion: number; date?: string; lines: Array<{ lineId: string; qty: number; itemId?: string | null }> }) =>
    rpc<VppDetail>('issue_office_supply_v1', { p: input }),
  returnStock: (input: { id: string; reason: string; lines: Array<{ lineId: string; qty: number }> }) =>
    rpc<VppDetail>('return_office_supply_v1', { p: input }),
  receipts: () => rpc<VppReceipt[]>('list_office_supply_receipts_v1', { p: {} }),
  settings: () => rpc<VppSettings>('get_office_supply_settings_v1'),
  saveSettings: (input: { expectedRowVersion: number; thresholdAmount: number; thresholdApproverId: string | null; fallbackApproverId: string | null;
    approvers: Array<{ orgUnitId: string; approverId: string | null; deputyId: string | null }> }) =>
    rpc<VppSettings>('save_office_supply_settings_v1', { p: input }),
  report: (month: string) => rpc<VppReport>('get_office_supply_report_v1', { p: { month } }),
  postCosts: (input: { month: string; expectedTotal: number; reason?: string | null }) => rpc<VppPosting>('post_office_supply_costs_v1', { p: input }),
  reverseCosts: (input: { month: string; reason: string }) => rpc<VppPosting>('reverse_office_supply_costs_v1', { p: input }),

  async attachReceiptFiles(transactionId: string, files: File[], actorUserId: string) {
    const up = await uploadTransactionAttachments({ transactionId, actorUserId, files, existing: [] });
    try { await rpc('attach_office_supply_receipt_files_v1', { p_transaction_id: transactionId, p_attachments: up.attachments }); }
    catch (e) { await cleanupTransactionAttachmentPaths(up.uploadedPaths).catch(() => undefined); throw e; }
  },

  /** Nhập VPP mua về: ghi phiếu nhập rồi gắn ảnh hóa đơn vào đúng phiếu (tệp lỗi thì phiếu vẫn còn, báo để thêm lại). */
  async receive(input: { date: string; supplierName: string; invoiceNo: string; note: string; lines: VppReceiptLine[]; files: File[]; actorUserId: string }) {
    const res = await rpc<{ transactionId: string; code: string | null; newItems: Array<{ sku: string; name: string }> }>('receive_office_supply_v1', { p: {
      date: input.date, supplierName: input.supplierName, invoiceNo: input.invoiceNo, note: input.note,
      lines: input.lines.map(l => ({ itemId: l.itemId, name: l.name, unit: l.unit, qty: l.qty, price: l.price })),
    } });
    let filesError: string | null = null;
    if (input.files.length) {
      let uploaded: string[] = [];
      try {
        const up = await uploadTransactionAttachments({ transactionId: res.transactionId, actorUserId: input.actorUserId, files: input.files, existing: [] });
        uploaded = up.uploadedPaths;
        await rpc('attach_office_supply_receipt_files_v1', { p_transaction_id: res.transactionId, p_attachments: up.attachments });
      } catch (e) {
        filesError = vppErrorMessage(e, 'Chưa tải được ảnh hóa đơn.');
        if (uploaded.length) await cleanupTransactionAttachmentPaths(uploaded).catch(() => undefined);
      }
    }
    return { ...res, filesError };
  },
};

/** Gợi ý khi gõ tên: món có mã trước, rồi tên từng đề xuất mà chưa có mã. Không phân biệt dấu. */
export const searchVpp = (q: string, catalog: VppCatalogItem[], uncoded: VppUncoded[], limit = 12) => {
  const words = foldVi(q.trim()).split(/\s+/).filter(Boolean);
  const hit = (text: string) => { const t = foldVi(text); return words.every(w => t.includes(w)); };
  if (!words.length) return { coded: [] as VppCatalogItem[], uncoded: [] as VppUncoded[] };
  const coded = catalog.filter(c => hit(`${c.name} ${c.sku}`))
    .sort((a, b) => Number(foldVi(b.name).startsWith(words[0])) - Number(foldVi(a.name).startsWith(words[0])) || a.name.localeCompare(b.name, 'vi'))
    .slice(0, limit);
  const codedNames = new Set(catalog.map(c => foldVi(c.name)));
  return { coded, uncoded: uncoded.filter(u => hit(u.name) && !codedNames.has(foldVi(u.name))).slice(0, 5) };
};

export const qtyText = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
