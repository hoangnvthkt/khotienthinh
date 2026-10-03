import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tạm ứng NCC + Quản trị Tài chính (chủ SP duyệt 6 câu 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008134000_finance_supplier_advances.sql', 'utf8');
const drawer = readFileSync('components/finance/AdvanceDrawer.tsx', 'utf8');
const view = readFileSync('components/finance/AdvancesView.tsx', 'utf8');
const admin = readFileSync('components/finance/FinanceSettingsView.tsx', 'utf8');

const fn = (name: string) => {
  const start = sql.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('end $$;', start) + 7);
};

describe('Tạm ứng NCC', () => {
  it('gắn một PO (không phải đơn theo HĐ) hoặc một HĐ nguyên tắc + dự án; tổng tạm ứng không vượt giá trị đơn gồm VAT', () => {
    expect(sql).toContain('((purchase_order_id is null) <> (supplier_contract_id is null) and repay_due_date is not null)');
    const target = fn('app_private.finance_advance_target');
    expect(target).toContain("message = 'FINANCE_ADVANCE_CONTRACT_ORDER'");
    expect(target).toContain("v_po.status not in ('sent', 'confirmed', 'in_transit', 'partial')");
    expect(target).toContain('(1 + coalesce(v_po.vat_rate, 0) / 100)');
    expect(fn('public.save_finance_advance_request_v1')).toContain("message = 'FINANCE_ADVANCE_OVER_ORDER'");
  });

  it('duyệt theo ma trận đề nghị chi; vượt ngưỡng thì thêm bước, người duyệt thêm đã có trong luồng thì không thêm', () => {
    const route = fn('app_private.finance_advance_route');
    expect(route).toContain('app_private.finance_payment_route(p_supplier, p_amount');
    expect(route).toContain('p_percent <= v_set.advance_extra_percent');
    expect(route).toContain("if v_ids && v_existing then return v_route || jsonb_build_object('extraCovered', true)");
    const save = fn('public.save_finance_advance_request_v1');
    expect(save).toContain("message = 'FINANCE_REASON_REQUIRED'");
    expect(save).toContain("message = 'FINANCE_SUPPLIER_BANK_REQUIRED'");
  });

  it('xác nhận chi qua kiểm tra chung (3 người, UNC, file) rồi ghi phiếu chi + dòng tiền ra, không ghi chi phí', () => {
    expect(sql).toContain("if v_req.kind = 'advance' then\n    return app_private.finance_confirm_advance(");
    const confirm = fn('app_private.finance_confirm_advance');
    expect(confirm).toContain("jsonb_build_object('kind', 'advance'");
    expect(confirm).toContain("v_ref := 'supplier_payment_batch:' || v_bid::text");
    expect(confirm).toContain('app_private.finance_advance_auto_apply_request(v_req.id)');
    expect(confirm).not.toContain('purchase_receipt:');
  });

  it('công nợ cùng PO / HĐ + cùng dự án tự trừ tạm ứng; lỗi không chặn kho nhận hàng', () => {
    const apply = fn('app_private.finance_advance_apply');
    expect(apply).toContain('app_private.finance_scope_key(d.project_id, d.construction_site_id) <> app_private.finance_scope_key(r.project_id, r.construction_site_id)');
    expect(apply).toContain('on conflict (payment_batch_id, payable_document_id) do update');
    expect(apply).toContain('insert into public.supplier_advance_offsets');
    const trg = fn('app_private.trg_supplier_advance_auto_offset');
    expect(trg).toContain('exception when others then');
    expect(trg).toContain("'advance_offset_failed'");
  });

  it('luồng ngược: trả hàng / hủy chứng từ trả lại cấn trừ; đảo chỉ khi chưa cấn trừ / hoàn; hoàn và chuyển do người khác xác nhận', () => {
    const release = fn('app_private.trg_supplier_advance_release');
    expect(release).toContain("'document_cancel'");
    expect(release).toContain("'return'");
    expect(sql).toContain("if v_req.kind = 'advance' then perform app_private.finance_assert_advance_reversible(v_req.id); end if;");
    const decide = fn('public.decide_finance_advance_adjustment_v1');
    expect(decide).toContain("if v_actor = a.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'");
    expect(decide).toContain("':refund:'");
    expect(fn('public.save_finance_advance_adjustment_v1')).toContain("message = 'FINANCE_ADVANCE_TRANSFER_SCOPE'");
  });

  it('Quản trị: thông số tạm ứng chỉ Quản trị Tài chính sửa, bắt buộc lý do, ghi nhật ký; hiện ai giữ quyền', () => {
    const save = fn('public.save_finance_advance_settings_v1');
    expect(save).toContain("if not app_private.finance_can('manage')");
    expect(save).toContain("'advance_settings_save'");
    expect(sql).toContain("'responsibilities', (select jsonb_object_agg(a.x");
    expect(admin).toContain('Trách nhiệm — ai đang giữ quyền nào');
    expect(admin).toContain('Ràng buộc đang áp dụng');
  });

  it('giao diện: tạm ứng là tiền ra, không phải chi phí; không che số chưa có bằng 0', () => {
    expect(drawer).toContain('Tạm ứng không phải chi phí');
    expect(drawer).toContain("placeholder={base ? 'VD: 30' : 'HĐ chưa có giá trị'}");
    expect(view).toContain('Quá hạn hoàn ứng');
    expect(view).toContain('NCC hoàn tiền');
  });
});
