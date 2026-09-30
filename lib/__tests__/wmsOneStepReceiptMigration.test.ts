import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261003150000_wms_one_step_receipt.sql'), 'utf8');

describe('Nhận hàng một bước', () => {
  it('checks quality and finalizes in the same command, reusing the permission-checked functions', () => {
    expect(sql).toContain('perform public.approve_material_po_quality(');
    expect(sql).toContain('return public.finalize_material_po_receipt(');
  });

  it('moves legacy wms_pending deliveries to receiving and refuses anything already closed', () => {
    expect(sql).toContain("if v_batch.status = 'wms_pending' and v_tx_status = 'PENDING' then");
    expect(sql).toContain("message = 'PURCHASE_RECEIPT_NOT_RECEIVABLE'");
  });
});
