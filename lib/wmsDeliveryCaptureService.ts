import { supabase } from './supabase';
import { WMS_ATTACHMENT_BUCKET } from './wmsTransactionAttachmentService';
import { formatQuantityInput } from './quantityInput';

// Kho Đợt 1 — Chụp phiếu giao NCC: lưu ảnh + số liệu ngay ở cổng kho, AI (nếu bật) điền sẵn, khớp đơn mua rồi nhận theo xe.

export interface CaptureLine { name: string; unit: string | null; qty: number | null; note?: string | null; confidence?: 'high' | 'low' }
export interface CapturePhoto { path: string; name: string; size: number; mimeType: string }
export interface CaptureAi { provider?: string; model?: string; readAt?: string; result?: { warnings?: string[]; lines?: CaptureLine[] }; error?: string }
export interface DeliveryCapture {
  id: string; warehouseId: string; status: 'new' | 'read' | 'received' | 'discarded';
  supplierName: string | null; docNo: string | null; docDate: string | null; docTime: string | null; truckNo: string | null;
  lines: CaptureLine[]; photos: CapturePhoto[]; ai: CaptureAi | null; note: string | null;
  supplierId?: string | null; supplierMatch?: 'auto' | 'picked' | 'new' | null; supplierPartnerName?: string | null;
  supplierTaxCode?: string | null; supplierAddress?: string | null; hotPurchaseId?: string | null;
  purchaseOrderId: string | null; poNumber: string | null; deliveryBatchId: string | null; wmsTransactionId: string | null; code: string | null;
  createdBy: string | null; createdAt: string; receivedAt: string | null; receivedBy: string | null; deliveryNo?: number;
}
export interface CapturePoLine { poLineId: string; itemId: string; itemName: string; specification: string | null; unit: string | null; ordered: number | null; remaining: number; price: number | null }
export interface CaptureMatchLine extends Partial<CapturePoLine> { captureIndex: number; score: number; learned?: boolean }
export interface CaptureSuggestion {
  purchaseOrderId: string; poNumber: string; status: string; approved: boolean; vendorName: string; createdAt: string;
  supplierScore: number; score: number; lines: CaptureMatchLine[]; poLines: CapturePoLine[];
  /** po = đơn PO, contract = gọi hàng theo HĐ nguyên tắc, hot = Mua nóng đã mua (nhận cả phiếu theo số đã duyệt). */
  kind?: 'po' | 'contract' | 'hot'; contractCode?: string | null;
}
export type CaptureSavePatch = Partial<Pick<DeliveryCapture, 'supplierName' | 'docNo' | 'docDate' | 'docTime' | 'truckNo' | 'lines' | 'photos' | 'note'
  | 'supplierId' | 'supplierTaxCode' | 'supplierAddress'>> & { supplierMatch?: 'new' };
/** NCC gợi ý cho phiếu: tax = MST trùng, learned = tên đã học, name = giống tên, search = thủ kho tìm. */
export interface CaptureSupplierOption { id: string; name: string; taxCode: string | null; address: string | null; score: number; reason: 'tax' | 'learned' | 'name' | 'search'; openOrders: number }
export type CaptureReadResult = { code: 'OK'; capture: DeliveryCapture } | { code: 'AI_NOT_CONFIGURED' } | { code: 'AI_FAILED'; error: string };

const ERRORS: Record<string, string> = {
  CAPTURE_DENIED: 'Chỉ thủ kho của kho này hoặc Admin thao tác được phiếu giao.',
  CAPTURE_LOCKED: 'Phiếu giao này đã nhận hoặc đã bỏ.',
  CAPTURE_NOT_FOUND: 'Không tìm thấy phiếu giao.',
  CAPTURE_WAREHOUSE_REQUIRED: 'Chọn kho nhận hàng.',
  CAPTURE_REASON_REQUIRED: 'Nhập lý do bỏ phiếu.',
  CAPTURE_PO_INVALID: 'Đơn này không giao về kho của phiếu.',
  CAPTURE_PO_NOT_APPROVED: 'Đơn đang chờ duyệt — Mua hàng duyệt xong mới nhận được.',
  CAPTURE_DUPLICATE: 'Phiếu giao này (cùng số phiếu, xe, ngày) đã nhận vào đơn rồi.',
  CAPTURE_PO_LINE_INVALID: 'Dòng đơn không còn trong đơn — tải lại gợi ý.',
  CAPTURE_LINES_REQUIRED: 'Chưa có dòng nào có số lượng nhận.',
  HOT_PURCHASE_STATE: 'Mua nóng chưa ở bước Đã mua — chưa nhận được.',
  HOT_PURCHASE_OVERRUN_PENDING: 'Mua nóng vượt số duyệt, chờ CHT xác nhận.',
  HOT_PURCHASE_RECEIVE_KEEPER_REQUIRED: 'Cần quyền thủ kho của kho nhận để nhập Mua nóng.',
  HOT_PURCHASE_DENIED: 'Bạn chưa có quyền nhận Mua nóng này.',
  PARTNER_NAME_REQUIRED: 'Nhập tên NCC.',
  PROCUREMENT_VIEW_DENIED: 'Bạn chưa có quyền xem Mua hàng.',
  CAPTURE_SUPPLIER_INVALID: 'NCC không còn trong danh mục — chọn lại.',
  CAPTURE_PAYLOAD_INVALID: 'Dữ liệu phiếu không hợp lệ.',
  CAPTURE_NO_PHOTO: 'Phiếu chưa có ảnh.',
  PHOTO_READ_FAILED: 'Không mở được ảnh phiếu.',
  PHOTO_TOO_LARGE: 'Ảnh quá lớn (trên 8 MB).',
  AI_BAD_JSON: 'AI trả kết quả không đúng dạng.',
  AI_PDF_UNSUPPORTED: 'Kết nối AI này chưa đọc PDF — chụp ảnh phiếu.',
  AI_MODEL_REQUIRED: 'Kết nối AI chưa chọn model.',
  AI_HTTP_401: 'Sai khóa AI — kiểm tra ở Cài đặt → Kết nối.',
  AI_HTTP_402: 'Hết credit nhà cung cấp AI.',
  AI_HTTP_429: 'Nhà cung cấp AI đang giới hạn — thử lại sau.',
  AI_REFUSED: 'AI từ chối đọc ảnh này.',
  AI_EMPTY: 'AI không trả kết quả.',
  AI_FAILED: 'AI chưa đọc được phiếu.',
  AI_CONNECTION_LOST: 'Mất kết nối khi AI đang đọc — bấm Đọc lại.',
};

export const captureErrorMessage = (e: unknown, fallback = 'Chưa lưu được phiếu giao.') => {
  const msg = (e as { message?: string })?.message || '';
  const over = msg.match(/CAPTURE_OVER_REMAINING: (.+)$/);
  if (over) return `Vượt phần đơn chưa giao: ${over[1]}.`;
  const code = Object.keys(ERRORS).find(k => msg.includes(k));
  return code ? ERRORS[code] : msg || fallback;
};

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(captureErrorMessage(error));
  return data as T;
};

/** Ảnh chụp điện thoại thường 3–12 MB: thu về cạnh dài 2000 px JPEG (vẫn đọc rõ chữ nhỏ trên phiếu). PDF giữ nguyên. */
export const prepareCapturePhoto = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không đọc được ảnh.'));
      el.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.type === 'image/jpeg' && file.size <= 2.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } finally { URL.revokeObjectURL(url); }
};

const safeName = (name: string) => name.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'phieu.jpg';
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Sau khi mất kết nối: hỏi lại phiếu vài lần, AI đã lưu kết quả mới hơn lúc bấm đọc thì dùng luôn. */
const waitForRead = async (capture: DeliveryCapture, since: number, tries = 6, gapMs = 5000): Promise<DeliveryCapture | null> => {
  for (let i = 0; i < tries; i++) {
    await new Promise(resolve => setTimeout(resolve, gapMs));
    try {
      const { data } = await supabase.rpc('list_delivery_captures_v1', { p: { warehouseId: capture.warehouseId } });
      const fresh = ((data || []) as DeliveryCapture[]).find(c => c.id === capture.id);
      const readAt = fresh?.ai?.readAt ? Date.parse(fresh.ai.readAt) : 0;
      if (fresh && readAt >= since - 60_000 && readAt > (capture.ai?.readAt ? Date.parse(capture.ai.readAt) : 0)) return fresh;
    } catch { /* mạng vẫn chập chờn: thử lần sau */ }
  }
  return null;
};

/** Mua hàng nhận phiếu giao chờ: supplier = cần tạo / chọn NCC, order = đã biết NCC nhưng chưa có đơn mở về kho. */
export type CaptureQueueItem = DeliveryCapture & { queue: 'supplier' | 'order'; warehouseName: string };
export interface CaptureQueue { canManage: boolean; today: string; items: CaptureQueueItem[] }
/** Tạo NCC trùng với NCC đang có (MST trùng / tên rất giống) — Mua hàng chọn NCC đó hoặc vẫn tạo. */
export class PartnerDuplicateError extends Error {
  constructor(public partner: { id: string; name: string; reason: 'tax' | 'learned' | 'name' }) { super('PARTNER_DUPLICATE'); }
}

export const wmsDeliveryCaptureService = {
  list: (warehouseId?: string) => rpc<DeliveryCapture[]>('list_delivery_captures_v1', { p: warehouseId ? { warehouseId } : {} }),
  create: (warehouseId: string) => rpc<DeliveryCapture>('save_delivery_capture_v1', { p: { newId: uid(), warehouseId } }),
  save: (id: string, patch: CaptureSavePatch) => rpc<DeliveryCapture>('save_delivery_capture_v1', { p: { id, ...patch } }),
  discard: (id: string, reason: string) => rpc<DeliveryCapture>('discard_delivery_capture_v1', { p: { id, reason } }),
  suppliers: (captureId: string, q?: string) => rpc<CaptureSupplierOption[]>('suggest_capture_suppliers_v1', { p: q ? { captureId, q } : { captureId } }),
  receiveHot: (captureId: string, hotPurchaseId: string) => rpc<DeliveryCapture>('receive_capture_hot_v1', { p: { captureId, hotPurchaseId } }),
  queue: () => rpc<CaptureQueue>('list_capture_queue_v1', {}),
  resolveSupplier: (captureId: string, supplierId: string) => rpc<DeliveryCapture & { linked: number }>('resolve_capture_supplier_v1', { p: { captureId, supplierId } }),
  async createSupplier(input: { captureId: string; name: string; taxCode?: string; address?: string; force?: boolean }): Promise<DeliveryCapture & { linked: number; partnerCode: string }> {
    const { data, error } = await supabase.rpc('create_supplier_from_capture_v1', { p: input });
    if (error) {
      if (error.message?.includes('PARTNER_DUPLICATE')) {
        let partner = { id: '', name: '', reason: 'name' as const };
        try { partner = JSON.parse(error.details || '{}'); } catch { /* chi tiết hỏng: báo chung */ }
        throw new PartnerDuplicateError(partner);
      }
      throw new Error(captureErrorMessage(error));
    }
    return data as DeliveryCapture & { linked: number; partnerCode: string };
  },
  suggest: (id: string) => rpc<CaptureSuggestion[]>('suggest_capture_orders_v1', { p_capture_id: id }),
  receive: (input: { captureId: string; purchaseOrderId: string; lines: Array<{ captureIndex: number; poLineId: string; qty: number }> }) =>
    rpc<DeliveryCapture>('receive_capture_v1', { p: input }),

  /** Tải ảnh vào thư mục cap-<id>/ rồi ghi vào phiếu. Lỗi giữa chừng thì xóa ảnh đã tải. */
  async addPhotos(capture: DeliveryCapture, files: File[]): Promise<DeliveryCapture> {
    const added: CapturePhoto[] = [];
    try {
      for (const raw of files) {
        const file = await prepareCapturePhoto(raw);
        if (file.size > 8 * 1024 * 1024) throw new Error(`${raw.name} quá 8 MB.`);
        const path = `cap-${capture.id}/${uid()}-${safeName(file.name)}`;
        const { error } = await supabase.storage.from(WMS_ATTACHMENT_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
        if (error) throw new Error(captureErrorMessage(error, 'Chưa tải được ảnh.'));
        added.push({ path, name: file.name, size: file.size, mimeType: file.type || 'image/jpeg' });
      }
      return await wmsDeliveryCaptureService.save(capture.id, { photos: [...capture.photos, ...added] });
    } catch (e) {
      if (added.length) await supabase.storage.from(WMS_ATTACHMENT_BUCKET).remove(added.map(p => p.path)).catch(() => undefined);
      throw e;
    }
  },

  async removePhoto(capture: DeliveryCapture, path: string): Promise<DeliveryCapture> {
    const next = await wmsDeliveryCaptureService.save(capture.id, { photos: capture.photos.filter(p => p.path !== path) });
    await supabase.storage.from(WMS_ATTACHMENT_BUCKET).remove([path]).catch(() => undefined);
    return next;
  },

  /** Gộp phiếu nguồn vào phiếu đích như trang tiếp theo: ảnh + dòng hàng nối vào, ô trống của đích lấy từ nguồn; phiếu nguồn bỏ. */
  async merge(target: DeliveryCapture, source: DeliveryCapture): Promise<DeliveryCapture> {
    const next = await wmsDeliveryCaptureService.save(target.id, {
      photos: [...target.photos, ...source.photos], lines: [...target.lines, ...source.lines],
      supplierName: target.supplierName || source.supplierName, docNo: target.docNo || source.docNo, docDate: target.docDate || source.docDate,
      truckNo: target.truckNo || source.truckNo,
    });
    await wmsDeliveryCaptureService.discard(source.id, `Gộp trang vào phiếu ${target.docNo || target.id.slice(0, 8)}`);
    return next;
  },

  /** Tách một ảnh thành phiếu giao riêng (ảnh giữ nguyên chỗ lưu). Trả phiếu hiện tại sau khi bỏ ảnh + phiếu mới. */
  async split(capture: DeliveryCapture, path: string): Promise<{ current: DeliveryCapture; created: DeliveryCapture }> {
    const photo = capture.photos.find(p => p.path === path);
    if (!photo) throw new Error('Không thấy ảnh.');
    const fresh = await wmsDeliveryCaptureService.create(capture.warehouseId);
    const created = await wmsDeliveryCaptureService.save(fresh.id, { photos: [photo] });
    const current = await wmsDeliveryCaptureService.save(capture.id, { photos: capture.photos.filter(p => p.path !== path) });
    return { current, created };
  },

  async photoUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage.from(WMS_ATTACHMENT_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw new Error('Không mở được ảnh.');
    return data.signedUrl;
  },

  /** AI đọc ảnh (máy chủ chọn nhà cung cấp AI). Chưa cấu hình khóa → AI_NOT_CONFIGURED, thủ kho nhập tay. */
  async read(capture: DeliveryCapture): Promise<CaptureReadResult> {
    const startedAt = Date.now();
    const { data, error } = await supabase.functions.invoke('wms-doc-reader', { body: { captureId: capture.id } });
    if (error) {
      // Đứt mạng / máy chủ đang triển khai lại (16/10: "Failed to send a request to the Edge Function"): máy chủ có thể vẫn đọc xong và đã lưu.
      if (error.name === 'FunctionsFetchError') {
        const saved = await waitForRead(capture, startedAt);
        return saved ? { code: 'OK', capture: saved } : { code: 'AI_FAILED', error: ERRORS.AI_CONNECTION_LOST };
      }
      const ctx = (error as { context?: Response }).context;
      let code = '';
      try { code = (await ctx?.clone?.().json?.())?.error || ''; } catch { code = ''; }
      // Chỉ 404 không kèm mã lỗi (hàm chưa triển khai) mới là "chưa bật AI"; 404 CAPTURE_NOT_FOUND… là lỗi thật, phải báo.
      if (ctx?.status === 404 && !code) return { code: 'AI_NOT_CONFIGURED' };
      return { code: 'AI_FAILED', error: captureErrorMessage(code ? new Error(code) : error, 'AI chưa đọc được phiếu.') };
    }
    const out = data as { code?: string; capture?: DeliveryCapture; error?: string };
    if (out?.code === 'OK' && out.capture) return { code: 'OK', capture: out.capture };
    if (out?.code === 'AI_NOT_CONFIGURED') return { code: 'AI_NOT_CONFIGURED' };
    return { code: 'AI_FAILED', error: captureErrorMessage(new Error(out?.error || ''), 'AI chưa đọc được phiếu.') };
  },
};

/** Gán sẵn dòng phiếu → dòng đơn theo gợi ý. Nhiều dòng phiếu có thể vào cùng một dòng đơn (NCC tách dòng) — máy chủ cộng dồn. */
export const initialMapping = (capture: DeliveryCapture, s: CaptureSuggestion): Array<{ poLineId: string; qty: string }> =>
  capture.lines.map((line, i) => {
    const poLineId = s.lines.find(l => l.captureIndex === i)?.poLineId || '';
    return { poLineId, qty: poLineId && line.qty != null ? formatQuantityInput(line.qty) : '' };
  });
