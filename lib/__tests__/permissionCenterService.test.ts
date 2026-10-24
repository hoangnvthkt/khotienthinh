import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildKpis, filterPeople, groupByDepartment, initialOf, NO_DEPARTMENT, templateColor, toPermissionCenterData, type CenterPerson,
} from '../permissions/permissionCenterService';

const person = (patch: Partial<CenterPerson>): CenterPerson => ({
  userId: patch.name || 'u', name: 'Người', department: 'Ban lãnh đạo', position: '', avatar: null, templateCode: 'basic_employee', options: [],
  grantCount: 34, sensitive: [], extraCount: 0, extra: [], expiringSoon: 0, warehouses: [], hrRoles: [], roomProjects: 0, conflicts: [], ...patch,
});

const PEOPLE = [
  person({ name: 'Dương Xuân Thịnh', position: 'Tổng giám đốc', templateCode: 'executive', sensitive: ['Ghi nhận chi phí: Duyệt'] }),
  person({ name: 'Bùi Thị Tâm', department: 'Phòng Tài chính - Kế toán', templateCode: 'accountant', options: ['warehouse_accounting'],
    conflicts: [{ rule: 'Mua hàng + Thủ kho', scope: 'Kho Sơn Miền Bắc', until: '2027-04-23T00:00:00Z', controlOwner: 'Nguyễn Thị Hương' }], extraCount: 22 }),
  person({ name: 'Nguyễn Văn Vĩnh', department: '', templateCode: null }),
  person({ name: 'Đặng Thị Thu Hà', department: 'Phòng Vật tư - Thiết bị', templateCode: 'material_staff', expiringSoon: 1,
    conflicts: [{ rule: 'Mua hàng + Duyệt PO', scope: 'Toàn công ty', until: null, controlOwner: null }] }),
];

describe('Trung tâm phân quyền — lọc, nhóm, đếm', () => {
  it('finds people without typing Vietnamese accents', () => {
    expect(filterPeople(PEOPLE, { query: 'duong xuan', templateCode: null, kpi: 'all' }).map(p => p.name)).toEqual(['Dương Xuân Thịnh']);
    expect(filterPeople(PEOPLE, { query: 'tai chinh', templateCode: null, kpi: 'all' }).map(p => p.name)).toEqual(['Bùi Thị Tâm']);
    expect(filterPeople(PEOPLE, { query: 'đặng', templateCode: null, kpi: 'all' }).map(p => p.name)).toEqual(['Đặng Thị Thu Hà']);
  });

  it('filters by template and by the number tiles', () => {
    expect(filterPeople(PEOPLE, { query: '', templateCode: 'accountant', kpi: 'all' })).toHaveLength(1);
    expect(filterPeople(PEOPLE, { query: '', templateCode: null, kpi: 'conflicts' }).map(p => p.name)).toEqual(['Bùi Thị Tâm', 'Đặng Thị Thu Hà']);
    expect(filterPeople(PEOPLE, { query: '', templateCode: null, kpi: 'sensitive' })).toHaveLength(1);
    expect(filterPeople(PEOPLE, { query: '', templateCode: null, kpi: 'extra' })).toHaveLength(1);
    expect(filterPeople(PEOPLE, { query: '', templateCode: null, kpi: 'expiring' })).toHaveLength(1);
    expect(filterPeople(PEOPLE, { query: '', templateCode: null, kpi: 'templated' })).toHaveLength(3);
  });

  it('groups by department with people who have none listed last', () => {
    const groups = groupByDepartment(PEOPLE);
    expect(groups.map(group => group.name).at(-1)).toBe(NO_DEPARTMENT);
    expect(groups.find(group => group.name === 'Ban lãnh đạo')?.mix).toEqual([{ templateCode: 'executive', count: 1 }]);
  });

  it('counts the tiles from real fields and says who is still missing a template', () => {
    const kpis = Object.fromEntries(buildKpis(PEOPLE).map(kpi => [kpi.key, kpi]));
    expect(kpis.all.value).toBe('4');
    expect(kpis.templated.value).toBe('3/4');
    expect(kpis.templated.hint).toBe('1 người chưa có mẫu');
    expect(kpis.conflicts.value).toBe('2');
    expect(kpis.conflicts.hint).toBe('1 đã ghi nhận');
    expect(kpis.expiring.value).toBe('1');
  });

  it('reads a partial server answer safely and keeps colours per template', () => {
    const data = toPermissionCenterData({ templates: [{ code: 'site_staff', name: 'Cán bộ công trường', summary: [{ title: 'Kho công trường', text: 'Xem tồn' }, { text: 'không có tiêu đề' }] }],
      people: [{ userId: 'u1', name: 'A', conflicts: [{}], sensitive: ['x', 3] }] });
    expect(data.templates[0].summary).toEqual([{ ab: 'KH', title: 'Kho công trường', text: 'Xem tồn' }]);
    expect(data.people[0].sensitive).toEqual(['x']);
    expect(data.people[0].conflicts[0]).toEqual({ rule: '', scope: '', until: null, controlOwner: null });
    expect(templateColor('site_staff').solid).toBe('#3b7d23');
    expect(templateColor('mau_moi').solid).toBe('#94a3b8');
    expect(initialOf('Dương Xuân Thịnh')).toBe('T');
  });
});

describe('Trung tâm phân quyền — migration 20261030130000', () => {
  const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261030130000_permission_center.sql'), 'utf8');
  it('only permission admins read the overview and only Admin edits the plain-language summary', () => {
    expect(sql).toMatch(/create or replace function public\.get_permission_center_v1\(\)[\s\S]+if not app_private\.can_manage_permissions\(\) then/);
    expect(sql).toMatch(/create or replace function public\.save_user_permission_template_summary_v1[\s\S]+if not public\.is_admin\(\) then/);
    expect(sql).toContain('revoke all on function public.get_permission_center_v1() from public, anon;');
  });
  it('seeds the approved plain-language summary only where none was written yet, and never ships base64 avatars', () => {
    expect(sql).toContain("where t.code = s.code and t.summary = '[]'::jsonb;");
    expect(sql).toContain("'avatar', case when p.avatar ~ '^https?://' then p.avatar end");
    expect(sql).toContain("u.role <> 'ADMIN'");
  });
});
