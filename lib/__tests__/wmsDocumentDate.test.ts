import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Role, TransactionStatus, TransactionType, type Transaction, type User } from '../../types';
import { canSetWmsDocumentDate } from '../wmsPermissions';
import { catalogErrorMessage } from '../wmsCatalogService';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137500_wms_document_date.sql', import.meta.url), 'utf8');
const grant = (permissionCode: string, scopeType: string, scopeId: string) => ({ permissionCode, scopeType, scopeId, isActive: true });
const user = (role: Role, grants: any[] = []) => ({ id: 'u', name: 'u', role, permissionGrants: grants } as unknown as User);
const tx = (status: TransactionStatus) => ({ id: 't', type: TransactionType.IMPORT, status, targetWarehouseId: 'wh-smb', date: '2026-09-08', items: [] } as unknown as Transaction);

describe('Ngày chứng từ — ai sửa được', () => {
  it('thủ kho của kho trên phiếu, Kế toán kho, Admin', () => {
    expect(canSetWmsDocumentDate(user(Role.EMPLOYEE, [grant('wms.transaction.keeper', 'warehouse', 'wh-smb')]), tx(TransactionStatus.COMPLETED))).toBe(true);
    expect(canSetWmsDocumentDate(user(Role.EMPLOYEE, [grant('wms.transaction.keeper', 'warehouse', 'wh-xhv')]), tx(TransactionStatus.COMPLETED))).toBe(false);
    expect(canSetWmsDocumentDate(user(Role.EMPLOYEE, [grant('wms.accounting.manage', 'global', '*')]), tx(TransactionStatus.COMPLETED))).toBe(true);
    expect(canSetWmsDocumentDate(user(Role.ADMIN), tx(TransactionStatus.COMPLETED))).toBe(true);
    expect(canSetWmsDocumentDate(user(Role.EMPLOYEE), tx(TransactionStatus.COMPLETED))).toBe(false);
  });
  it('báo lỗi âm tồn bằng câu của máy chủ', () => {
    expect(catalogErrorMessage(new Error('WMS_BACKDATE_NEGATIVE: Xuất "Bê tông" ngày 01/07 làm âm tồn.'))).toBe('Xuất "Bê tông" ngày 01/07 làm âm tồn.');
    expect(catalogErrorMessage(new Error('WMS_DOC_DATE_REASON'))).toContain('lý do');
  });
  it('phiếu đã hủy không sửa ngày', () => {
    expect(canSetWmsDocumentDate(user(Role.ADMIN), tx(TransactionStatus.CANCELLED))).toBe(false);
  });
});

describe('Ngày chứng từ — migration', () => {
  it('số phiếu mới theo ngày chứng từ', () => {
    expect(sql).toContain('create function app_private.next_inventory_ledger_code(p_direction text, p_date timestamptz)');
    expect(sql).toContain("next_inventory_ledger_code('in', v_tx_date)");
    expect(sql).toContain("next_inventory_ledger_code('out', v_tx_date)");
  });
  it('sửa ngày: cần lý do khi đã ghi sổ, không ngày tương lai, không tạo âm tồn quá khứ, có nhật ký', () => {
    for (const code of ['WMS_DOC_DATE_REASON', 'WMS_DOC_DATE_FUTURE', 'WMS_BACKDATE_NEGATIVE', 'WMS_DOC_DATE_DENIED']) expect(sql).toContain(code);
    expect(sql).toContain('insert into public.wms_document_date_events');
    expect(sql).toContain('update public.inventory_ledger_entries set transaction_date = v_new');
  });
  it('nhập–xuất thẳng: sổ kho ghi nhập + xuất dùng thẳng, có lưu vết cho phiếu đã nhận', () => {
    expect(sql).toContain('create function app_private.sync_wms_direct_consumption_ledger');
    expect(sql).toContain("perform app_private.sync_wms_direct_consumption_ledger(new.id)");
    expect(sql).toContain("'direct_consumption'");
  });
});
