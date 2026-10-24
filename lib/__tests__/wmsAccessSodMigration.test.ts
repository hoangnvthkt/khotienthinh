import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ownersErrorMessage, toWmsAccessPreview } from '../wmsCatalogService';

const sql = readFileSync(new URL('../../supabase/migrations/20261030180000_wms_access_sod.sql', import.meta.url), 'utf8');
const body = (name: string) => {
  const start = sql.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('\n$$;', start));
};

describe('Phân quyền kho qua luật kiêm nhiệm (20261030180000)', () => {
  it('xem trước và lưu dùng chung một kế hoạch, chỉ người sửa được phân quyền kho', () => {
    ['public.preview_wms_access_v1', 'public.save_wms_access_v1'].forEach(name => {
      const fn = body(name);
      expect(fn).toContain('app_private.wms_can_edit_access(v_actor)');
      expect(fn).toContain('perform app_private.wms_access_plan(p);');
    });
    expect(sql).toContain('drop function if exists public.save_wms_access_v1(jsonb);');
    expect(sql).toContain('create function public.save_wms_access_v1(p jsonb, p_reason text default null, p_ack jsonb default null)');
  });

  it('kiêm nhiệm mới phải ghi nhận; người không quản lý phân quyền thì không lưu được cặp kiêm nhiệm', () => {
    const save = body('public.save_wms_access_v1');
    expect(save).toContain("message = 'WMS_ACCESS_SOD_ADMIN_REQUIRED'");
    expect(save).toContain("app_private.assert_and_record_sod_warnings(");
    expect(save).toContain("app_private.center_acceptances(v_person -> 'warnings', p_ack), 'WMS_ACCESS'");
    expect(body('app_private.wms_access_sod')).toContain('app_private.evaluate_direct_grant_replacement_impl(p_actor, v_user.id, app_private.wms_access_next_grants(v_user.id))');
  });

  it('gỡ quyền mẫu ở kho thì mẫu ghi bỏ riêng; mỗi người một dòng nhật ký, giữ dòng tổng cho Lịch sử kho', () => {
    const save = body('public.save_wms_access_v1');
    expect(save).toContain('perform app_private.adopt_user_template_state(v_user.id);');
    expect(save).toContain("'wms_access_changed'");
    expect(save).toContain("'wms_access_saved'");
    expect(save).toContain("'source', 'wms_owners'");
    expect(save).toContain("'Phân quyền kho: ' || coalesce(nullif(btrim(p_reason), ''), 'cập nhật việc kho')");
    expect(sql).toContain("'work_pilot_access_granted', 'work_pilot_access_revoked', 'wms_access_changed') then 'change'");
  });

  it('đọc kết quả xem trước an toàn', () => {
    const preview = toWmsAccessPreview({ added: 1, removed: 0, lines: ['+ Bùi Quang Chung — wms.transaction.keeper @ Kho Sơn Miền Bắc'],
      sod: [{ userId: 'u1', name: 'Bùi Quang Chung', warnings: [{ ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', scopeType: 'warehouse', scopeId: 'wh' }] }] });
    expect(preview.sod[0].warnings[0]).toMatchObject({ ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', permissions: [], controls: [] });
    expect(preview.needsAdmin).toBe(false);
    expect(toWmsAccessPreview(null)).toEqual({ added: 0, removed: 0, lines: [], sod: [], needsAdmin: false });
  });

  it('báo lỗi kiêm nhiệm bằng lời', () => {
    expect(ownersErrorMessage(new Error('SoD warning acknowledgement required'))).toBe('Thay đổi này tạo kiêm nhiệm — ghi nhận trước khi lưu.');
    expect(ownersErrorMessage(new Error('WMS_ACCESS_SOD_ADMIN_REQUIRED'))).toContain('nhờ người quản lý phân quyền');
  });
});

describe('vá xét kiêm nhiệm khi đổi việc kho của ADMIN (20261030190000)', () => {
  const fix = readFileSync(new URL('../../supabase/migrations/20261030190000_wms_access_sod_admin_fix.sql', import.meta.url), 'utf8');
  it('bỏ qua tài khoản ADMIN và chỉ đưa quyền cấp riêng được vào bộ xét', () => {
    expect(fix).toContain("and u.role <> 'ADMIN'");
    expect(fix).toContain("a.direct_grant_allowed and a.permission_code <> 'system.settings.manage'");
  });
});
