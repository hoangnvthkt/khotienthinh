// Dữ liệu minh họa, chỉ dùng cho kiểm thử giao diện Tìm kiếm toàn hệ thống. Không gọi Supabase.
// ?role=admin|site|staff — quyền giả lập (Admin · Chỉ huy công trường · Nhân viên văn phòng).
// ?server=error|partial|slow — máy chủ lỗi / một nguồn lỗi / chậm. ?q=… — mở sẵn với câu gõ. ?theme=dark — nền tối.
// Bộ tìm giả lập khớp chữ đúng như search_global_v1: AND giữa cụm, OR trong cụm, khớp đầu từ, có "từ chỉ loại".
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, Calendar, CalendarOff, ClipboardCheck, FileText, Handshake, HardHat, Inbox, Landmark, LayoutDashboard, MapPin, Package,
  ShoppingCart, Users, Wallet,
} from 'lucide-react';
import { GlobalSearchView } from '../../components/search/GlobalSearchDialog';
import { compactCode, foldVi } from '../../lib/search/viText';
import type { RecordKind, ServerRecord, ServerSearchResult } from '../../lib/search/searchTypes';
import type { NavItemInput, NavModuleInput } from '../../lib/search/searchCatalog';
import '../../index.css';

const params = new URLSearchParams(location.search);
const role = params.get('role') || 'admin';
const serverMode = params.get('server');
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

const MODULES: Array<NavModuleInput & { items: NavItemInput[]; roles: string[] }> = [
  { key: 'DA', label: 'Dự án', route: '/da', roles: ['admin', 'site'], items: [{ to: '/da', label: 'Tổng quan DA', icon: BarChart3 }, { to: '/da/portfolio', label: 'Đa dự án', icon: LayoutDashboard }] },
  { key: 'PROCUREMENT', label: 'Mua hàng', route: '/procurement', roles: ['admin'], items: [{ to: '/procurement', label: 'Mua hàng công ty', icon: ShoppingCart }] },
  { key: 'WMS', label: 'Vật tư', route: '/inventory', roles: ['admin', 'site'], items: [
    { to: '/inventory', label: 'Tồn kho', icon: Package }, { to: '/operations', label: 'Phiếu kho', icon: ClipboardCheck },
    { to: '/audit', label: 'Kiểm kê', icon: ClipboardCheck }, { to: '/material-code-requests', label: 'Danh mục vật tư', icon: FileText }, { to: '/reports', label: 'Báo cáo', icon: BarChart3 }] },
  { key: 'FINANCE', label: 'Tài chính', route: '/finance', roles: ['admin'], items: [
    { to: '/finance/overview', label: 'Tổng quan', icon: LayoutDashboard }, { to: '/finance/forecast', label: 'Dự báo dòng tiền', icon: Calendar },
    { to: '/finance/payables', label: 'Phải trả', icon: Wallet }, { to: '/finance/receivables', label: 'Phải thu', icon: Inbox }, { to: '/finance/cash', label: 'Thu chi & quỹ', icon: Landmark }] },
  { key: 'HRM', label: 'Nhân sự', route: '/my-profile', roles: ['admin', 'site', 'staff'], items: [
    { to: '/hrm/checkin', label: 'Chấm công', icon: MapPin }, { to: '/hrm/attendance', label: 'Bảng chấm công', icon: Calendar },
    { to: '/hrm/leave', label: 'Nghỉ phép', icon: CalendarOff }, { to: '/hrm/timesheet', label: 'Bảng công', icon: Calendar }] },
  { key: 'HD', label: 'Hợp đồng', route: '/hd/partners', roles: ['admin'], items: [
    { to: '/hd/partners', label: 'Đối tác', icon: Handshake }, { to: '/hd/customer', label: 'HĐ Nhận thầu', icon: Users }, { to: '/hd/supplier', label: 'HĐ Nhà cung cấp', icon: HardHat }] },
  { key: 'RQ', label: 'Yêu cầu', route: '/rq', roles: ['admin', 'site', 'staff'], items: [{ to: '/rq', label: 'Phiếu yêu cầu', icon: Inbox }] },
  { key: 'EP', label: 'Hồ sơ NV', route: '/ep', roles: ['admin', 'site', 'staff'], items: [{ to: '/ep', label: 'Tra cứu nhân viên', icon: Users }] },
];

const visibleModules = MODULES.filter(module => module.roles.includes(role));
const ROLE_DENY: Record<string, RegExp> = {
  admin: /^$/,
  site: /^\/(finance|procurement|hd|ts|office|work|ai|settings\/role)/,
  staff: /^\/(finance|procurement|hd|da|inventory|operations|audit|material-code|requests|ts|ai|site-fund)/,
};
const canAccess = (route: string) => {
  const path = route.split('?')[0];
  if (role === 'admin') return true;
  return !ROLE_DENY[role].test(path);
};

// ── Hồ sơ mẫu (không phải dữ liệu thật) ──
const rec = (kind: RecordKind, id: string, title: string, extra: Partial<ServerRecord> & { hay?: string } = {}): ServerRecord & { hay: string } => ({
  kind, id, title, code: null, subtitle: null, status: null, date: '2026-10-08T03:00:00Z', projectId: null, siteId: null, rank: 40, extra: {}, hay: '', ...extra,
});
const RECORDS = [
  rec('project', 'smb', 'Nhà máy Sơn Miền Bắc', { code: 'SMB-2026', subtitle: 'Công ty CP Sơn Miền Bắc', status: 'active', hay: 'du an cong trinh cong truong project' }),
  rec('project', 'da29', 'Nhà xưởng DA29 KCN Quế Võ', { code: 'DA29', subtitle: 'Công ty TNHH Điện tử Quế Võ', status: 'active', hay: 'du an cong trinh cong truong project' }),
  rec('project', 'hpg', 'Kho thép Hòa Phát Hưng Yên', { code: 'HPHY-2025', subtitle: 'Thép Hòa Phát', status: 'paused', hay: 'du an cong trinh cong truong project' }),
  rec('employee', 'e1', 'Nguyễn Văn Hoàng', { code: 'NV0012', subtitle: 'Giám đốc dự án · 0912 345 678', status: 'Đang làm việc', extra: { phone: '0912 345 678', email: 'hoang.nv@vioo.vn', jobTitle: 'Giám đốc dự án' }, hay: 'nhan vien nhan su hoang.nv@vioo.vn' }),
  rec('employee', 'e2', 'Phạm Ngọc Sơn', { code: 'NV0031', subtitle: 'Chỉ huy trưởng · 0987 111 222', status: 'Đang làm việc', extra: { phone: '0987 111 222', jobTitle: 'Chỉ huy trưởng' }, hay: 'nhan vien nhan su' }),
  rec('employee', 'e3', 'Nguyễn Thị Mơ', { code: 'NV0045', subtitle: 'Mua hàng · 0903 555 666', status: 'Đang làm việc', extra: { phone: '0903 555 666', jobTitle: 'Nhân viên mua hàng' }, hay: 'nhan vien nhan su' }),
  rec('item', 'i1', 'Thép cây D10 CB300 Hòa Phát', { code: 'VT0000102', subtitle: 'kg · Thép xây dựng', status: 'active', extra: { unit: 'kg' }, hay: 'vat tu vat lieu hang hoa ton kho' }),
  rec('item', 'i2', 'Thép cây D16 CB400 Hòa Phát', { code: 'VT0000108', subtitle: 'kg · Thép xây dựng', status: 'active', extra: { unit: 'kg' }, hay: 'vat tu vat lieu hang hoa ton kho' }),
  rec('item', 'i3', 'Xi măng PCB40 Bút Sơn', { code: 'VT0000215', subtitle: 'tấn · Xi măng', status: 'active', extra: { unit: 'tấn' }, hay: 'vat tu vat lieu hang hoa ton kho' }),
  rec('item', 'i4', 'Đá 1x2 xanh', { code: 'VT0000301', subtitle: 'm³ · Cốt liệu', status: 'active', extra: { unit: 'm³' }, hay: 'vat tu vat lieu hang hoa ton kho' }),
  rec('wms_tx', 'tx1', 'Phiếu nhập kho · Kho SMB', { subtitle: 'Thép Hòa Phát · 3 mặt hàng · 08/10/2026', status: 'COMPLETED', hay: 'thep d10 d16 hoa phat nhap kho phieu nhap phieu kho' }),
  rec('wms_tx', 'tx2', 'Phiếu xuất kho · Kho SMB', { subtitle: '2 mặt hàng · 09/10/2026', status: 'PENDING', hay: 'xi mang but son xuat kho phieu xuat cap phat phieu kho' }),
  rec('purchase_order', 'po116', 'Kết cấu thép nhà xưởng 3', { code: 'PO-2026-116', subtitle: 'Thép Hòa Phát · Nhà máy Sơn Miền Bắc', status: 'sent', projectId: 'smb', extra: { amount: 1325000000, vendor: 'Công ty CP Thép Hòa Phát', orderDate: '2026-10-06' }, hay: 'thep d16 d10 hoa phat po don hang don mua dat hang mua hang' }),
  rec('purchase_order', 'po120', 'Xi măng PCB40 đợt 2', { code: 'PO-2026-120', subtitle: 'Xi măng Bút Sơn · Nhà xưởng DA29', status: 'confirmed', projectId: 'da29', extra: { amount: 186000000, vendor: 'Xi măng Bút Sơn' }, hay: 'xi mang but son po don hang don mua dat hang mua hang' }),
  rec('material_request', 'mr2688', 'Thép D16 + D10 móng nhà xưởng 3', { code: 'MR-2026-2688', subtitle: 'Nhà máy Sơn Miền Bắc · 07/10/2026', status: 'PENDING', projectId: 'smb', siteId: 'site-smb', extra: { origin: 'project' }, hay: 'thep de xuat vat tu yeu cau vat tu phieu vat tu' }),
  rec('rq', 'rq61', 'Bổ sung 2 kỹ sư hoàn thiện từ 13/10', { code: 'RQ-2026-000061', status: 'PENDING', extra: { dueAt: '2026-10-11T10:00:00Z' }, hay: 'yeu cau de xuat phieu yeu cau rq nhan su' }),
  rec('wf', 'wf31', 'Xin xe chở vật tư đi Bắc Ninh 09/10', { code: 'WF-2026-031', status: 'RUNNING', hay: 'quy trinh workflow phieu quy trinh' }),
  rec('partner', 'bp1', 'Công ty CP Thép Hòa Phát', { code: 'NCC-0007', subtitle: 'MST 0900189284 · 0221 3942 884 · Hưng Yên', status: 'active', extra: { phone: '0221 3942 884', taxCode: '0900189284' }, hay: '0900189284 doi tac ncc nha cung cap khach hang chu dau tu' }),
  rec('partner', 'bp2', 'Công ty CP Sơn Miền Bắc', { code: 'KH-0003', subtitle: 'MST 0101234567 · Hà Nội', status: 'active', hay: 'doi tac ncc nha cung cap khach hang chu dau tu' }),
  rec('customer_contract', 'hd1', 'Thi công nhà xưởng 3 — Sơn Miền Bắc', { code: 'HĐ-SMB-2026-01', subtitle: 'Công ty CP Sơn Miền Bắc · Nhà máy Sơn Miền Bắc', status: 'signed', projectId: 'smb', extra: { value: 48600000000, counterparty: 'Công ty CP Sơn Miền Bắc' }, hay: 'hop dong nhan thau chu dau tu khach hang' }),
  rec('supplier_contract', 'hd2', 'Hợp đồng khung thép 2026', { code: 'HĐK-HP-2026', subtitle: 'Công ty CP Thép Hòa Phát', status: 'signed', extra: { value: 12000000000, counterparty: 'Công ty CP Thép Hòa Phát' }, hay: 'thep hoa phat hop dong nha cung cap ncc khung' }),
  rec('payment_request', 'dnc14', 'Công ty CP Thép Hòa Phát', { code: 'DNC-2026-014', subtitle: 'Thanh toán đợt 1 PO-2026-116 · 15/10/2026', status: 'pending', projectId: 'smb', extra: { amount: 650000000 }, hay: 'po-2026-116 thep de nghi chi de nghi thanh toan tam ung chi tien' }),
  rec('office_doc', 'tb12', 'Quy định an toàn thi công mùa mưa', { code: 'TB-12/2026', subtitle: 'Ban TGĐ · 05/10/2026', status: 'ISSUED', hay: 'an toan van ban cong van' }),
  rec('work_task', 'vw1203', 'Gửi biên bản nghiệm thu móng A3 cho CĐT', { code: 'VW-2026-001203', status: 'in_progress', extra: { deadline: '2026-10-09T11:00:00Z' }, hay: 'cong viec viec task' }),
  rec('vehicle_booking', 'xe9', 'Chở vật tư đi Bắc Ninh', { code: 'XE-2026-0091', subtitle: 'Văn phòng Hà Nội → KCN Quế Võ', status: 'APPROVED', extra: { pickupAt: '2026-10-09T01:00:00Z' }, hay: 'dat xe xe chuyen xe' }),
  rec('leave', 'np41', 'Đơn nghỉ phép', { code: 'NP-2026-041', subtitle: '2026-10-08 → 2026-10-09 · Việc gia đình', status: 'pending', extra: { days: 2 }, hay: 'nghi phep don nghi phep' }),
  rec('asset', 'ts5', 'Máy cắt sắt GQ40', { code: 'TS-0005', subtitle: 'SN 2201 · Phạm Ngọc Sơn', status: 'IN_USE', extra: { holder: 'Phạm Ngọc Sơn' }, hay: 'tai san thiet bi' }),
  rec('feedback', 'fb7', 'Tìm kiếm không ra phiếu khi gõ không dấu', { subtitle: 'bug · Tìm kiếm', status: 'resolved', hay: 'gop y bao loi feedback' }),
];

const KIND_GATE: Partial<Record<RecordKind, string>> = {
  project: '/da', item: '/inventory', wms_tx: '/operations', purchase_order: '/procurement', partner: '/hd/partners',
  customer_contract: '/hd/customer', supplier_contract: '/hd/supplier', payment_request: '/finance/requests', material_request: '/da', asset: '/ts/catalog',
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fakeSearch = async (terms: string[][], kinds: readonly RecordKind[], limit: number, signal?: AbortSignal): Promise<ServerSearchResult> => {
  const heavy = kinds.some(kind => kind === 'wms_tx' || kind === 'material_code');
  await wait(serverMode === 'slow' ? 1500 : heavy ? 380 : 140);
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (serverMode === 'error') throw new Error('Failed to fetch');
  const patterns = terms.map(group => new RegExp(`(^|[^a-z0-9])(${group.map((alt, index) => alt.replace(/[.]/g, '\\.') + (index > 0 && alt.length <= 3 ? '(?![a-z0-9])' : '')).join('|')})`));
  const compact = terms.map(group => group[0].replace(/[^a-z0-9]/g, '')).join('');
  const records = RECORDS
    .filter(record => kinds.includes(record.kind))
    .filter(record => !KIND_GATE[record.kind] || canAccess(KIND_GATE[record.kind] as string))
    .filter(record => {
      const initials = record.kind === 'employee' || record.kind === 'project' ? foldVi(record.title).split(/[^a-z0-9]+/).filter(Boolean).map(word => word[0]).join('') : '';
      const hay = foldVi([record.code, compactCode(record.code), record.title, initials, record.subtitle, record.hay].filter(Boolean).join(' '));
      return patterns.every(pattern => pattern.test(hay));
    })
    .map(({ hay: _hay, ...record }) => ({ ...record, rank: compact && compactCode(record.code) === compact ? 100 : 40 }));
  const perKind = new Map<RecordKind, number>();
  const limited = records.filter(record => {
    const count = (perKind.get(record.kind) || 0) + 1;
    perKind.set(record.kind, count);
    return count <= limit;
  });
  return { records: limited, failed: serverMode === 'partial' && kinds.includes('wms_tx') ? ['wms_tx'] : [] };
};

const Fixture: React.FC = () => {
  const [open, setOpen] = useState(true);
  const [last, setLast] = useState<string>('');
  const record = (text: string) => { setLast(text); (window as unknown as { __searchLog: string[] }).__searchLog = [...((window as unknown as { __searchLog?: string[] }).__searchLog || []), text]; };
  return (
    <div className="min-h-[100dvh] bg-slate-50 p-6 text-foreground dark:bg-slate-950">
      <p className="text-sm text-muted-foreground">Fixture Tìm kiếm toàn hệ thống · quyền: <b>{role}</b>{serverMode ? ` · máy chủ: ${serverMode}` : ''}</p>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold">Mở tìm kiếm</button>
      <p data-testid="last-action" className="mt-3 font-mono text-xs">{last}</p>
      {open && (
        <GlobalSearchView
          initialQuery={params.get('q') || ''}
          userId={`fixture-${role}`}
          pathname="/"
          modules={visibleModules}
          navItems={key => visibleModules.find(module => module.key === key)?.items.filter(item => canAccess(item.to)) || []}
          canAccess={canAccess}
          onNavigate={(route, state) => record(`navigate ${route}${state ? ` ${JSON.stringify(state)}` : ''}`)}
          onToggleTheme={() => { document.documentElement.classList.toggle('dark'); record('toggle-theme'); }}
          onClose={() => setOpen(false)}
          onModal={modal => { setOpen(false); record(`modal ${modal}`); }}
          search={fakeSearch}
        />
      )}
    </div>
  );
};

createRoot(document.getElementById('root') as HTMLElement).render(<Fixture />);
