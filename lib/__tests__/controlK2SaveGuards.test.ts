import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainError } from '../../supabase/functions/ai-gateway/errorGuide';

// Kiểm soát viên K2 (chủ SP 23/10/2026): chặn lúc lưu 6 ca P0 — bắt lý do / xác nhận. Smoke dữ liệu thật trên Cloud:
// supabase/tests/control_k2_save_guards_smoke.sql.

const sql = readFileSync('supabase/migrations/20261029210000_control_k2_save_guards.sql', 'utf8');
const fn = (name: string) => {
  const start = sql.search(new RegExp(`FUNCTION ${name.replace('.', '\\.')}\\(`, 'i'));
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.slice(start).search(/\n(\$function\$|\$\$|end \$\$);/);
  return sql.slice(start, start + end);
};

describe('K2 — chặn lúc lưu', () => {
  it('ca 1: lưu / ghi nợ bảng đối soát khác giá phiếu giao (không phải giá HĐ) phải có lý do', () => {
    const save = fn('public.save_procurement_contract_statement_v1');
    expect(save).toContain("message = 'PROCUREMENT_STATEMENT_NOTE_PRICE_REASON'");
    expect(save.indexOf('PROCUREMENT_STATEMENT_NOTE_PRICE_REASON')).toBeLessThan(save.indexOf('insert into public.supplier_delivery_statements'));
    const post = fn('public.post_supplier_delivery_statement');
    expect(post).toContain("message = 'PROCUREMENT_STATEMENT_NOTE_PRICE_REASON'");
    expect(post.indexOf('PROCUREMENT_STATEMENT_NOTE_PRICE_REASON')).toBeLessThan(post.indexOf("    status = 'posted',"));
    expect(fn('public.get_procurement_contract_v1')).toContain("'notePrice', note_price");
    // Luật: đúng giá HĐ thì không cần lý do (cùng điều kiện với chặn).
    expect(fn('app_private.control_rule_statement_price_no_reason')).toContain('sl.contract_unit_price is null or');
  });

  it('ca 2: kết thúc đề xuất / đóng nhu cầu còn đơn mở phải xác nhận từng đơn; đơn của đề xuất đã kết thúc không gửi / duyệt', () => {
    for (const name of ['public.end_material_request_supply_v1', 'app_private.procurement_legacy_close_v1']) {
      const body = fn(name);
      expect(body, name).toContain('app_private.material_request_open_pos_acked(v_open, p_input->\'openPoAck\')');
      expect(body, name).toContain("message = 'MR_SUPPLY_OPEN_PO'");
    }
    // Xác nhận thiếu (null) phải ra false — không để NULL lọt qua "if not".
    expect(fn('app_private.material_request_open_pos_acked')).toMatch(/coalesce\(jsonb_typeof\(p_ack\) = 'array' and .*, false\)/);
    const tr = fn('public.transition_procurement_hub_po_v1');
    expect(tr).toContain("message = 'PROCUREMENT_PO_NEED_ENDED'");
    expect(tr).toContain("v_action in ('submit', 'approve')");
  });

  it('ca 3: VAT đợt giao khác VAT đơn bắt lý do khi lập đợt / đổi VAT; đợt cũ không bị chặn khi nhận', () => {
    const g = fn('app_private.guard_delivery_batch_vat_reason');
    expect(g).toContain("if tg_op = 'UPDATE' and new.vat_rate is not distinct from old.vat_rate then return new; end if;");
    expect(g).toContain('PURCHASE_DELIVERY_VAT_REASON');
    expect(sql).toContain('before insert or update of vat_rate, vat_reason on public.purchase_order_delivery_batches');
    const save = fn('public.save_procurement_delivery_v1');
    expect(save).toContain('v_vat := coalesce(v_vat, v_po.vat_rate, 0);');
    expect(save).toContain("set_config('app.delivery_vat_reason'");
    expect(fn('app_private.control_rule_batch_vat_differs')).toContain("coalesce(btrim(b.vat_reason), '') = ''");
  });

  it('ca 4: gửi duyệt đặt vượt bắt lý do; người duyệt ghi lý do khi duyệt; lưu đơn nhận lý do từng dòng', () => {
    const tr = fn('public.transition_procurement_hub_po_v1');
    expect(tr.match(/PROCUREMENT_PO_EXCESS_REASON_REQUIRED/g)).toHaveLength(2);
    expect(tr).toContain("p_input->>'excessReason'");
    expect(fn('app_private.procurement_legacy_save_po_v1')).toContain("al.value->>'excessReason'");
    // Cộng các đơn lập trước, dung sai 2% (như "đủ hàng").
    expect(fn('app_private.procurement_po_excess_missing')).toContain('prl.requested_qty * 1.02');
    expect(fn('app_private.procurement_request_line_ordered_before')).toContain('(p.created_at, p.id) < (p_created_at, p_po_id)');
  });

  it('ca 5 + 6: sửa số nhận không thấp hơn số đang trả NCC; giảm giá trị đợt không đụng status; ghi công nợ tính phần đã sửa', () => {
    const fix = fn('public.correct_purchase_receipt_v1');
    expect(fix).toContain('PURCHASE_FIX_RETURN_PENDING');
    expect(fix).toContain("r.status in ('pending', 'completed')");
    const gross = fix.indexOf('set accepted_gross_amount = round(coalesce(accepted_gross_amount, 0) - v_total_gross, 2)');
    expect(gross).toBeGreaterThan(fix.indexOf('set status = v_status'));
    expect(fix.slice(gross, fix.indexOf(';', gross))).not.toContain('status');
    const post = fn('app_private.post_purchase_receipt_finance_v2');
    expect(post).toContain('<> v_received_gross + v_corrected');
    expect(post.match(/v_received_gross \+ v_corrected/g)).toHaveLength(2);
    expect(sql).toMatch(/update public\.purchase_order_delivery_batches b\s+set accepted_gross_amount = round\(b\.accepted_gross_amount - c\.amount, 2\)/);
    expect(fn('app_private.control_rule_ledger_vs_accepted')).toContain("t.source_type = 'purchase_receipt_correction'");
  });

  it('Trợ lý giải thích được 6 mã lỗi mới', () => {
    const cases: Array<[string, string]> = [
      ['PROCUREMENT_STATEMENT_NOTE_PRICE_REASON', 'statement_note_price'],
      ['MR_SUPPLY_OPEN_PO', 'mr_open_po'],
      ['PROCUREMENT_PO_NEED_ENDED', 'po_need_ended'],
      ['PROCUREMENT_PO_EXCESS_REASON_REQUIRED', 'po_excess_reason'],
      ['PURCHASE_DELIVERY_VAT_REASON: VAT đợt 0% khác VAT đơn 8%', 'delivery_vat_reason'],
      ['PURCHASE_FIX_RETURN_PENDING: Số đúng nhỏ hơn', 'receipt_fix_return_pending'],
    ];
    for (const [text, id] of cases) expect(explainError(text)[0]?.id, text).toBe(id);
  });
});
