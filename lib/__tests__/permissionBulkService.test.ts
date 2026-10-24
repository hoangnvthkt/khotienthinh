import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_PAGE,
  BULK_APPLY_CHUNK,
  COPY_APPLY_CHUNK,
  auditText,
  chunk,
  isUnclearReason,
  searchGrantable,
  toAuditRows,
  toGrantableItems,
  toBulkPreviewRows,
  toCopyPreviewRows,
  type AuditRow,
} from '../permissions/permissionBulkService';

const audit = (patch: Partial<AuditRow>): AuditRow => ({
  id: '1', at: '2026-10-23T14:27:07Z', eventType: 'user_authorization_v2_updated', kind: 'change', actor: 'Admin Hoàng', target: 'Nguyễn Quang Thuận',
  reason: 'Theo chức danh', before: null, after: null, added: null, removed: null, template: null, rule: null, controlOwner: null, until: null, room: null, project: null,
  ...patch,
});

describe('Trung tâm phân quyền bước 3 — lớp dịch vụ', () => {
  it('chia lô để mỗi lần gọi máy chủ dưới 8 s', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(BULK_APPLY_CHUNK).toBeLessThanOrEqual(10);
    expect(COPY_APPLY_CHUNK).toBeLessThanOrEqual(5);
    expect(AUDIT_PAGE).toBe(100);
  });

  it('đánh dấu lý do chưa rõ như chủ SP thấy trên Cloud, không bắt Room phải có lý do', () => {
    ['Screenshot 2026-09-22 at 11.14.25', '3D XIN HAI.ifc', 'Okokokokok', 'okokokokok', 'thuannq@tienthinhjsc.vn', 'claude-haiku-5-5', 'Lý do thay đổi', 'Preview thay đổi grant mới', '']
      .forEach(reason => expect(isUnclearReason(audit({ reason })), reason).toBe(true));
    expect(isUnclearReason(audit({ reason: 'Nguyễn Quang Thuận' }))).toBe(true);
    ['Theo chức danh', 'Đã nghỉ việc', 'khôi phục', 'Đợt 3: gắn mẫu quyền theo bộ phận (chủ SP duyệt 23/10/2026)', 'XEM TÀI CHÍNH VÀ HỢP ĐỒNG']
      .forEach(reason => expect(isUnclearReason(audit({ reason })), reason).toBe(false));
    expect(isUnclearReason(audit({ kind: 'room', reason: '' }))).toBe(false);
  });

  it('viết nhật ký bằng lời thường', () => {
    expect(auditText(audit({ eventType: 'user_template_assignment_saved', kind: 'template', template: 'Kế toán', added: 21, removed: 0 })))
      .toBe('gắn mẫu Kế toán cho Nguyễn Quang Thuận (thêm 21)');
    expect(auditText(audit({ eventType: 'sod_existing_conflict_acknowledged', kind: 'sod', target: 'Bùi Thị Tâm', rule: 'Mua hàng + Thủ kho', controlOwner: 'Nguyễn Thị Hương', until: '2027-04-23T14:27:07Z' })))
      .toBe('ghi nhận kiêm nhiệm Mua hàng + Thủ kho của Bùi Thị Tâm, Nguyễn Thị Hương kiểm soát đến 23/04/2027');
    expect(auditText(audit({ eventType: 'replace_project_permission_room_members', kind: 'room', target: null, room: 'Nhật ký công trường', project: 'Sơn Miền Bắc' })))
      .toBe('đổi thành viên Room Nhật ký công trường — Sơn Miền Bắc');
    expect(auditText(audit({ before: 80, after: 81 }))).toBe('đổi quyền của Nguyễn Quang Thuận (80 → 81 quyền)');
  });

  it('chỉ đưa quyền cấp riêng được, phạm vi toàn công ty hoặc của mình, tìm không dấu', () => {
    const action = (permissionCode: string, label: string, scopeTypes: string[], directGrantAllowed = true, riskLevel = 'important') =>
      ({ action: 'x', permissionCode, label, scopeTypes, directGrantAllowed, riskLevel, grantReadiness: 'enforced', directGrantRequiresExpiry: false, isDefaultView: false });
    const items = toGrantableItems({ generatedAt: '', applications: [{ code: 'hrm', label: 'Nhân sự', hasDefaultViewBundle: false, modules: [{ code: 'hrm.attendance', label: 'Chấm công', actions: [
      action('hrm.attendance.approve', 'Duyệt/chốt công', ['global', 'direct_reports']),
      action('booking.vehicle.create', 'Đặt xe', ['own']),
      action('wms.transaction.keeper', 'Thủ kho', ['warehouse']),
      action('system.authorization.manage_grants', 'Quản lý cấp quyền', ['global'], false, 'sensitive'),
    ] }] }] } as any);
    expect(items.map(item => `${item.code}@${item.scopeType}`)).toEqual(['hrm.attendance.approve@global', 'booking.vehicle.create@own']);
    expect(searchGrantable(items, 'duyet cong').map(item => item.code)).toEqual(['hrm.attendance.approve']);
  });

  it('đọc kết quả máy chủ an toàn khi thiếu trường', () => {
    expect(toBulkPreviewRows({ rows: [{ userId: 'u1', name: 'A', skip: true, note: 'Đã theo mẫu này' }] })[0])
      .toMatchObject({ userId: 'u1', skip: true, add: 0, remove: 0, warnings: [] });
    expect(toCopyPreviewRows({ rows: [{ userId: 'u1', name: 'A', lines: [{ text: 'x', tone: 'bad' }] }] })[0].lines[0].tone).toBe('ok');
    expect(toAuditRows({ rows: [{ id: 'e1', at: 'x', kind: 'weird', actor: null }] })[0]).toMatchObject({ kind: 'change', actor: 'Hệ thống', before: null });
    expect(toAuditRows(null)).toEqual([]);
  });
});

describe('migration 20261030160000 — hàng loạt, sao chép, nhật ký', () => {
  const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261030160000_permission_center_bulk_copy_log.sql'), 'utf8');

  it('chỉ người quản lý phân quyền chạy được, không áp cho Admin', () => {
    ['preview_bulk_permission_change_v1', 'apply_bulk_permission_change_v1', 'preview_copy_permissions_v1', 'apply_copy_permissions_v1'].forEach(name => {
      const start = sql.indexOf(`create or replace function public.${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      expect(sql.slice(start, start + 2500)).toContain("assert_authorization_permission('system.authorization.manage_grants')");
    });
    expect(sql.match(/u\.role <> 'ADMIN'/g)?.length).toBe(4);
    expect(sql).toContain('revoke all on function public.apply_bulk_permission_change_v1(uuid[], jsonb, text, jsonb) from public, anon;');
  });

  it('lưu từng người qua đường lưu quyền chuẩn và tách lỗi từng người', () => {
    expect(sql).toContain('public.save_user_template_assignment_v1(v_user.id');
    expect(sql).toContain('app_private.replace_user_permission_grants_v2_impl(v_user.id');
    expect(sql.match(/exception when others then\n\s+v_failed := v_failed/g)?.length).toBe(2);
    expect(sql).toContain("char_length(v_reason) < 10");
  });

  it('xét kiêm nhiệm trên tổ hợp mẫu + quyền chép và không chép hành động Room chỉ ghi nhận', () => {
    expect(sql).toContain('app_private.center_copy_final_grants(v_user.id, case when v_template_changes then v_src.template_code end');
    expect(sql).toContain("b.enforcement_status = 'audit_only'");
  });

  it('nhật ký gộp dòng đổi quyền riêng trùng lý do và giới hạn 300 dòng', () => {
    expect(sql).toContain("o.metadata ->> 'reason' is not distinct from e.metadata ->> 'reason'");
    expect(sql).toContain('least(coalesce(p_limit, 100), 300)');
  });
});
