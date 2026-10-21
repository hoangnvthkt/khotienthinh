import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260905041938_material_issue_approval_reversal_return.sql');
const reports = read('pages/Reports.tsx');
const nxtMigration = read('supabase/migrations/20261024090000_inventory_nxt_report.sql');
const misa = read('pages/MisaExport.tsx');
const listService = read('lib/wmsTransactionListService.ts');

describe('inventory ledger reversal reporting contract', () => {
  it('projects and maps WMS reversal linkage', () => {
    expect(listService).toContain('reversal_of_transaction_id');
    expect(listService).toContain('idempotency_key');
    expect(listService).toContain('reversalOfTransactionId:');
    expect(listService).toContain('idempotencyKey:');
  });

  it('separates reversal receipts from ordinary imports in the ledger RPC', () => {
    expect(migration).toContain('get_inventory_ledger_report_pre_reversal_20260905');
    expect(migration).toContain("transaction_type = 'reversal'");
    expect(migration).toContain("'in_reversal'");
    expect(migration).toMatch(/in_import[\s\S]*in_transfer[\s\S]*in_adjustment[\s\S]*in_reversal/);
  });

  it('keeps reversal filterable in history and counts it as a receipt in the NXT table', () => {
    expect(reports).toContain("{ value: 'reversal', label: 'Đảo giao dịch' }");
    expect(reports).toContain("reversal: 'Đảo giao dịch'");
    // Bảng nhập xuất tồn (21/10/2026) thay bảng tổng hợp cũ: phiếu đảo là dòng nhập, cộng vào cột Nhập kho như MISA.
    expect(reports).not.toContain('Fallback từ transactions cũ');
    expect(nxtMigration).toContain("movement_direction = 'in'), 0) as in_value");
  });

  it('exports reversal to MISA as a compensating receipt referencing the original voucher', () => {
    expect(misa).toContain("tx.businessEventType === 'reversal'");
    expect(misa).toContain('Đảo phiếu xuất');
    expect(misa).toContain('tx.reversalOfTransactionId');
  });
});
