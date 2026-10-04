import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WMS_ACCESS_TEMPLATES, accessDiff, accessFromGrants, applyTemplate, canPropose, copyJobs, handOver, jobsOf, legacyGroups, viewImplied, type WmsAccessData,
} from '../wmsAccess';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137300_wms_access_jobs.sql', import.meta.url), 'utf8');

const W1 = 'wh-smb', W2 = 'wh-xhv';
const data: WmsAccessData = {
  can: { edit: true },
  warehouses: [{ id: W1, name: 'Kho Sơn Miền Bắc', type: 'SITE', project: null }, { id: W2, name: 'Kho Xin Hai Vina', type: 'SITE', project: null }],
  users: ['linh', 'mo', 'luat', 'huong', 'admin', 'new'].map(id => ({ id, name: id, role: 'EMPLOYEE', position: null })),
  grants: [
    { userId: 'linh', code: 'wms.inventory.view', scopeType: 'global', scopeId: '*' },
    { userId: 'linh', code: 'wms.master_data.issue_code', scopeType: 'global', scopeId: '*' },
    { userId: 'linh', code: 'wms.master_data.manage', scopeType: 'global', scopeId: '*' },
    { userId: 'mo', code: 'wms.master_data.issue_code', scopeType: 'global', scopeId: '*' },
    { userId: 'mo', code: 'wms.transaction.exception_approve', scopeType: 'global', scopeId: '*' },
    { userId: 'luat', code: 'wms.transaction.keeper', scopeType: 'warehouse', scopeId: W1 },
    { userId: 'luat', code: 'wms.inventory.view', scopeType: 'warehouse', scopeId: W1 },
    { userId: 'luat', code: 'wms.transaction.approve', scopeType: 'warehouse', scopeId: W1 },
    { userId: 'luat', code: 'wms.inventory.edit', scopeType: 'warehouse', scopeId: W2 },
    { userId: 'huong', code: 'wms.accounting.manage', scopeType: 'global', scopeId: '*' },
    { userId: 'huong', code: 'wms.accounting.close_period', scopeType: 'global', scopeId: '*' },
    { userId: 'admin', code: 'settings.warehouses.manage', scopeType: 'global', scopeId: '*' },
  ],
  activity: [], log: [],
};
const wh = (id: string) => id;

describe('Phân quyền kho — đọc việc từ ô quyền', () => {
  const a = accessFromGrants(data);
  it('gom ô quyền thành việc', () => {
    expect(a.viewAll).toEqual(['linh']);
    expect(a.viewWh[W1]).toEqual(['luat']);
    expect(a.keepers[W1]).toEqual(['luat']);
    expect(a.code.sort()).toEqual(['linh', 'mo']);
    expect(a.closer).toBe('huong');
    // Quản lý danh sách kho = settings.warehouses.manage hoặc ô cũ wms.master_data.manage
    expect(a.whAdmin.sort()).toEqual(['admin', 'linh']);
  });
  it('Cấp mã / Duyệt ngoại lệ / Kế toán kho tự kèm Xem kho; thủ kho, Cấp mã tự Đề xuất mã', () => {
    expect(viewImplied(a, 'huong')).toBe(true);
    expect(viewImplied(a, 'luat')).toBe(false);
    expect(canPropose(a, 'luat')).toBe(true);
    expect(canPropose(a, 'mo')).toBe(true);
    expect(canPropose(a, 'new')).toBe(false);
  });
  it('người có việc kèm Xem mà chưa có ô Xem → có dòng thay đổi để lưu được', () => {
    expect(accessDiff(a, a, x => x || '—', wh)).toEqual(['+ mo — Xem kho mọi kho (kèm việc)', '+ huong — Xem kho mọi kho (kèm việc)']);
  });
  it('ô lẻ kiểu cũ: đã nằm trong Thủ kho hay chưa thuộc việc nào', () => {
    const g = legacyGroups(data, a);
    expect(g.find(x => x.scopeId === W1)?.verdict).toBe('covered');
    expect(g.find(x => x.scopeId === W2)?.verdict).toBe('loose');
  });
});

describe('Phân quyền kho — điền nhanh', () => {
  const a = accessFromGrants(data);
  it('mẫu "Phụ trách Vật tư" = như chị Mơ', () => {
    const t = WMS_ACCESS_TEMPLATES.find(x => x.k === 'materialHead')!;
    const n = applyTemplate(a, 'new', t, false);
    expect(n.code).toContain('new');
    expect(n.exception).toContain('new');
    expect(n.viewAll).toContain('new');
  });
  it('mẫu "Kế toán trưởng" chuyển hẳn người khóa kỳ (một người)', () => {
    const n = applyTemplate(a, 'new', WMS_ACCESS_TEMPLATES.find(x => x.k === 'chiefAccountant')!, false);
    expect(n.closer).toBe('new');
    expect(n.accounting).toEqual(expect.arrayContaining(['huong', 'new']));
  });
  it('giống một người: chép cả kho thủ kho', () => {
    const n = copyJobs(a, 'luat', 'new');
    expect(n.keepers[W1]).toEqual(['luat', 'new']);
    expect(n.viewWh[W1]).toContain('new');
  });
  it('bàn giao: người cũ mất hết việc, tùy chọn giữ xem', () => {
    const n = handOver(a, 'mo', 'new', true);
    expect(jobsOf(n, 'mo', wh)).toEqual(['Xem kho: mọi kho']);
    expect(n.code).toContain('new');
    expect(n.exception).toEqual(['new']);
    const lines = accessDiff(a, n, x => x || '—', wh);
    expect(lines).toContain('+ new — Xem kho mọi kho (kèm việc)');
    expect(lines).toContain('− mo — Duyệt ngoại lệ');
    expect(lines).toContain('+ new — Duyệt ngoại lệ');
  });
});

describe('Phân quyền kho — migration', () => {
  it('thủ kho không ngầm có việc quản trị / ghi sổ ở kho mình giữ', () => {
    expect(sql).toContain('create function app_private.wms_keeper_excluded_action');
    for (const code of ['wms.master_data.manage', 'wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage', 'wms.accounting.close_period']) {
      expect(sql).toMatch(new RegExp(`wms_keeper_excluded_action[\\s\\S]*'${code.replace(/\./g, '\\.')}'`));
    }
    expect(sql.match(/not app_private\.wms_keeper_excluded_action\(p_permission_code\)/g)?.length).toBe(2);
  });
  it('lưu: chỉ Admin, kích hoạt lại dòng đã thu hồi, việc kèm Xem kho, nhật ký wms_owners', () => {
    expect(sql).toContain('WMS_OWNERS_EDIT_DENIED');
    expect(sql).toContain('on conflict (user_id, permission_code, scope_type, scope_id) do update set is_active = true');
    expect(sql).toContain("where w.code in ('wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage')");
    expect(sql).toContain("'source', 'wms_owners'");
  });
  it('mẫu quyền Cài đặt: phần kho chỉ còn Xem kho', () => {
    expect(sql).toContain('update public.user_permission_templates t');
    expect(sql).toContain("not in ('wms.inventory.view', 'wms.transaction.view', 'wms.request.view')");
  });
});
