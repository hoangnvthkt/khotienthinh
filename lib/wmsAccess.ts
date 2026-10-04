// Phân quyền kho: 8 việc thay cho ~25 ô quyền kỹ thuật. Logic thuần (không gọi mạng) để màn Phân quyền kho và test dùng chung.
// Máy chủ: get_wms_access_v1 / save_wms_access_v1 (migration 20261008137300_wms_access_jobs.sql).

export interface WmsAccessData {
  can: { edit: boolean };
  warehouses: Array<{ id: string; name: string; type: string; project: string | null }>;
  users: Array<{ id: string; name: string; role: string; position: string | null }>;
  grants: Array<{ userId: string; code: string; scopeType: string; scopeId: string }>;
  activity: Array<{ userId: string; warehouseId: string; n: number }>;
  log: Array<{ at: string; by: string | null; lines: string[] | null }>;
}

/** Việc kho của từng người. Danh sách là id người dùng. */
export interface WmsAccess {
  viewAll: string[];
  viewWh: Record<string, string[]>;
  propose: string[];
  keepers: Record<string, string[]>;
  code: string[];
  exception: string[];
  accounting: string[];
  closer: string | null;
  whAdmin: string[];
}

export type WmsJob = 'view' | 'propose' | 'keeper' | 'code' | 'exception' | 'accounting' | 'closer' | 'whAdmin';
export type WmsTier = 'Xem' | 'Đề xuất' | 'Thao tác' | 'Danh mục' | 'Duyệt' | 'Ghi sổ' | 'Quản trị';
export const WMS_TIERS: WmsTier[] = ['Xem', 'Đề xuất', 'Thao tác', 'Danh mục', 'Duyệt', 'Ghi sổ', 'Quản trị'];
export const WMS_JOBS: Array<{ k: WmsJob; tier: WmsTier; label: string; scope: 'kho' | 'công ty' | 'một người'; does: string[] }> = [
  { k: 'view', tier: 'Xem', label: 'Xem kho', scope: 'kho', does: ['Xem tồn kho, thẻ kho, phiếu kho', 'Xem danh mục vật tư', 'Không lập / sửa được gì'] },
  { k: 'propose', tier: 'Đề xuất', label: 'Đề xuất mã mới', scope: 'công ty', does: ['Gửi đề xuất mã vật tư mới', 'Người Cấp mã xử lý'] },
  { k: 'keeper', tier: 'Thao tác', label: 'Thủ kho', scope: 'kho', does: ['Nhập kho, nhận hàng đợt giao', 'Xuất kho, chốt tiêu hao, quyết toán xuất cấp', 'Gửi / nhận chuyển kho',
    'Lập phiếu xuất hủy, điều chỉnh (người Duyệt ngoại lệ duyệt)', 'Đếm kiểm kê', 'Đề xuất mã mới'] },
  { k: 'code', tier: 'Danh mục', label: 'Cấp mã', scope: 'công ty', does: ['Cấp mã mới, xử lý đề xuất mã', 'Sửa mã, ngừng dùng / mở lại, đặt cách quản lý kho', 'Quy cách, gộp mã (khi có V1-3)'] },
  { k: 'exception', tier: 'Duyệt', label: 'Duyệt ngoại lệ', scope: 'công ty', does: ['Duyệt xuất hủy / hao hụt', 'Duyệt phiếu điều chỉnh', 'Duyệt chênh lệch kiểm kê', 'Không tự duyệt phiếu mình lập'] },
  { k: 'accounting', tier: 'Ghi sổ', label: 'Kế toán kho', scope: 'công ty', does: ['Bổ sung giá hàng nhập chưa có giá', 'Đảo phiếu đã ghi sổ (có lý do)', 'Kết xuất MISA'] },
  { k: 'closer', tier: 'Ghi sổ', label: 'Khóa kỳ', scope: 'một người', does: ['Khóa sổ kho cuối tháng', 'Phải là Kế toán kho'] },
  { k: 'whAdmin', tier: 'Quản trị', label: 'Quản lý danh sách kho', scope: 'công ty', does: ['Tạo kho mới, sửa tên / dự án của kho', 'Đóng / xóa kho'] },
];
export const WMS_JOB = Object.fromEntries(WMS_JOBS.map(j => [j.k, j])) as Record<WmsJob, typeof WMS_JOBS[number]>;
/** Việc toàn công ty dạng danh sách người. */
export const WMS_LIST_JOBS = ['propose', 'code', 'exception', 'accounting', 'whAdmin'] as const;
type ListJob = typeof WMS_LIST_JOBS[number];
/** Các việc này tự kèm Xem mọi kho (máy chủ cấp khi lưu). */
export const VIEW_IMPLIED_JOBS = ['code', 'exception', 'accounting'] as const;

const uniq = (l: string[]) => [...new Set(l)];
const add = (l: string[], id: string) => (l.includes(id) ? l : [...l, id]);

export const accessFromGrants = (d: WmsAccessData): WmsAccess => {
  const g = (code: string, scope = 'global') => uniq(d.grants.filter(x => x.code === code && x.scopeType === scope).map(x => x.userId));
  const byWh = (code: string) => Object.fromEntries(d.warehouses.map(w => [w.id, uniq(d.grants.filter(x => x.code === code && x.scopeType === 'warehouse' && x.scopeId === w.id).map(x => x.userId))]));
  return {
    viewAll: g('wms.inventory.view'), viewWh: byWh('wms.inventory.view'), propose: g('wms.request.create'), keepers: byWh('wms.transaction.keeper'),
    code: g('wms.master_data.issue_code'), exception: g('wms.transaction.exception_approve'), accounting: g('wms.accounting.manage'),
    closer: g('wms.accounting.close_period')[0] || null, whAdmin: uniq([...g('settings.warehouses.manage'), ...g('wms.master_data.manage')]),
  };
};

export const keeperWarehouses = (a: WmsAccess, id: string) => Object.keys(a.keepers).filter(w => a.keepers[w].includes(id));
export const viewImplied = (a: WmsAccess, id: string) => VIEW_IMPLIED_JOBS.some(k => a[k].includes(id));
export const viewOf = (a: WmsAccess, id: string): 'all' | string[] =>
  a.viewAll.includes(id) ? 'all' : Object.keys(a.viewWh).filter(w => a.viewWh[w].includes(id));
export const canPropose = (a: WmsAccess, id: string) => a.propose.includes(id) || a.code.includes(id) || keeperWarehouses(a, id).length > 0;

/** Tóm tắt việc kho của một người (để xem trước bàn giao, so sánh). */
export const jobsOf = (a: WmsAccess, id: string, whName: (id: string) => string) => {
  const out: string[] = [];
  const v = viewOf(a, id);
  if (v === 'all') out.push('Xem kho: mọi kho'); else if (v.length) out.push(`Xem kho: ${v.map(whName).join(', ')}`);
  const k = keeperWarehouses(a, id);
  if (k.length) out.push(`Thủ kho: ${k.map(whName).join(', ')}`);
  WMS_LIST_JOBS.forEach(j => { if (a[j].includes(id)) out.push(WMS_JOB[j].label); });
  if (a.closer === id) out.push('Khóa kỳ');
  return out;
};

/** Bỏ hết việc kho của một người. */
export const stripPerson = (a: WmsAccess, id: string): WmsAccess => ({
  viewAll: a.viewAll.filter(x => x !== id),
  viewWh: Object.fromEntries(Object.entries(a.viewWh).map(([w, l]) => [w, l.filter(x => x !== id)])),
  keepers: Object.fromEntries(Object.entries(a.keepers).map(([w, l]) => [w, l.filter(x => x !== id)])),
  propose: a.propose.filter(x => x !== id), code: a.code.filter(x => x !== id), exception: a.exception.filter(x => x !== id),
  accounting: a.accounting.filter(x => x !== id), whAdmin: a.whAdmin.filter(x => x !== id), closer: a.closer === id ? null : a.closer,
});

/** Cho `to` các việc giống `from` (Khóa kỳ chỉ một người nên chuyển hẳn sang `to`). */
export const copyJobs = (a: WmsAccess, from: string, to: string): WmsAccess => {
  const n: WmsAccess = { ...a, viewWh: { ...a.viewWh }, keepers: { ...a.keepers } };
  const v = viewOf(a, from);
  if (v === 'all') n.viewAll = add(n.viewAll, to); else v.forEach(w => { n.viewWh[w] = add(n.viewWh[w] || [], to); });
  keeperWarehouses(a, from).forEach(w => { n.keepers[w] = add(n.keepers[w] || [], to); });
  WMS_LIST_JOBS.forEach(j => { if (a[j].includes(from)) n[j] = add(n[j], to); });
  if (a.closer === from) n.closer = to;
  return n;
};

/** Bàn giao: `to` nhận hết việc của `from`; `from` mất hết, tùy chọn vẫn giữ Xem mọi kho. */
export const handOver = (a: WmsAccess, from: string, to: string, keepView: boolean): WmsAccess => {
  const n = stripPerson(copyJobs(a, from, to), from);
  return keepView ? { ...n, viewAll: add(n.viewAll, from) } : n;
};

// ---------- Mẫu chức năng (điểm xuất phát, chỉnh riêng sau) ----------
export interface WmsAccessTemplate { k: string; label: string; like?: string; jobs: Array<ListJob | 'closer' | 'keeper'>; viewAll: boolean; hint: string }
export const WMS_ACCESS_TEMPLATES: WmsAccessTemplate[] = [
  { k: 'viewer', label: 'Người xem kho', jobs: [], viewAll: true, hint: 'Chỉ huy, kỹ sư, mua hàng, ban giám đốc' },
  { k: 'keeper', label: 'Thủ kho', jobs: ['keeper'], viewAll: false, hint: 'Tick kho ở mục Thủ kho; chỉ xem kho mình giữ' },
  { k: 'material', label: 'Chuyên viên Vật tư', like: 'Bùi Thuỳ Linh', jobs: ['code'], viewAll: true, hint: 'Cấp mã, xử lý đề xuất mã' },
  { k: 'materialHead', label: 'Phụ trách Vật tư', like: 'Nguyễn Thị Mơ', jobs: ['code', 'exception'], viewAll: true, hint: 'Như Chuyên viên Vật tư + Duyệt ngoại lệ' },
  { k: 'accountant', label: 'Kế toán kho', like: 'Phạm Thị Thủy', jobs: ['accounting'], viewAll: true, hint: 'Bổ sung giá, đảo phiếu, MISA' },
  { k: 'chiefAccountant', label: 'Kế toán trưởng', like: 'Nguyễn Thị Hương', jobs: ['accounting', 'closer'], viewAll: true, hint: 'Như Kế toán kho + Khóa kỳ' },
];
export const applyTemplate = (a: WmsAccess, id: string, t: WmsAccessTemplate, replace: boolean): WmsAccess => {
  let n = replace ? stripPerson(a, id) : { ...a };
  if (t.viewAll) n = { ...n, viewAll: add(n.viewAll, id) };
  t.jobs.forEach(j => {
    if (j === 'closer') n = { ...n, accounting: add(n.accounting, id), closer: id };
    else if (j !== 'keeper') n = { ...n, [j]: add(n[j], id) };
  });
  return n;
};

// ---------- Ô quyền lẻ kiểu cũ ----------
export const LEGACY_LABEL: Record<string, string> = {
  'wms.transaction.create': 'Tạo phiếu', 'wms.transaction.approve': 'Duyệt phiếu', 'wms.transaction.complete': 'Hoàn tất phiếu', 'wms.inventory.edit': 'Sửa tồn trực tiếp',
  'wms.request.create': 'Tạo yêu cầu kho', 'wms.request.approve': 'Duyệt yêu cầu kho', 'wms.request.export': 'Xuất theo yêu cầu', 'wms.request.receive': 'Nhận theo yêu cầu',
  'wms.request.delete': 'Xóa yêu cầu kho', 'wms.material_issue.settle': 'Quyết toán xuất cấp', 'wms.material_issue.reverse_settlement': 'Hoàn tác quyết toán',
  'wms.purchase_order.return_supplier': 'Trả hàng NCC', 'wms.transaction.reverse': 'Hủy duyệt phiếu',
};
export type LegacyGrant = { userId: string; code: string; scopeType: string; scopeId: string };
export interface LegacyGroup { key: string; userId: string; scopeType: string; scopeId: string; verdict: 'covered' | 'loose'; grants: LegacyGrant[] }
/** Ô lẻ kiểu cũ gom theo người + phạm vi. `covered` = đã nằm trong Thủ kho kho đó, gỡ không mất thao tác. */
export const legacyGroups = (d: WmsAccessData, a: WmsAccess): LegacyGroup[] => {
  const map = new Map<string, LegacyGroup>();
  d.grants.filter(g => LEGACY_LABEL[g.code] && !(g.code === 'wms.request.create' && g.scopeType === 'global')).forEach(g => {
    const covered = g.scopeType === 'warehouse' && (a.keepers[g.scopeId] || []).includes(g.userId);
    const key = `${g.userId}|${g.scopeType}|${g.scopeId}|${covered ? 'c' : 'l'}`;
    if (!map.has(key)) map.set(key, { key, userId: g.userId, scopeType: g.scopeType, scopeId: g.scopeId, verdict: covered ? 'covered' : 'loose', grants: [] });
    map.get(key)!.grants.push({ userId: g.userId, code: g.code, scopeType: g.scopeType, scopeId: g.scopeId });
  });
  return [...map.values()];
};

/** Dòng thay đổi để xem trước khi lưu. */
export const accessDiff = (base: WmsAccess, cur: WmsAccess, name: (id: string | null) => string, whName: (id: string) => string, revoke: LegacyGrant[] = []) => {
  const out: string[] = [];
  const cmp = (label: string, was: string[] = [], now: string[] = []) => {
    now.filter(x => !was.includes(x)).forEach(x => out.push(`+ ${name(x)} — ${label}`));
    was.filter(x => !now.includes(x)).forEach(x => out.push(`− ${name(x)} — ${label}`));
  };
  cmp('Xem kho mọi kho', base.viewAll, cur.viewAll);
  uniq([...Object.keys(base.viewWh), ...Object.keys(cur.viewWh)]).forEach(w => cmp(`Xem kho ${whName(w)}`, base.viewWh[w], cur.viewWh[w]));
  uniq([...Object.keys(base.keepers), ...Object.keys(cur.keepers)]).forEach(w => cmp(`Thủ kho ${whName(w)}`, base.keepers[w], cur.keepers[w]));
  WMS_LIST_JOBS.forEach(k => cmp(WMS_JOB[k].label, base[k], cur[k]));
  if (cur.closer !== base.closer) out.push(`Người khóa kỳ: ${name(cur.closer)}`);
  // Việc kèm Xem mọi kho: người có việc mà chưa có ô Xem thì máy chủ cấp khi lưu.
  uniq(VIEW_IMPLIED_JOBS.flatMap(k => cur[k])).filter(id => !base.viewAll.includes(id) && !cur.viewAll.includes(id))
    .forEach(id => out.push(`+ ${name(id)} — Xem kho mọi kho (kèm việc)`));
  revoke.forEach(r => out.push(`− ${name(r.userId)} — quyền cũ “${LEGACY_LABEL[r.code] || r.code}”${r.scopeType === 'warehouse' ? ` @ ${whName(r.scopeId)}` : ''}`));
  return out;
};

export const accessPayload = (a: WmsAccess, revoke: LegacyGrant[]) => ({ ...a, revoke });
