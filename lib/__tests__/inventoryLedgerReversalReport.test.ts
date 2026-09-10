import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260905041938_material_issue_approval_reversal_return.sql');
const reports = read('pages/Reports.tsx');
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

  it('renders, filters, exports, and fallback-calculates reversal receipts separately', () => {
    expect(reports).toContain("{ value: 'reversal', label: 'Đảo giao dịch' }");
    expect(reports).toContain('inReversal: 0');
    expect(reports).toContain("entry.transactionType === 'reversal'");
    expect(reports).toContain("tx.businessEventType === 'reversal'");
    expect(reports).toContain('row.inReversal');
    expect(reports).toContain("'Nhập đảo': row.inReversal");
  });

  it('exports reversal to MISA as a compensating receipt referencing the original voucher', () => {
    expect(misa).toContain("tx.businessEventType === 'reversal'");
    expect(misa).toContain('Đảo phiếu xuất');
    expect(misa).toContain('tx.reversalOfTransactionId');
  });
});
