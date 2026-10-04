import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137200_wms_v1_2_owners.sql', import.meta.url), 'utf8');

describe('V1-2 Module Vật tư — Người phụ trách kho', () => {
  it('thủ kho theo ô quyền, không còn đọc vai trò tài khoản', () => {
    const patched = sql.split('-- @@')[0];
    expect(sql).toContain("'wms.transaction.keeper'");
    // Ngoài bước chuyển đổi (backfill), không hàm nào còn so role = WAREHOUSE_KEEPER.
    const roleChecks = patched.match(/role::text\s*(=|in)\s*\(?'WAREHOUSE_KEEPER'/g) || [];
    expect(roleChecks.length).toBe(1);
  });
  it('duyệt ngoại lệ: chỉ người được giao, không tự duyệt', () => {
    expect(sql).toContain('WMS_EXCEPTION_APPROVE_DENIED');
    expect(sql).toContain('WMS_EXCEPTION_SELF_APPROVE');
    expect(sql).toContain('wms_user_can_approve_exception(v_user.id');
  });
  it('màn Người phụ trách: chỉ Admin lưu, người khóa kỳ phải là kế toán kho', () => {
    expect(sql).toContain('WMS_OWNERS_EDIT_DENIED');
    expect(sql).toContain('WMS_OWNERS_CLOSER_NOT_ACCOUNTANT');
    expect(sql).toContain("'source', 'wms_owners'");
  });
});
