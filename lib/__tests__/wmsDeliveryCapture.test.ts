import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_SCHEMA, normalizeRead } from '../../supabase/functions/wms-doc-reader/prompt';
import { captureErrorMessage, initialMapping, type CaptureSuggestion, type DeliveryCapture } from '../wmsDeliveryCaptureService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261012213000_wms_delivery_capture.sql');

const capture = (lines: DeliveryCapture['lines']): DeliveryCapture => ({
  id: 'c1', warehouseId: 'wh-1', status: 'read', supplierName: 'Poshaco', docNo: '007/10', docDate: '2026-10-08', docTime: null, truckNo: '29CD-00280',
  lines, photos: [], ai: null, note: null, purchaseOrderId: null, poNumber: null, deliveryBatchId: null, wmsTransactionId: null, code: null,
  createdBy: null, createdAt: '2026-10-08T02:00:00Z', receivedAt: null, receivedBy: null,
});
const poLine = (poLineId: string, remaining: number) => ({ poLineId, itemId: `it-${poLineId}`, itemName: poLineId, specification: null, unit: 'm2', ordered: remaining, remaining, price: 1 });

describe('AI đọc phiếu giao — chuẩn hóa kết quả', () => {
  it('giữ số thập phân, bỏ dòng rỗng, ngày sai → null, biển số viết hoa', () => {
    const r = normalizeRead({
      docType: 'bien_ban_giao_nhan', supplierName: '  Tôn Poshaco ', docNo: '007/10', docDate: '2026-13-40', docTime: '14:30', truckNo: '29cd-00280',
      lines: [{ name: 'Tôn mát Poshaco 0.45', unit: 'm2', qty: 530.103, note: null, confidence: 'high' }, { name: '  ', qty: 3 }, { name: 'Vít', unit: 'cái', qty: -1, confidence: 'high' }],
      warnings: ['Tổng ghi tay lệch', 5],
    });
    expect(r.supplierName).toBe('Tôn Poshaco');
    expect(r.docDate).toBeNull();
    expect(r.truckNo).toBe('29CD-00280');
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ qty: 530.103, confidence: 'high' });
    // Số âm không hợp lệ → để trống và đánh dấu cần xem lại.
    expect(r.lines[1]).toMatchObject({ name: 'Vít', qty: null, confidence: 'low' });
    expect(r.warnings).toEqual(['Tổng ghi tay lệch']);
  });
  it('rác không làm hỏng: trả khung rỗng', () => {
    expect(normalizeRead('x')).toMatchObject({ docType: 'khac', lines: [], warnings: [] });
  });
  it('lược đồ bắt buộc đủ trường (structured outputs cần required + additionalProperties false)', () => {
    expect(DOC_SCHEMA.required).toEqual(Object.keys(DOC_SCHEMA.properties));
    expect(DOC_SCHEMA.properties.lines.items.required).toEqual(Object.keys(DOC_SCHEMA.properties.lines.items.properties));
    expect(DOC_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('gán dòng phiếu → dòng đơn', () => {
  it('NCC tách một loại hàng thành 2 dòng (Tôn Đoàn Minh 007/10: 110 tấm + 2 tấm) → cùng dòng đơn; số lượng dạng Việt', () => {
    const c = capture([{ name: 'Tôn mát Poshaco', unit: 'm2', qty: 787.991 }, { name: 'Tôn mát Poshaco', unit: 'm2', qty: 14.327 }, { name: 'Vít', unit: 'cái', qty: 100 }]);
    const s: CaptureSuggestion = {
      purchaseOrderId: 'po-1', poNumber: 'PO-619', status: 'confirmed', approved: true, vendorName: 'Poshaco', createdAt: '', supplierScore: 1, score: 1,
      lines: [{ captureIndex: 0, score: 1.3, poLineId: 'A' }, { captureIndex: 1, score: 0.6, poLineId: 'A' }, { captureIndex: 2, score: 0.2 }],
      poLines: [poLine('A', 2134.738)],
    };
    expect(initialMapping(c, s)).toEqual([{ poLineId: 'A', qty: '787,991' }, { poLineId: 'A', qty: '14,327' }, { poLineId: '', qty: '' }]);
  });
  it('báo lỗi tiếng Việt, kể cả vượt phần đơn còn lại', () => {
    expect(captureErrorMessage({ message: 'CAPTURE_PO_NOT_APPROVED' })).toContain('chờ duyệt');
    expect(captureErrorMessage({ message: 'CAPTURE_OVER_REMAINING: Gạch rỗng — đơn còn 500 viên' })).toBe('Vượt phần đơn chưa giao: Gạch rỗng — đơn còn 500 viên.');
  });
});

describe('máy chủ: chụp trước, đơn sau', () => {
  it('chỉ thủ kho kho đó thao tác; ảnh theo kho của phiếu chụp', () => {
    expect(migration).toContain("app_private.wms_has_action('wms.transaction.approve', p_warehouse_id, p_warehouse_id)");
    expect(migration).toContain("split_part(p_object_name, '/', 1) like 'cap-%'");
    expect(migration).toContain('revoke insert, update, delete on public.wms_delivery_captures, public.wms_item_aliases from anon, authenticated;');
  });
  it('nhận theo xe: đơn phải duyệt, không vượt, chống trùng phiếu + xe + ngày, ngày chứng từ theo phiếu, ảnh làm chứng từ, học tên', () => {
    expect(migration).toContain("message = 'CAPTURE_PO_NOT_APPROVED'");
    expect(migration).toContain("'CAPTURE_OVER_REMAINING: '");
    expect(migration).toContain("message = 'CAPTURE_DUPLICATE'");
    expect(migration).toContain("group by x.value->>'poLineId' loop");
    expect(migration).toContain("perform public.set_wms_document_date_v1(jsonb_build_object('transactionId', v_tx, 'date', v_c.doc_date));");
    expect(migration).toContain("perform public.receive_purchase_delivery_v1(v_batch, v_tx, 'passed', v_recv, v_att);");
    expect(migration).toContain('insert into public.wms_item_aliases');
  });
  it('màn Kho: nút Chụp phiếu giao, phiếu chụp nằm trong Việc cần làm', () => {
    const view = read('components/wms/KhoView.tsx');
    expect(view).toContain('<CaptureButton onFiles=');
    expect(view).toContain('{todoCaps.map(capRow)}');
    const panel = read('components/wms/KhoCapture.tsx');
    expect(panel).toContain('capture="environment"');
    expect(panel).toContain("'Đơn chờ duyệt — Mua hàng duyệt xong mới nhận được'");
  });
  it('AI đổi được nhà cung cấp, chưa có khóa thì nhập tay', () => {
    const fn = read('supabase/functions/wms-doc-reader/index.ts');
    expect(fn).toContain("Deno.env.get('WMS_AI_PROVIDER')");
    expect(fn).toContain("return json({ code: 'AI_NOT_CONFIGURED' })");
    expect(fn).toContain("fallbacks: 'default'");
    expect(read('supabase/config.toml')).toContain('[functions.wms-doc-reader]');
  });
});
