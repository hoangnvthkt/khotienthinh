import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchVpp, vppErrorMessage, type VppCatalogItem } from '../officeSupplyService';

const read = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const opening = read('20261018100000_vpp_opening_balance.sql');
const flow = read('20261018100100_vpp_requests.sql');
const baseline = JSON.parse(readFileSync(new URL('../../supabase/baseline/current.json', import.meta.url), 'utf8'));

const seed = [...opening.matchAll(/\('(VPP\d{3})', '((?:[^']|'')+)', '([^']+)', (\d+), (\d+)\)/g)]
  .map(m => ({ sku: m[1], name: m[2], unit: m[3], price: Number(m[4]), qty: Number(m[5]) }));

describe('VPP — tồn đầu kỳ 17/10/2026 khớp bảng XNT', () => {
  it('82 mã VPP001–VPP082, không trùng', () => {
    expect(seed).toHaveLength(82);
    expect(new Set(seed.map(s => s.sku)).size).toBe(82);
    expect(seed[0].sku).toBe('VPP001');
    expect(seed[81].sku).toBe('VPP082');
  });
  it('tổng tồn 573 đơn vị, 11.479.200 đ', () => {
    expect(seed.reduce((s, r) => s + r.qty, 0)).toBe(573);
    expect(seed.reduce((s, r) => s + r.qty * r.price, 0)).toBe(11_479_200);
  });
  it('ĐVT chuẩn hóa, VPP046 thiếu ĐVT → Cuộn, mã tồn 0 vẫn tạo', () => {
    for (const s of seed) expect(s.unit).toMatch(/^[A-ZĐ][a-zàáảãạâầấẩẫậăằắẳẵặđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]*$/);
    expect(seed.find(s => s.sku === 'VPP046')?.unit).toBe('Cuộn');
    expect(seed.filter(s => s.qty === 0).map(s => s.sku)).toEqual(['VPP010', 'VPP018', 'VPP032', 'VPP043', 'VPP044', 'VPP045', 'VPP050', 'VPP051']);
  });
  it('một phiếu nhập COMPLETED mục đích tồn đầu kỳ, chỉ chạy khi có Kho VPP Hưng Yên và chưa chạy', () => {
    expect(opening).toContain("'opening_balance'");
    expect(opening).toContain("'2026-10-17 08:00:00+07'");
    expect(opening).toContain("not exists (select 1 from public.warehouses where id = v_wh)");
    expect(opening).toContain("exists (select 1 from public.transactions where id = v_tx)");
  });
});

describe('VPP — luồng đề xuất / duyệt / cấp', () => {
  it('migration nằm trong allowlist', () => {
    expect(baseline.allowedPostBaselineFiles).toEqual(expect.arrayContaining(['20261018100000_vpp_opening_balance.sql', '20261018100100_vpp_requests.sql']));
  });
  it('giữ mọi mục đích phiếu kho cũ, thêm 3 mục đích VPP', () => {
    const old = ['request_po_receipt', 'proactive_po_receipt', 'site_hot_purchase_receipt', 'direct_supplier_receipt', 'direct_manual_receipt',
      'project_return_receipt', 'warehouse_transfer', 'construction_issue', 'supplier_return', 'warehouse_loss', 'inventory_adjustment',
      'opening_balance', 'reversal', 'legacy_direct_receipt', 'legacy_direct_issue'];
    const check = flow.slice(flow.indexOf('add constraint transactions_business_event_type_check'));
    for (const e of [...old, 'office_supply_issue', 'office_supply_return', 'office_supply_receipt']) expect(check).toContain(`'${e}'`);
  });
  it('xung đột phiên bản dùng PT409, không 40001', () => {
    expect(flow).not.toMatch(/40001/);
    expect(flow).toContain("errcode = 'PT409'");
  });
  it('mọi hàm security definer đặt search_path rỗng', () => {
    const defs = [...flow.matchAll(/create or replace function ([\w.]+)\([^)]*\)[\s\S]*?as \$\$/g)].map(m => m[0]);
    expect(defs.length).toBeGreaterThan(20);
    for (const d of defs) expect(d).toContain("security definer set search_path = ''");
  });
  it('duyệt: không tự duyệt phiếu mình, duyệt thay ghi on_behalf_of, vượt ngưỡng thêm bước', () => {
    expect(flow).toContain('p_user = p_req.requester_id');
    expect(flow).toContain('v_behalf := case when v_role = \'behalf\' then r.approver_id end');
    expect(flow).toContain("'pending_threshold'");
    expect(flow).toContain('threshold_amount numeric not null default 5000000');
  });
  it('cấp: chỉ thủ kho kho VPP, chặn vượt tồn, món chưa có mã phải gán mã', () => {
    for (const code of ['VPP_ISSUE_DENIED', 'VPP_STOCK_SHORT', 'VPP_ITEM_REQUIRED', 'VPP_ISSUE_QTY_INVALID']) expect(flow).toContain(code);
    expect(flow).toContain("app_private.wms_has_action('wms.transaction.keeper'");
    expect(flow).toContain("'price', round(app_private.vpp_unit_cost(l.item_id, r.warehouse_id), 6)");
  });
  it('người đề xuất không thấy giá; danh mục chọn không gửi giá', () => {
    const home = flow.slice(flow.indexOf('create or replace function public.get_office_supply_home_v1'), flow.indexOf('create or replace function public.list_office_supply_requests_v1'));
    expect(home).not.toMatch(/price|unit_cost|amount/i);
    expect(flow).toContain("'estimatedAmount', case when v_price then r.estimated_amount end");
  });
});

const catalog: VppCatalogItem[] = [
  { itemId: '1', sku: 'VPP001', name: 'Giấy A4', unit: 'Gam', inStock: true },
  { itemId: '5', sku: 'VPP005', name: 'Bút bi xanh', unit: 'Cái', inStock: true },
  { itemId: '6', sku: 'VPP006', name: 'Bút bi màu đỏ', unit: 'Cái', inStock: false },
  { itemId: '7', sku: 'VPP007', name: 'Bút bảng trắng', unit: 'Cái', inStock: true },
];

describe('VPP — gõ tên tìm món', () => {
  it('không phân biệt dấu, khớp mọi từ, món có mã trước', () => {
    const r = searchVpp('but bi', catalog, [{ name: 'Bút bi đen', unit: 'Cái', times: 3 }]);
    expect(r.coded.map(c => c.sku)).toEqual(['VPP006', 'VPP005']);
    expect(r.uncoded.map(u => u.name)).toEqual(['Bút bi đen']);
  });
  it('tìm theo mã; tên chưa có mã mà nay đã có mã thì không gợi ý trùng', () => {
    expect(searchVpp('vpp001', catalog, []).coded.map(c => c.name)).toEqual(['Giấy A4']);
    expect(searchVpp('giay', catalog, [{ name: 'giấy a4', unit: 'Gam', times: 1 }]).uncoded).toEqual([]);
  });
  it('ô trống không gợi ý', () => {
    expect(searchVpp('  ', catalog, [])).toEqual({ coded: [], uncoded: [] });
  });
});

describe('VPP — câu báo lỗi', () => {
  it('đổi mã lỗi máy chủ thành câu dễ hiểu, kèm tên món khi thiếu hàng', () => {
    expect(vppErrorMessage({ message: 'VPP_STOCK_SHORT', details: 'VPP001 Giấy A4' })).toBe('Kho không đủ hàng để cấp: VPP001 Giấy A4.');
    expect(vppErrorMessage({ message: 'ROW_VERSION_CONFLICT' })).toContain('người khác cập nhật');
    expect(vppErrorMessage({ message: 'SOME_UNKNOWN_CODE' }, 'x')).toBe('x');
  });
});
