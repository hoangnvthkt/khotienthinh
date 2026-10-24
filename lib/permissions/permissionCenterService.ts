import { supabase } from '../supabase';

// Trung tâm phân quyền (chủ SP duyệt mockup 23/10/2026): một chỗ xem ai làm được gì, gắn mẫu theo vị trí.
// Dữ liệu từ get_permission_center_v1 (chỉ người quản lý phân quyền); lọc / nhóm / đếm ở đây để test được.

export interface CapabilityRow { ab: string; title: string; text: string }

export interface CenterTemplateOption { key: string; label: string; description: string | null }

export interface CenterTemplate {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  itemCount: number;
  people: number;
  summary: CapabilityRow[];
  options: CenterTemplateOption[];
}

export interface CenterConflict { rule: string; scope: string; until: string | null; controlOwner: string | null }

export interface CenterPerson {
  userId: string;
  name: string;
  department: string;
  position: string;
  avatar: string | null;
  templateCode: string | null;
  /** Khóa ô tích (po_approver, chief_accountant…). */
  options: string[];
  grantCount: number;
  sensitive: string[];
  extraCount: number;
  extra: string[];
  expiringSoon: number;
  warehouses: string[];
  hrRoles: string[];
  roomProjects: number;
  conflicts: CenterConflict[];
}

export interface PermissionCenterData {
  generatedAt: string;
  templates: CenterTemplate[];
  people: CenterPerson[];
}

export type CenterKpiKey = 'all' | 'templated' | 'conflicts' | 'sensitive' | 'extra' | 'expiring';

export interface CenterFilter {
  query: string;
  templateCode: string | null;
  kpi: CenterKpiKey;
}

export interface CenterKpi {
  key: CenterKpiKey;
  label: string;
  value: string;
  hint: string;
}

export interface DepartmentGroup {
  name: string;
  people: CenterPerson[];
  /** Tỉ lệ người theo từng mẫu trong nhóm (cho dải màu). */
  mix: { templateCode: string | null; count: number }[];
}

/** Màu theo mẫu: mỗi mẫu một màu cố định, đủ khác độ sáng; mẫu mới dùng màu xám. */
export const TEMPLATE_COLORS: Record<string, { solid: string; tint: string; text: string }> = {
  executive: { solid: '#6d28d9', tint: '#f3effd', text: '#5b21b6' },
  finance_director: { solid: '#4338ca', tint: '#eef0fc', text: '#3730a3' },
  accountant: { solid: '#0369a1', tint: '#e8f3fa', text: '#075985' },
  material_staff: { solid: '#1d4ed8', tint: '#eaf0fd', text: '#1e40af' },
  warehouse_manager: { solid: '#0f766e', tint: '#e7f4f2', text: '#115e59' },
  hr_staff: { solid: '#a21caf', tint: '#f8ebfa', text: '#86198f' },
  site_staff: { solid: '#3b7d23', tint: '#edf5e9', text: '#2f6a1b' },
  basic_employee: { solid: '#475569', tint: '#eff2f5', text: '#334155' },
};
const NO_TEMPLATE = { solid: '#94a3b8', tint: '#f1f5f9', text: '#475569' };
export const templateColor = (code: string | null | undefined) => (code && TEMPLATE_COLORS[code]) || NO_TEMPLATE;

export const NO_DEPARTMENT = 'Chưa có phòng';

/** Chữ cái đầu của tên gọi (từ cuối) cho ảnh đại diện chữ. */
export const initialOf = (name: string) => {
  const words = name.trim().split(/\s+/);
  return (words[words.length - 1] || '?').charAt(0).toUpperCase();
};

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export const filterPeople = (people: readonly CenterPerson[], filter: CenterFilter): CenterPerson[] => {
  const q = normalize(filter.query.trim());
  return people.filter(person => {
    if (filter.templateCode && person.templateCode !== filter.templateCode) return false;
    if (filter.kpi === 'templated' && !person.templateCode) return false;
    if (filter.kpi === 'conflicts' && person.conflicts.length === 0) return false;
    if (filter.kpi === 'sensitive' && person.sensitive.length === 0) return false;
    if (filter.kpi === 'extra' && person.extraCount === 0) return false;
    if (filter.kpi === 'expiring' && person.expiringSoon === 0) return false;
    if (q && !normalize(`${person.name} ${person.position} ${person.department}`).includes(q)) return false;
    return true;
  });
};

/** Nhóm theo phòng ban / công trường; người chưa có phòng xếp cuối. */
export const groupByDepartment = (people: readonly CenterPerson[]): DepartmentGroup[] => {
  const groups = new Map<string, CenterPerson[]>();
  people.forEach(person => {
    const key = person.department || NO_DEPARTMENT;
    groups.set(key, [...(groups.get(key) || []), person]);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_DEPARTMENT ? 1 : b === NO_DEPARTMENT ? -1 : a.localeCompare(b, 'vi')))
    .map(([name, members]) => {
      const mix = new Map<string | null, number>();
      members.forEach(member => mix.set(member.templateCode, (mix.get(member.templateCode) || 0) + 1));
      return {
        name,
        people: [...members].sort((a, b) => a.name.localeCompare(b.name, 'vi')),
        mix: [...mix.entries()].map(([templateCode, count]) => ({ templateCode, count })),
      };
    });
};

export const buildKpis = (people: readonly CenterPerson[]): CenterKpi[] => {
  const count = (test: (person: CenterPerson) => boolean) => people.filter(test).length;
  const conflicts = count(person => person.conflicts.length > 0);
  const acknowledged = count(person => person.conflicts.length > 0 && person.conflicts.every(conflict => Boolean(conflict.until)));
  const templated = count(person => Boolean(person.templateCode));
  return [
    { key: 'all', label: 'Người', value: String(people.length), hint: 'tài khoản đang làm việc' },
    { key: 'templated', label: 'Đã theo mẫu', value: `${templated}/${people.length}`, hint: templated === people.length ? 'sửa mẫu là cập nhật cả nhóm' : `${people.length - templated} người chưa có mẫu` },
    { key: 'conflicts', label: 'Kiêm nhiệm', value: String(conflicts), hint: conflicts ? `${acknowledged} đã ghi nhận` : 'không ai kiêm nhiệm' },
    { key: 'sensitive', label: 'Quyền nhạy cảm', value: String(count(person => person.sensitive.length > 0)), hint: 'người có quyền Admin cấp riêng' },
    { key: 'extra', label: 'Quyền ngoài mẫu', value: String(count(person => person.extraCount > 0)), hint: 'người có quyền riêng ngoài mẫu' },
    { key: 'expiring', label: 'Sắp hết hạn', value: String(count(person => person.expiringSoon > 0)), hint: 'người có quyền hết hạn trong 30 ngày' },
  ];
};

const toRows = (value: unknown): CapabilityRow[] => (Array.isArray(value) ? value : [])
  .filter((row: any) => row && typeof row.title === 'string')
  .map((row: any) => ({ ab: String(row.ab || row.title.slice(0, 2)).toUpperCase(), title: row.title, text: String(row.text || '') }));

export const toPermissionCenterData = (raw: unknown): PermissionCenterData => {
  const data = (raw || {}) as Record<string, any>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []) as string[];
  return {
    generatedAt: String(data.generatedAt || ''),
    templates: (Array.isArray(data.templates) ? data.templates : []).map((template: any) => ({
      code: String(template.code),
      name: String(template.name),
      description: template.description ?? null,
      sortOrder: Number(template.sortOrder || 0),
      itemCount: Number(template.itemCount || 0),
      people: Number(template.people || 0),
      summary: toRows(template.summary),
      options: (Array.isArray(template.options) ? template.options : []).map((option: any) => ({
        key: String(option.key), label: String(option.label), description: option.description ?? null,
      })),
    })),
    people: (Array.isArray(data.people) ? data.people : []).map((person: any) => ({
      userId: String(person.userId),
      name: String(person.name || ''),
      department: String(person.department || ''),
      position: String(person.position || ''),
      avatar: person.avatar || null,
      templateCode: person.templateCode || null,
      options: strings(person.options),
      grantCount: Number(person.grantCount || 0),
      sensitive: strings(person.sensitive),
      extraCount: Number(person.extraCount || 0),
      extra: strings(person.extra),
      expiringSoon: Number(person.expiringSoon || 0),
      warehouses: strings(person.warehouses),
      hrRoles: strings(person.hrRoles),
      roomProjects: Number(person.roomProjects || 0),
      conflicts: (Array.isArray(person.conflicts) ? person.conflicts : []).map((conflict: any) => ({
        rule: String(conflict.rule || ''), scope: String(conflict.scope || ''),
        until: conflict.until || null, controlOwner: conflict.controlOwner || null,
      })),
    })),
  };
};

export const permissionCenterService = {
  async load(): Promise<PermissionCenterData> {
    const { data, error } = await supabase.rpc('get_permission_center_v1');
    if (error) throw error;
    return toPermissionCenterData(data);
  },

  async saveSummary(code: string, summary: readonly CapabilityRow[]): Promise<void> {
    const { error } = await supabase.rpc('save_user_permission_template_summary_v1', {
      p_code: code,
      p_summary: summary.map(row => ({ ab: row.ab.trim().slice(0, 3).toUpperCase(), title: row.title.trim(), text: row.text.trim() })),
    });
    if (error) throw error;
  },
};
