import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_SCHEMA, normalizeRead } from '../../supabase/functions/wms-doc-reader/prompt';

const sql = readFileSync('supabase/migrations/20261016200000_wms_capture_supplier_match.sql', 'utf8');

// Kho PR-2 (chủ SP 16/10): NCC trên phiếu giao khớp danh mục Đối tác; chưa có thì "NCC mới" để Mua hàng tạo.
describe('khớp NCC phiếu giao', () => {
  it('AI đọc thêm MST, địa chỉ bên giao', () => {
    expect(DOC_SCHEMA.required).toEqual(expect.arrayContaining(['supplierTaxCode', 'supplierAddress']));
    const r = normalizeRead({ supplierName: 'Hợp Thành', supplierTaxCode: ' MST: 0101234567 ', supplierAddress: ' Đông Anh ', lines: [] });
    expect(r.supplierTaxCode).toBe('0101234567');
    expect(r.supplierAddress).toBe('Đông Anh');
    expect(normalizeRead({}).supplierTaxCode).toBeNull();
  });

  it('so phần lõi tên: bỏ chữ loại hình, hiểu ĐTTM; MST "0" không tính', () => {
    expect(sql).toContain("'\\m(cty|ctcp)\\M', 'cong ty'");
    expect(sql).toMatch(/cong ty\|tnhh\|co phan.*\|dttm\|/);
    expect(sql).toContain("length(d) >= 10 and d !~ '^0+$'");
  });

  it('tự chọn khi chắc chắn (≥ 0,9), người chọn thì học tên, NCC mới giữ nguyên khi AI đọc lại', () => {
    expect(sql).toContain("supplier_id = case when v_best.score >= 0.9 then v_best.id end");
    expect(sql).toContain("elsif coalesce(v_c.supplier_match, 'auto') = 'auto'");
    expect(sql).toContain('insert into public.wms_supplier_aliases (alias_key, alias_text, partner_id, created_by)');
    expect(sql).toContain("when p->>'supplierMatch' = 'new' then 'new'");
  });

  it('gợi ý đơn: NCC đã khớp thì so đúng NCC của đơn', () => {
    expect(sql).toContain('when v_c.supplier_id is not null then (case when v_po.vendor_id = v_c.supplier_id then 1 else 0 end)');
  });

  it('thủ kho không ghi thẳng bảng học tên', () => {
    expect(sql).toContain('revoke insert, update, delete on public.wms_supplier_aliases from anon, authenticated;');
  });
});
