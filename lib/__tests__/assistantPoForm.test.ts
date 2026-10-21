import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), proactiveOptions: vi.fn(), searchItems: vi.fn(), vendors: vi.fn(), saveProactiveOrder: vi.fn(), transitionOrder: vi.fn(), getOrder: vi.fn(),
}));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../procurementInboxService', async () => {
  const real = await vi.importActual<typeof import('../procurementInboxService')>('../procurementInboxService');
  return { ...real, procurementInboxService: { proactiveOptions: mocks.proactiveOptions, searchItems: mocks.searchItems, vendors: mocks.vendors,
    saveProactiveOrder: mocks.saveProactiveOrder, transitionOrder: mocks.transitionOrder, getOrder: mocks.getOrder } };
});

import type { ProcurementCatalogItem } from '../procurementInboxService';
import { applyItem, buildRows, createPoFormActions, memoLoad, poProblems, poTotals, quotedAmountGap, toSourceRow } from '../assistantPoForm';
import { parseCommand } from '../assistantCommands';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';

afterEach(() => { Object.values(mocks).forEach(m => m.mockReset()); });

const item = (o: Partial<ProcurementCatalogItem> & Pick<ProcurementCatalogItem, 'id' | 'name' | 'unit'>): ProcurementCatalogItem =>
  ({ sku: null, purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0, ...o });
const CATALOG = [
  item({ id: 'xm', name: 'Xi măng PCB40', unit: 'Tấn', inBoq: true, boqQty: 20, orderedQty: 12 }),
  item({ id: 'd16', name: 'Thép XD D16', unit: 'Cây', purchaseUnit: 'kg', purchaseFactor: 0.0336 }),
  item({ id: 'pvc42', name: 'Ống PVC 42', unit: 'Cây' }),
];
const search = async (q: string) => CATALOG.filter(i => q.toLowerCase().split(/\s+/).every(w => i.name.toLowerCase().includes(w)));
const COMMAND = parseCommand({ id: 'po-cmd', kind: 'purchase_order', status: 'prepared', title: 'Đơn mua HP · SMB', createdAt: '2026-10-18T02:00:00Z',
  payload: { projectId: 'p-smb', projectCode: 'SMB-2026', vat: 8, lines: [] } })!;

describe('Form đơn mua trong chat — dùng đúng cách khớp / quy đổi của màn Lập đơn', () => {
  it('khớp tên như màn Lập đơn; báo giá theo đơn vị mua (kg) → SL mua giữ theo báo giá, SL kho quy đổi; giá theo kg', async () => {
    const rows = await buildRows([
      { name: 'Xi măng PCB40', spec: null, qty: 10, unit: 'tấn', price: 1650000 },
      { name: 'Thép XD D16', spec: 'CB400', qty: 1488, unit: 'kg', price: 15800 },
      { name: 'Ống nhựa xoắn', spec: null, qty: 5, unit: 'cuộn', price: null },
    ], search);
    expect(rows.map(r => r.item?.id ?? null)).toEqual(['xm', 'd16', null]);
    expect(rows[0]).toMatchObject({ stockQty: '10', price: '1650000', altUnit: false });
    expect(rows[1]).toMatchObject({ altUnit: true, purchaseQty: '1488', price: '15800', spec: 'CB400' });
    expect(rows[1].stockQty).toBe('49,997');
    // Đổi mã: quy đổi lại theo mã mới.
    expect(applyItem({ ...rows[2], source: toSourceRow({ name: 'Ống PVC', spec: null, qty: 20, unit: 'cây', price: 95000 }, 2) }, CATALOG[2]))
      .toMatchObject({ item: { id: 'pvc42' }, stockQty: '20', price: '95000' });
  });

  it('tiền + BOQ: tạm tính theo SL mua × giá, VAT; dòng chưa giá đếm riêng; vượt / ngoài BOQ tính cả dòng cùng mã đứng trước', async () => {
    const rows = await buildRows([
      { name: 'Xi măng PCB40', spec: null, qty: 6, unit: 'tấn', price: 1000000 },
      { name: 'Xi măng PCB40', spec: 'bao', qty: 4, unit: 'tấn', price: null },
    ], search);
    const t = poTotals(rows, 10);
    expect(t).toMatchObject({ subtotal: 6000000, vatAmount: 600000, total: 6600000, unpriced: 1, invalid: 0 });
    // BOQ 20, đã đặt 12: dòng 1 (6) còn trong BOQ, dòng 2 cộng dồn 12 + 6 + 4 = 22 → vượt.
    expect(t.overBoq).toBe(1);
  });

  it('kiểm như màn Lập đơn: kho, NCC, lý do (Khác phải ghi), có mã, SL, quy cách trùng mã, lý do vượt BOQ, VAT 0–100, người duyệt khi gửi', async () => {
    const rows = await buildRows([{ name: 'Xi măng PCB40', spec: null, qty: 10, unit: 'tấn', price: 1 }], search);
    const ok = { warehouseId: 'wh', vendor: { id: 'v' }, reasonCode: 'price_lock' as const, reason: '', overBoqReason: 'Chốt giá', vat: '8', rows, approverId: 'u' };
    expect(poProblems(ok, 'send')).toEqual([]);
    expect(poProblems({ ...ok, approverId: null }, 'draft')).toEqual([]);
    expect(poProblems({ ...ok, warehouseId: '', vendor: null, reasonCode: null, approverId: null }, 'send'))
      .toEqual(['Chọn kho nhận.', 'Chọn nhà cung cấp.', 'Chọn lý do mua chủ động.', 'Chọn người duyệt.']);
    expect(poProblems({ ...ok, reasonCode: 'other' }, 'draft')).toEqual(['Chọn "Khác" thì ghi rõ lý do.']);
    expect(poProblems({ ...ok, overBoqReason: '' }, 'draft')).toEqual(['Có vật tư vượt hoặc ngoài BOQ — ghi lý do mua vượt.']);
    expect(poProblems({ ...ok, vat: '120' }, 'draft')).toEqual(['Thuế VAT phải từ 0 đến 100%.']);
    expect(poProblems({ ...ok, rows: [{ ...rows[0], stockQty: '0' }] }, 'draft')).toEqual(['Còn dòng chưa có số lượng hợp lệ.']);
    expect(poProblems({ ...ok, rows: [rows[0], { ...rows[0], key: 'k2' }] }, 'draft')).toEqual(['Có vật tư nhiều dòng — ghi quy cách khác nhau.']);
  });

  it('19/10 lệch thành tiền: báo giá ghi khác SL × đơn giá → cảnh báo trên dòng, chặn Gửi duyệt (không chặn nháp); sửa cho khớp hoặc Giữ số này thì hết', async () => {
    const rows = await buildRows([
      { name: 'Ống PVC 42', spec: null, qty: 20, unit: 'cây', price: 95000, amount: 19000000 },   // lệch 10 lần (công cụ chỉ tự sửa lệch 1.000 lần)
      { name: 'Xi măng PCB40', spec: 'bao 50kg', qty: 10, unit: 'tấn', price: 1650000, amount: 16500000 }, // khớp
      { name: 'Xi măng PCB40', spec: 'rời', qty: 3, unit: 'tấn', price: 1650000, amount: 4950600 },      // lệch 600đ: làm tròn, bỏ qua
      { name: 'Thép XD D16', spec: null, qty: 1488, unit: 'kg', price: 15800 },                  // báo giá không ghi thành tiền
    ], search);
    expect(quotedAmountGap(rows[0])).toEqual({ quoted: 19000000, computed: 1900000 });
    expect(quotedAmountGap(rows[1])).toBeNull();
    expect(quotedAmountGap(rows[2])).toBeNull();
    expect(quotedAmountGap(rows[3])).toBeNull();
    // Theo đơn vị mua (kg): tính bằng SL mua × giá/kg, không phải SL kho quy đổi.
    expect(quotedAmountGap({ ...rows[3], quotedAmount: 1488 * 15800 })).toBeNull();
    expect(quotedAmountGap({ ...rows[3], quotedAmount: 50 * 15800 })).toEqual({ quoted: 790000, computed: 1488 * 15800 });
    const f = { warehouseId: 'wh', vendor: { id: 'v' }, reasonCode: 'price_lock' as const, reason: '', overBoqReason: 'x', vat: '8', rows, approverId: 'u' };
    expect(poProblems(f, 'send')).toEqual(['Một dòng SL × đơn giá khác thành tiền báo giá — sửa lại, hoặc bấm "Giữ số này" nếu số đang nhập đúng.']);
    expect(poProblems(f, 'draft')).toEqual([]);
    expect(poProblems({ ...f, rows: [{ ...rows[0], stockQty: '200' }, ...rows.slice(1)] }, 'send')).toEqual([]);
    expect(poProblems({ ...f, rows: [{ ...rows[0], amountOk: true }, ...rows.slice(1)] }, 'send')).toEqual([]);
    expect(poProblems({ ...f, rows: [{ ...rows[0], spec: 'D42' }, { ...rows[0], key: 'k2', spec: 'D60' }] }, 'send')).toEqual(['2 dòng SL × đơn giá khác thành tiền báo giá — sửa lại, hoặc bấm "Giữ số này" nếu số đang nhập đúng.']);
    // Đổi mã thì tính lại từ đầu: bỏ "Giữ số này".
    expect(applyItem({ ...rows[0], amountOk: true }, CATALOG[2]).amountOk).toBe(false);
    // Dòng chưa có mã không tính vào lỗi gửi (không được lưu).
    expect(poProblems({ ...f, rows: [{ ...rows[0], item: null }, rows[1]] }, 'send')).toEqual([]);
  });

  it('gửi duyệt: lưu bằng lệnh của màn Lập đơn rồi gửi người duyệt; gửi lỗi → lần sau sửa đúng đơn đã lưu (không lập đơn trùng)', async () => {
    mocks.saveProactiveOrder.mockResolvedValueOnce({ purchaseOrderId: 'po-1', poNumber: 'PO-2026-0712', rowVersion: 1 }).mockResolvedValueOnce({ purchaseOrderId: 'po-1', poNumber: 'PO-2026-0712', rowVersion: 2 });
    mocks.transitionOrder.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({ purchaseOrderId: 'po-1', status: 'pending', rowVersion: 3 });
    mocks.rpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => ({ data: { ...COMMAND, status: args.p_status, result: args.p_result, error: args.p_error }, error: null }));
    const rows = await buildRows([{ name: 'Thép XD D16', spec: null, qty: 1488, unit: 'kg', price: 15800 }], search);
    const input = { mode: 'send' as const, warehouseId: 'wh', vendor: { id: 'v-hp', name: 'Hòa Phát' }, deliveryDate: '2026-10-25', vat: 8, reasonCode: 'price_lock' as const,
      reason: '', overBoqReason: 'Ngoài BOQ — chốt giá', note: 'BG-1810', rows, approverId: 'u-chuan', approverName: 'Hà Đức Chuẩn' };
    const actions = createPoFormActions();
    await expect(actions.submit(COMMAND, input)).rejects.toThrow('Đã lưu nháp PO-2026-0712, chưa gửi duyệt được: Mất kết nối');
    expect(mocks.saveProactiveOrder.mock.calls[0][0]).toMatchObject({ purchaseOrderId: undefined, purpose: 'project', projectId: 'p-smb', targetWarehouseId: 'wh', vendorId: 'v-hp',
      purchaseMode: 'single', expectedDeliveryDate: '2026-10-25', vatRate: 8, note: 'BG-1810', reasonCode: 'price_lock', overBoqReason: 'Ngoài BOQ — chốt giá',
      items: [{ itemId: 'd16', unitPrice: 15800, purchaseUnit: 'kg', purchaseQty: 1488 }] });
    const done = await actions.submit(COMMAND, input);
    expect(mocks.saveProactiveOrder.mock.calls[1][0]).toMatchObject({ purchaseOrderId: 'po-1', expectedRowVersion: 1 });
    expect(mocks.transitionOrder).toHaveBeenLastCalledWith({ purchaseOrderId: 'po-1', expectedRowVersion: 2, action: 'submit', approverUserId: 'u-chuan' });
    expect(done).toMatchObject({ status: 'done', result: { code: 'PO-2026-0712', id: 'po-1', submitted: true, approvers: ['Hà Đức Chuẩn'] } });
  });
});

describe('memoLoad — nhớ kết quả tải theo thẻ (19/10: mở lại thẻ không gọi lại RPC, không tốn lượt AI)', () => {
  it('cùng id → cùng promise trong hạn; lỗi không bị nhớ; forget → tải lại', async () => {
    let n = 0;
    const memo = memoLoad(async (c: { id: string }) => { n++; if (c.id === 'bad') throw new Error('x'); return { n, id: c.id }; });
    const a = await memo.load({ id: 'c1' } as never); const b = await memo.load({ id: 'c1' } as never);
    expect(a).toBe(b); expect(n).toBe(1);
    await expect(memo.load({ id: 'bad' } as never)).rejects.toThrow('x');
    await expect(memo.load({ id: 'bad' } as never)).rejects.toThrow('x');
    expect(n).toBe(3);
    memo.forget('c1');
    expect((await memo.load({ id: 'c1' } as never)).n).toBe(4);
  });
});

describe('Công cụ chuẩn bị đơn mua (lệnh máy chủ giả)', () => {
  const PROJECTS = [{ id: 'p-smb', code: 'SMB-2026', name: 'Nhà máy SMB', warehouses: [{ id: 'wh-smb', name: 'Kho Sơn Miền Bắc' }] }, { id: 'p-da29', code: 'DA29', name: 'Nhà xưởng XinHai', warehouses: [] }];
  const ctxOf = (table: Record<string, unknown>, projectId: string | null = null) => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const events: Array<Record<string, unknown>> = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      const hit = table[fn];
      if (hit instanceof Error) return { data: null, error: { message: hit.message, code: '42501' } };
      return { data: hit ?? null, error: hit === undefined ? { message: 'unknown', code: 'X' } : null };
    }) as Rpc;
    return { calls, events, ctx: { rpc, book: new SourceBook(), runId: 'run-po', projectId, emit: (e: Record<string, unknown>) => events.push(e) } };
  };
  const ok = { list_procurement_proactive_options_v1: { projects: PROJECTS, stockWarehouses: [] },
    list_procurement_vendors_v1: [{ id: 'v-hp', name: 'Công ty CP Thép Hòa Phát', taxCode: '0900189284' }, { id: 'v-dq', name: 'Thép Hòa Phát Dung Quất', taxCode: '4300381300' }],
    assistant_command_create_v1: { id: 'cmd-po', kind: 'purchase_order', status: 'prepared', title: 'x', payload: {}, preview: {} } };
  const LINES = [{ ten: 'Thép D16 CB400', so_luong: 1488, don_vi: 'kg', don_gia: 15800, thanh_tien: 23510400 }, { ten: 'Xi măng PCB40', so_luong: 10, don_vi: 'tấn' }];

  it('chuẩn bị: dự án theo lời, kho mặc định, NCC nhiều kết quả → đưa lên thẻ làm nút chọn; không lưu / gửi đơn', async () => {
    const t = ctxOf(ok, 'p-da29');
    const out = JSON.parse(await runTool('chuan_bi_don_mua', { du_an: 'smb', ncc: 'Hòa Phát', vat: 8, ngay_giao: '2099-01-02', ly_do: 'price_lock', dong: LINES }, t.ctx, new Map()));
    expect(t.calls.map(c => c[0])).toEqual(['list_procurement_proactive_options_v1', 'list_procurement_vendors_v1', 'assistant_command_create_v1']);
    expect(t.calls[2][1]).toMatchObject({ p_kind: 'purchase_order', p_title: 'Đơn mua Hòa Phát · SMB-2026', p_payload: { projectId: 'p-smb', warehouseId: 'wh-smb', vendorQuery: 'Hòa Phát',
      vendorOptions: [{ id: 'v-hp' }, { id: 'v-dq' }], reasonCode: 'price_lock', vat: 8, deliveryDate: '2099-01-02',
      lines: [{ name: 'Thép D16 CB400', qty: 1488, unit: 'kg', price: 15800, amount: 23510400 }, { name: 'Xi măng PCB40', qty: 10, unit: 'tấn' }] }, p_preview: { lineCount: 2, missingPrice: 1 } });
    expect((t.calls[2][1] as { p_payload: { lines: Array<Record<string, unknown>> } }).p_payload.lines[1]).not.toHaveProperty('amount');
    expect(t.events).toHaveLength(1);
    expect(out).toMatchObject({ da_hien_the: true, so_dong: 2, dong_chua_co_gia: 1, vat: '8%' });
    // Tiền do công cụ tính (model hay cộng sai): 1.488 × 15.800 = 23.510.400đ; dòng chưa giá không tính.
    expect(out.tam_tinh).toBe(`${(23510400).toLocaleString('vi-VN')}đ`);
    expect(out.tong).toBe(`${Math.round(23510400 * 1.08).toLocaleString('vi-VN')}đ`);
    expect(out.ncc).toContain('2 NCC gần giống');
    expect(t.calls.some(c => /save|transition/.test(c[0]))).toBe(false);
  });

  it('NCC khớp đúng tên / MST → chọn sẵn; chưa nói dự án → hỏi lại; không có quyền Mua hàng → nói rõ', async () => {
    const t = ctxOf(ok);
    await runTool('chuan_bi_don_mua', { du_an: 'SMB-2026', ncc: '0900189284', dong: LINES }, t.ctx, new Map());
    expect(t.calls[2][1]).toMatchObject({ p_payload: { vendorId: 'v-hp', vendorName: 'Công ty CP Thép Hòa Phát' } });
    const ask = ctxOf(ok, 'p-da29');
    const out = JSON.parse(await runTool('chuan_bi_don_mua', { dong: LINES }, ask.ctx, new Map()));
    expect(out.cac_du_an).toEqual(['DA29 · Nhà xưởng XinHai', 'SMB-2026 · Nhà máy SMB']);
    expect(ask.calls.some(c => c[0] === 'assistant_command_create_v1')).toBe(false);
    const denied = ctxOf({ ...ok, list_procurement_proactive_options_v1: new Error('PROCUREMENT_MANAGE_DENIED') });
    expect(JSON.parse(await runTool('chuan_bi_don_mua', { du_an: 'smb', dong: LINES }, denied.ctx, new Map())).loi).toContain('chưa có quyền lập đơn mua');
  });

  it('20/10 model ghép "Tên (MST …)": RPC tìm chuỗi con không thấy → tìm lại theo MST, rồi theo tên bỏ phần MST; chọn sẵn NCC', async () => {
    // Như list_procurement_vendors_v1: chuỗi con trong "tên MST".
    const search = (vendors: Array<{ id: string; name: string; taxCode: string | null }>) => {
      const t = ctxOf(ok);
      const base = t.ctx.rpc;
      t.ctx.rpc = (async (fn: string, args: Record<string, unknown>) => fn === 'list_procurement_vendors_v1'
        ? (t.calls.push([fn, args]), { data: vendors.filter(v => `${v.name} ${v.taxCode || ''}`.toLowerCase().includes(String(args.p_search).toLowerCase())), error: null })
        : base(fn, args)) as Rpc;
      return t;
    };
    const t = search([{ id: 'v-hk', name: 'CÔNG TY TNHH HANAKA VIỆT NAM', taxCode: '0101234567' }]);
    await runTool('chuan_bi_don_mua', { du_an: 'SMB-2026', ncc: 'CÔNG TY TNHH HANAKA VIỆT NAM (MST 0101234567)', dong: LINES }, t.ctx, new Map());
    expect(t.calls.filter(c => c[0] === 'list_procurement_vendors_v1').map(c => c[1].p_search)).toEqual(['CÔNG TY TNHH HANAKA VIỆT NAM (MST 0101234567)', '0101234567']);
    expect(t.calls.at(-1)?.[1]).toMatchObject({ p_payload: { vendorId: 'v-hk', vendorName: 'CÔNG TY TNHH HANAKA VIỆT NAM' } });
    // NCC chưa có MST trong danh mục → tìm theo tên bỏ phần MST.
    const noTax = search([{ id: 'v-hk', name: 'CÔNG TY TNHH HANAKA VIỆT NAM', taxCode: null }]);
    await runTool('chuan_bi_don_mua', { du_an: 'SMB-2026', ncc: 'CÔNG TY TNHH HANAKA VIỆT NAM - MST: 0101234567', dong: LINES }, noTax.ctx, new Map());
    expect(noTax.calls.filter(c => c[0] === 'list_procurement_vendors_v1').map(c => c[1].p_search)).toEqual(['CÔNG TY TNHH HANAKA VIỆT NAM - MST: 0101234567', '0101234567', 'CÔNG TY TNHH HANAKA VIỆT NAM']);
    expect(noTax.calls.at(-1)?.[1]).toMatchObject({ p_payload: { vendorId: 'v-hk' } });
  });
});
