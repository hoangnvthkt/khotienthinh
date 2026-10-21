// Hồ sơ máy chủ trả về → dòng kết quả: nhóm, nhãn loại, trạng thái tiếng Việt, đích mở đúng màn,
// và các thao tác liên quan (mở dự án, xem tồn kho, gọi điện…).

import { buildRequestRoute } from '../requestRoutes';
import { buildWorkflowRoute } from '../workflowRoutes';
import type { RecordKind, SearchEntry, SearchGroup, SearchRelatedLink, ServerRecord, StatusTone } from './searchTypes';

export interface KindMeta { label: string; group: SearchGroup; /** Màn mở được loại hồ sơ này — mở được ít nhất một màn mới tìm loại đó. */ gates: string[] }

export const KIND_META: Record<RecordKind, KindMeta> = {
  project: { label: 'Dự án', group: 'project', gates: ['/da'] },
  employee: { label: 'Nhân viên', group: 'people', gates: ['/ep', '/hrm/employees'] },
  item: { label: 'Vật tư', group: 'material', gates: ['/inventory', '/material-code-requests'] },
  wms_tx: { label: 'Phiếu kho', group: 'material', gates: ['/operations'] },
  material_code: { label: 'Đề xuất cấp mã', group: 'material', gates: ['/material-code-requests'] },
  purchase_order: { label: 'Đơn hàng', group: 'purchase', gates: ['/procurement'] },
  material_request: { label: 'Đề xuất vật tư', group: 'request', gates: ['/da', '/requests'] },
  rq: { label: 'Phiếu yêu cầu', group: 'request', gates: ['/rq'] },
  // Phiếu quy trình mở được cho mọi người có tên trên phiếu (route /wf/:id luôn mở); RLS quyết định phiếu nào.
  wf: { label: 'Phiếu quy trình', group: 'request', gates: ['*'] },
  partner: { label: 'Đối tác', group: 'contract', gates: ['/hd/partners'] },
  customer_contract: { label: 'HĐ nhận thầu', group: 'contract', gates: ['/hd/customer'] },
  subcontract: { label: 'HĐ thầu phụ', group: 'contract', gates: ['/hd/subcontractor'] },
  supplier_contract: { label: 'HĐ nhà cung cấp', group: 'contract', gates: ['/hd/supplier'] },
  payment_request: { label: 'Đề nghị chi', group: 'finance', gates: ['/finance/requests'] },
  asset: { label: 'Tài sản', group: 'asset', gates: ['/ts/catalog'] },
  office_doc: { label: 'Văn bản', group: 'office', gates: ['/office/documents'] },
  vehicle_booking: { label: 'Đặt xe', group: 'office', gates: ['/booking/vehicle/my'] },
  work_task: { label: 'Công việc', group: 'work', gates: ['/work/my'] },
  feedback: { label: 'Góp ý', group: 'work', gates: ['/feedback'] },
  leave: { label: 'Đơn nghỉ phép', group: 'people', gates: ['/hrm/leave'] },
};

export const GROUP_LABEL: Record<SearchGroup, string> = {
  action: 'Thao tác nhanh',
  page: 'Chức năng',
  project: 'Dự án',
  people: 'Nhân sự',
  material: 'Vật tư & kho',
  purchase: 'Mua hàng',
  request: 'Đề xuất & quy trình',
  contract: 'Hợp đồng & đối tác',
  finance: 'Tài chính',
  asset: 'Tài sản',
  office: 'Hành chính',
  work: 'Công việc',
  hr: 'Nhân sự',
};

/** Thứ tự nhóm khi hiển thị (thao tác trước, rồi hồ sơ hay dùng). */
export const GROUP_ORDER: SearchGroup[] = ['action', 'page', 'project', 'purchase', 'material', 'request', 'people', 'contract', 'finance', 'office', 'work', 'asset', 'hr'];

const STATUS: Record<string, [string, StatusTone]> = {
  draft: ['Nháp', 'neutral'], new: ['Mới', 'neutral'],
  pending: ['Chờ duyệt', 'pending'], pending_approval: ['Chờ duyệt', 'pending'], submitted: ['Đã gửi', 'pending'],
  waiting_number: ['Chờ cấp số', 'pending'], pending_acknowledgement: ['Chờ nhận việc', 'pending'],
  approved: ['Đã duyệt', 'active'], running: ['Đang xử lý', 'active'], in_progress: ['Đang làm', 'active'],
  in_transit: ['Đang giao', 'active'], confirmed: ['Đã duyệt · chờ giao', 'active'], partial: ['Giao một phần', 'active'],
  planning: ['Lập kế hoạch', 'neutral'], active: ['Đang hoạt động', 'done'], paused: ['Tạm dừng', 'pending'],
  completed: ['Hoàn thành', 'done'], done: ['Xong', 'done'], paid: ['Đã chi', 'done'], delivered: ['Đã giao đủ', 'done'],
  issued: ['Đã ban hành', 'done'], signed: ['Đã ký', 'done'], closed: ['Đã đóng', 'neutral'], archived: ['Lưu trữ', 'neutral'],
  resolved: ['Đã xử lý', 'done'], available: ['Sẵn sàng', 'done'], in_use: ['Đang dùng', 'active'], maintenance: ['Bảo trì', 'pending'],
  rejected: ['Từ chối', 'warn'], returned: ['Bị trả lại', 'warn'], cancelled: ['Đã hủy', 'warn'], canceled: ['Đã hủy', 'warn'],
  revoked: ['Đã thu hồi', 'warn'], withdrawn: ['Đã rút', 'warn'], reversed: ['Đã đảo', 'warn'], inactive: ['Ngừng giao dịch', 'warn'],
  retired: ['Ngừng dùng', 'warn'], expired: ['Hết hạn', 'warn'],
};

const KIND_STATUS: Partial<Record<RecordKind, Record<string, [string, StatusTone]>>> = {
  purchase_order: { sent: ['Chờ duyệt', 'pending'] },
  rq: { approved: ['Hoàn thành', 'done'] },
  employee: { 'đang làm việc': ['Đang làm việc', 'done'], 'nghỉ việc': ['Nghỉ việc', 'neutral'] },
};

export const statusInfo = (kind: RecordKind | null, status: string | null | undefined): { label: string; tone: StatusTone } | null => {
  if (!status) return null;
  const key = status.trim().toLowerCase();
  const hit = (kind && KIND_STATUS[kind]?.[key]) || STATUS[key];
  return hit ? { label: hit[0], tone: hit[1] } : { label: status, tone: 'neutral' };
};

const query = (base: string, params: Record<string, string | null | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value); });
  const encoded = search.toString();
  return encoded ? `${base}?${encoded}` : base;
};

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null);
const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (value: number) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value))} đ`;
const viDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};

const projectRoute = (projectId: string, params: Record<string, string | null | undefined> = {}) => query('/da', { projectId, ...params });

/** Đích mở chính + thao tác liên quan của một hồ sơ. */
export const recordTarget = (record: ServerRecord): { route: string; state?: unknown; related: SearchRelatedLink[] } => {
  const { id, projectId, extra } = record;
  const related: SearchRelatedLink[] = [];
  const withProject = () => {
    if (projectId) related.push({ label: 'Mở dự án', route: projectRoute(projectId) });
  };
  switch (record.kind) {
    case 'project':
      related.push(
        { label: 'Nhật ký công trường', route: projectRoute(id, { tab: 'dailylog' }) },
        { label: 'Vật tư dự án', route: projectRoute(id, { tab: 'material' }) },
        { label: 'Tiến độ', route: projectRoute(id, { tab: 'gantt' }) },
        { label: 'Hợp đồng dự án', route: projectRoute(id, { tab: 'contract' }) },
        { label: 'An toàn', route: projectRoute(id, { tab: 'safety' }) },
        { label: 'Tài chính dự án', route: query('/finance/project', { project: id }) },
      );
      return { route: projectRoute(id), related };
    case 'employee': {
      const phone = str(extra.phone);
      const email = str(extra.email);
      if (phone) related.push({ label: `Gọi ${phone}`, route: `tel:${phone.replace(/[^\d+]/g, '')}` });
      if (email) related.push({ label: 'Gửi email', route: `mailto:${email}` });
      return { route: `/ep/${encodeURIComponent(id)}`, related };
    }
    case 'item': {
      const sku = record.code || record.title || '';
      related.push(
        { label: 'Mở trong Danh mục vật tư', route: '/material-code-requests', state: { itemId: id } },
        { label: 'Lập phiếu xuất kho', route: '/operations', state: { tab: 'EXPORT' } },
        { label: 'Chuyển kho', route: '/operations', state: { tab: 'TRANSFER', prefillItemId: id } },
      );
      return { route: query('/inventory', { q: sku }), related };
    }
    case 'wms_tx':
      return { route: '/operations', state: { transactionId: id }, related };
    case 'material_code': {
      // Đã cấp mã → mở thẳng mã vật tư; chưa cấp → hàng chờ cấp mã của Danh mục vật tư.
      const itemId = str(extra.approvedItemId);
      return { route: '/material-code-requests', state: itemId ? { itemId } : undefined, related };
    }
    case 'material_request':
      if (projectId && str(extra.origin) === 'project') {
        related.push({ label: 'Mở dự án', route: projectRoute(projectId) });
        return { route: projectRoute(projectId, { siteId: record.siteId, tab: 'material', materialTab: 'request', requestId: id }), related };
      }
      return { route: query('/requests', { q: record.code }), related };
    case 'purchase_order':
      if (projectId) related.push({ label: 'Đơn hàng trong dự án', route: projectRoute(projectId, { tab: 'material', materialTab: 'po', poId: id }) });
      withProject();
      return { route: query('/procurement', { po: id }), related };
    case 'rq':
      return { route: buildRequestRoute(id), related };
    case 'wf':
      return { route: buildWorkflowRoute(id), related };
    case 'partner': {
      const phone = str(extra.phone);
      if (phone) related.push({ label: `Gọi ${phone}`, route: `tel:${phone.replace(/[^\d+]/g, '')}` });
      related.push({ label: 'Hợp đồng nhà cung cấp', route: query('/hd/supplier', { q: record.title }) });
      return { route: query('/hd/partners', { q: record.code || record.title }), related };
    }
    case 'customer_contract':
      withProject();
      return { route: `/hd/customer/${encodeURIComponent(id)}`, related };
    case 'subcontract':
      withProject();
      return { route: `/hd/subcontractor/${encodeURIComponent(id)}`, related };
    case 'supplier_contract':
      withProject();
      related.push({ label: 'Đơn đặt theo hợp đồng khung', route: query('/procurement', { contract: id }) });
      return { route: query('/hd/supplier', { q: record.code || record.title }), related };
    case 'payment_request':
      withProject();
      return { route: query('/finance/requests', { request: id }), related };
    case 'asset':
      related.push({ label: 'Cấp phát / thu hồi', route: query('/ts/assignment', { q: record.code || record.title }) });
      return { route: `/ts/asset/${encodeURIComponent(id)}`, related };
    case 'office_doc':
      withProject();
      return { route: `/office/documents/${encodeURIComponent(id)}`, related };
    case 'vehicle_booking':
      return { route: query('/booking/vehicle/my', { booking: id }), related };
    case 'work_task':
      return { route: `/work/tasks/${encodeURIComponent(record.code || id)}`, related };
    case 'feedback':
      return { route: query('/feedback', { feedbackId: id }), related };
    case 'leave':
      return { route: query('/hrm/leave', { request: id }), related };
    default:
      return { route: '/', related };
  }
};

const factsOf = (record: ServerRecord): SearchEntry['facts'] => {
  const facts: NonNullable<SearchEntry['facts']> = [];
  const { extra } = record;
  const amount = num(extra.amount ?? extra.value);
  if (amount != null && amount > 0) facts.push({ label: record.kind === 'payment_request' ? 'Số tiền' : 'Giá trị', value: money(amount), tone: 'num' });
  const vendor = str(extra.vendor) || str(extra.counterparty);
  if (vendor) facts.push({ label: record.kind === 'customer_contract' ? 'Chủ đầu tư' : 'Đối tác', value: vendor, tone: 'ent' });
  const phone = str(extra.phone);
  if (phone) facts.push({ label: 'Điện thoại', value: phone });
  const email = str(extra.email);
  if (email) facts.push({ label: 'Email', value: email });
  const taxCode = str(extra.taxCode);
  if (taxCode) facts.push({ label: 'Mã số thuế', value: taxCode });
  const jobTitle = str(extra.jobTitle);
  if (jobTitle) facts.push({ label: 'Chức danh', value: jobTitle });
  const holder = str(extra.holder);
  if (holder) facts.push({ label: 'Người giữ', value: holder, tone: 'ent' });
  const due = str(extra.dueAt) || str(extra.deadline);
  if (due && viDate(due)) facts.push({ label: 'Hạn', value: viDate(due) as string });
  const pickup = str(extra.pickupAt);
  if (pickup && viDate(pickup)) facts.push({ label: 'Ngày đi', value: viDate(pickup) as string });
  const orderDate = str(extra.orderDate);
  if (orderDate) facts.push({ label: 'Ngày đặt', value: viDate(orderDate) || orderDate });
  const unit = str(extra.unit);
  if (unit) facts.push({ label: 'Đơn vị tính', value: unit });
  const days = num(extra.days);
  if (record.kind === 'leave' && days != null) facts.push({ label: 'Số ngày', value: String(days), tone: 'num' });
  const updated = viDate(record.date);
  if (updated) facts.push({ label: 'Cập nhật', value: updated });
  return facts;
};

/** Trạng thái bình thường của loại hồ sơ — không gắn nhãn (nhãn chỉ để báo điều khác thường). */
const QUIET_STATUS: Partial<Record<RecordKind, string[]>> = {
  item: ['active'], partner: ['active'], employee: ['đang làm việc'], project: ['active'],
};

export const recordToEntry = (record: ServerRecord): SearchEntry => {
  const meta = KIND_META[record.kind];
  const target = recordTarget(record);
  const quiet = QUIET_STATUS[record.kind]?.includes((record.status || '').trim().toLowerCase());
  const status = quiet ? null : statusInfo(record.kind, record.status);
  return {
    key: `${record.kind}:${record.id}`,
    kind: record.kind,
    group: meta.group,
    title: record.title || record.code || meta.label,
    code: record.code,
    subtitle: record.subtitle,
    context: meta.label,
    status: status?.label || null,
    statusTone: status?.tone,
    route: target.route,
    routeState: target.state,
    related: target.related,
    facts: factsOf(record),
    date: record.date,
  };
};
