import { CENTER_WIDGET_GROUPS, type CenterModuleKey, type CenterWidgetId } from './centerRegistry';
import type { DrillTarget } from './drill';
import type { CenterToday, SiteWeather } from './centerTodayService';

// Dựng ô số liệu của "Hôm nay" từ payload vcc_my_center_v1. Hợp đồng drill-down (kế hoạch 07 mục 3):
// không con số nào đứng một mình — mỗi Stat có target mở đúng danh sách / hồ sơ; ô chưa có dữ liệu
// hoặc chưa có quyền vẫn dẫn đường (hoặc khóa kèm lý do), không hiện 0 thay cho "không biết".

export type StatTone = 'num' | 'warn' | 'danger' | 'muted';

export interface Stat {
  key: string;
  label: string;
  value: string;
  hint?: string;
  tone?: StatTone;
  target: DrillTarget;
  /** Có lý do khóa → hiện 🔒 với lý do, không bấm được. */
  locked?: string;
}

export interface WidgetView {
  id: CenterWidgetId;
  module: CenterModuleKey;
  title: string;
  sub: string;
  stats: Stat[];
  /** Màn module đầy đủ của widget. */
  route: string;
  routeLabel: string;
  empty?: { text: string; target: DrillTarget };
}

export type WeatherSlot = 'loading' | SiteWeather | null;

export interface TodayContext {
  now: Date;
  weather: WeatherSlot;
  mineCount: number | null;
}

const pad = (value: number) => String(value).padStart(2, '0');
export const ddmm = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? null : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
};
const hhmm = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
/** 5,36 tỷ · 850 tr · 850.000 đ — cùng cách viết với máy chủ (app_private.vcc_money). */
export const moneyShort = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, '').replace('.', ',');
  if (abs >= 1e9) return `${trim(value / 1e9, 2)} tỷ`;
  if (abs >= 1e6) return `${trim(value / 1e6, 1)} tr`;
  return `${Math.round(value).toLocaleString('vi-VN')} đ`;
};

const route = (path: string, title: string): DrillTarget => ({ kind: 'route', path, title });
const query = (base: string, params: Record<string, string | null | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value); });
  const encoded = search.toString();
  return encoded ? `${base}?${encoded}` : base;
};

const TRIP_STATUS: Record<string, string> = {
  PENDING_APPROVAL: 'chờ duyệt', WAITING_DISPATCH: 'chờ điều xe', ASSIGNED: 'đã có xe', IN_PROGRESS: 'đang đi',
};
const PERIOD_STATUS: Record<string, string> = { reviewing: 'HR đang rà soát', submitted: 'chờ chốt', closed: 'đã chốt' };

/** Số ngày tới hạn hợp đồng (âm = quá hạn). */
export const daysUntil = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const end = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
};

export const buildTodayWidgets = (today: CenterToday, ctx: TodayContext): WidgetView[] => {
  const group = (id: CenterWidgetId) => CENTER_WIDGET_GROUPS.find(item => item.id === id)!;
  const project = today.project;
  const pid = project?.id || null;
  const w = today.widgets;
  const views: WidgetView[] = [];

  // Dự án
  {
    const g = group('project');
    const base: WidgetView = { id: 'project', module: 'project', title: project ? `Dự án · ${project.code}` : 'Dự án', sub: project?.site?.name || g.hint,
      stats: [], route: pid ? query('/da', { projectId: pid }) : '/da', routeLabel: g.routeLabel };
    if (!project || !w.project) {
      views.push({ ...base, empty: { text: 'Bạn chưa thuộc dự án nào. Nhờ chỉ huy trưởng hoặc HR thêm bạn vào Tổ chức dự án.', target: route('/da', 'Dự án') } });
    } else {
      const pw = w.project;
      const dailylog = route(query('/da', { projectId: pid, tab: 'dailylog' }), 'Báo cáo ngày');
      const c = pw.construction;
      base.stats.push(c.state === 'ready'
        ? { key: 'construction', label: 'Thi công hôm nay', target: dailylog,
            value: (c.fronts || 0) > 0 ? `${c.slips ?? 0}/${c.fronts} mũi đã gửi phiếu · ${Math.round(c.people || 0)} công` : 'Chưa có mũi nào gửi phiếu',
            tone: (c.fronts || 0) > 0 && (c.slips || 0) < (c.fronts || 0) ? 'warn' : 'num',
            hint: c.summaryStatus === 'submitted' ? 'Bản tổng hợp đang chờ duyệt' : c.summaryStatus === 'verified' ? 'Đã công bố tiến độ' : undefined }
        : { key: 'construction', label: 'Thi công hôm nay', value: c.state === 'denied' ? 'Cần quyền xem nhật ký' : 'Chưa đọc được nhật ký', tone: 'muted', target: dailylog, locked: c.state === 'denied' ? 'Bạn chưa có quyền xem nhật ký của dự án này' : undefined });
      const po = route(query('/da', { projectId: pid, tab: 'material', materialTab: 'po' }), 'Đơn hàng');
      const s = pw.supply;
      base.stats.push(s.state === 'ready'
        ? { key: 'supply', label: 'Vật tư đang về', target: po,
            value: (s.count || 0) > 0 ? `${s.count} PO · ${moneyShort(s.amount)}${s.nextPo ? ` · ${s.nextPo.poNumber}${ddmm(s.nextPo.expectedDate) ? ` ${ddmm(s.nextPo.expectedDate)}` : ''}` : ''}` : 'Không có đơn hàng đang giao' }
        : { key: 'supply', label: 'Vật tư đang về', value: 'Cần quyền xem đơn hàng', tone: 'muted', target: po, locked: 'Bạn chưa có quyền xem đơn hàng của dự án này' });
      const gantt = route(query('/da', { projectId: pid, tab: 'gantt' }), 'Tiến độ');
      const p = pw.progress;
      const deadline = ddmm(p.endDate || project.endDate);
      base.stats.push(p.state === 'ready'
        ? { key: 'progress', label: 'Tiến độ', target: gantt,
            value: `${p.percent ?? 0}%${deadline ? ` · hạn HĐ ${deadline}` : ''}${(p.overdue || 0) > 0 ? ` · ${p.overdue} việc trễ` : (p.notStarted || 0) > 0 ? ` · ${p.notStarted} việc chưa bắt đầu` : ''}`,
            tone: (p.overdue || 0) > 0 ? 'danger' : 'num', hint: p.mode === 'manual' ? 'Tiến độ nhập tay' : `${p.done ?? 0} xong · ${p.inProgress ?? 0} đang làm · ${p.total ?? 0} việc` }
        : { key: 'progress', label: 'Tiến độ', value: 'Chưa có tiến độ (Gantt trống)', tone: 'muted', target: gantt });
      base.stats.push({ key: 'waiting', label: 'Chờ bạn', value: pw.waiting > 0 ? `${pw.waiting} việc của dự án` : 'Không có việc chờ bạn ở dự án này',
        tone: pw.waiting > 0 ? 'num' : 'muted', target: { kind: 'inbox', title: 'Việc của tôi', module: 'project' } });
      views.push(base);
    }
  }

  // Nhân sự
  {
    const g = group('hrm');
    const h = w.hrm;
    const base: WidgetView = { id: 'hrm', module: 'hrm', title: g.label, sub: g.hint, stats: [], route: '/my-profile', routeLabel: g.routeLabel };
    if (h.state !== 'ready') {
      views.push({ ...base, empty: { text: h.state === 'empty' ? 'Tài khoản chưa gắn với hồ sơ nhân viên. Nhờ HR gắn để thấy chấm công, phép và công tháng.' : 'Chưa đọc được số liệu nhân sự.', target: route('/my-profile', 'Hồ sơ') } });
    } else {
      const a = h.attendance;
      base.stats.push({ key: 'attendance', label: 'Chấm công hôm nay', target: route('/hrm/checkin', 'Chấm công'),
        value: a?.checkIn ? `Vào ${a.checkIn}${a.checkOut ? ` · ra ${a.checkOut}` : ' · chưa chấm ra'}` : 'Chưa chấm công',
        tone: a?.checkIn ? 'num' : 'warn', hint: a?.locationName || undefined });
      base.stats.push({ key: 'leave', label: 'Phép năm còn', target: route('/hrm/leave', 'Nghỉ phép'),
        value: h.leave ? `${h.leave.availableDays} ngày${h.leave.pendingDays > 0 ? ` · ${h.leave.pendingDays} ngày đang xin` : ''}` : 'Chưa có sổ phép năm nay',
        tone: h.leave ? 'num' : 'muted' });
      const t = h.timesheet;
      base.stats.push({ key: 'timesheet', label: `Công tháng ${t ? t.month : ctx.now.getMonth() + 1}`,
        target: route(query('/hrm/timesheet', { year: String(t?.year || ctx.now.getFullYear()), month: String(t?.month || ctx.now.getMonth() + 1) }), 'Bảng công'),
        value: t ? `${t.workDays} công · ${PERIOD_STATUS[t.periodStatus || ''] || 'kỳ đang chạy'}` : 'Chưa đọc được bảng công', tone: t ? 'num' : 'muted' });
      const team = h.team;
      base.stats.push(team?.state === 'ready'
        ? { key: 'team', label: 'Đội công trường', value: `${team.present ?? 0}/${team.total ?? 0} đã chấm công · ${team.assignments ?? 0} điều động hiệu lực`,
            target: route('/hrm/attendance', 'Bảng chấm công'), tone: (team.total || 0) > 0 && (team.present || 0) < (team.total || 0) ? 'warn' : 'num' }
        : { key: 'team', label: 'Đội công trường', value: team?.state === 'denied' ? 'Chỉ huy trưởng / HR xem' : 'Chưa chọn công trường', tone: 'muted',
            target: route('/hrm/attendance', 'Bảng chấm công'), locked: team?.state === 'denied' ? 'Số chấm công của đội chỉ chỉ huy trưởng công trường hoặc HR xem' : undefined });
      views.push(base);
    }
  }

  // Công việc
  {
    const g = group('work');
    const k = w.work;
    const base: WidgetView = { id: 'work', module: 'work', title: g.label, sub: g.hint, stats: [], route: '/rq', routeLabel: g.routeLabel };
    const my = route('/work/my', 'Việc của tôi');
    base.stats.push(k.workEnabled && k.assigned
      ? { key: 'assigned', label: 'Việc của tôi', target: my,
          value: k.assigned.active > 0
            ? `${k.assigned.active} đang làm${k.assigned.overdue > 0 ? ` · ${k.assigned.overdue} trễ hạn` : k.assigned.nearest ? ` · gần nhất ${ddmm(k.assigned.nearest.dueAt)}` : ''}`
            : 'Không có việc đang làm',
          tone: k.assigned.overdue > 0 ? 'danger' : k.assigned.active > 0 ? 'num' : 'muted' }
      : { key: 'assigned', label: 'Việc của tôi', value: 'Vioo Work chưa bật cho bạn', tone: 'muted', target: my, locked: 'Nhờ quản trị bật Vioo Work' });
    base.stats.push(k.workEnabled && k.created
      ? { key: 'created', label: 'Tôi giao', target: route(query('/work/my', { view: 'created_by_me' }), 'Việc tôi giao'),
          value: k.created.open > 0 ? `${k.created.open} việc${k.created.awaitingReview > 0 ? ` · ${k.created.awaitingReview} chờ bạn duyệt kết quả` : ''}` : 'Chưa giao việc nào',
          tone: k.created.awaitingReview > 0 ? 'warn' : k.created.open > 0 ? 'num' : 'muted' }
      : { key: 'created', label: 'Tôi giao', value: 'Vioo Work chưa bật cho bạn', tone: 'muted', target: my, locked: 'Nhờ quản trị bật Vioo Work' });
    const rq = k.requests;
    base.stats.push({ key: 'requests', label: 'Yêu cầu tôi gửi', target: route('/rq', 'Yêu cầu'),
      value: rq.returned > 0 ? `${rq.returned} bị trả lại cần sửa${rq.pending > 0 ? ` · ${rq.pending} đang chờ` : ''}`
        : rq.pending > 0 ? `${rq.pending} đang chờ${rq.latest ? ` · ${rq.latest.code}${rq.latest.waitingOn ? ` đang ở ${rq.latest.waitingOn}` : ''}` : ''}` : 'Không có yêu cầu đang chờ',
      tone: rq.returned > 0 ? 'danger' : rq.pending > 0 ? 'num' : 'muted' });
    views.push(base);
  }

  // Hành chính
  {
    const g = group('office');
    const o = w.office;
    const base: WidgetView = { id: 'office', module: 'office', title: g.label, sub: g.hint, stats: [], route: '/office', routeLabel: g.routeLabel };
    const d = o.documents;
    base.stats.push(d.state === 'ready'
      ? { key: 'documents', label: 'Văn bản',
          target: d.first ? route(`/office/documents/${encodeURIComponent(d.first.id)}`, d.first.documentNumber || 'Văn bản') : route(query('/office/documents', { view: 'unread' }), 'Văn bản'),
          value: (d.count || 0) > 0 ? `${d.count} cần xác nhận đã đọc${d.first ? ` · ${d.first.documentNumber || d.first.title}` : ''}` : 'Không có văn bản chờ bạn',
          tone: (d.count || 0) > 0 ? 'warn' : 'muted' }
      : { key: 'documents', label: 'Văn bản', value: d.state === 'denied' ? 'Chưa có quyền Office' : 'Chưa đọc được văn bản', tone: 'muted', target: route('/office', 'Office'), locked: d.state === 'denied' ? 'Nhờ quản trị cấp quyền Vioo Office' : undefined });
    const trip = o.nextTrip;
    base.stats.push({ key: 'trip', label: 'Xe', target: route(trip ? '/booking/vehicle/my' : '/booking/vehicle', 'Đặt xe'),
      value: trip ? `${ddmm(trip.pickupAt)} ${hhmm(trip.pickupAt)} · ${TRIP_STATUS[trip.status] || trip.status}${trip.vehicle ? ` · xe ${trip.vehicle}` : ''}` : 'Không có chuyến sắp tới',
      tone: trip ? 'num' : 'muted', hint: trip?.destination || undefined });
    const site = project?.site;
    const weatherTarget: DrillTarget = site?.latitude != null && site?.longitude != null && pid
      ? route(query('/da', { projectId: pid }), 'Dự án') : route('/hrm/assignments', 'Công trường');
    const weather = ctx.weather;
    base.stats.push({ key: 'weather', label: 'Thời tiết công trường', target: weatherTarget,
      value: !project ? 'Chưa chọn dự án' : !site || site.latitude == null || site.longitude == null ? 'Chưa khai tọa độ công trường'
        : weather === 'loading' ? 'Đang lấy thời tiết…' : weather === null ? 'Không lấy được thời tiết'
        : `${weather.temperature}° · ${weather.label}${weather.concreteWarning ? ' · hạn chế đổ bê tông' : ''}`,
      tone: weather && weather !== 'loading' && weather.concreteWarning ? 'warn' : !project || !site || weather === null || weather === 'loading' ? 'muted' : 'num',
      hint: weather && weather !== 'loading' && weather.humidity != null ? `${site?.name || ''} · độ ẩm ${weather.humidity}%${weather.rainChance != null ? ` · mưa ${weather.rainChance}%` : ''}` : site?.name });
    views.push(base);
  }

  // Mua hàng & Kho
  {
    const g = group('supply');
    const base: WidgetView = { id: 'supply', module: 'procurement', title: g.label, sub: project ? `Theo dự án ${project.code}` : g.hint, stats: [], route: '/procurement', routeLabel: g.routeLabel };
    const s = w.supply;
    if (!project || !s) {
      views.push({ ...base, empty: { text: 'Chọn dự án để thấy cần mua, đơn hàng và kho công trường.', target: route('/procurement', 'Mua hàng') } });
    } else {
      const mr = route(query('/da', { projectId: pid, tab: 'material', materialTab: 'request' }), 'Đề xuất vật tư');
      const rq = s.requests;
      base.stats.push(rq.state === 'ready'
        ? { key: 'requests', label: `Cần mua của ${project.code}`, target: mr,
            value: (rq.pending || 0) + (rq.supplying || 0) > 0
              ? `${rq.pending ?? 0} chờ duyệt${rq.waitingStep && (rq.pending || 0) > 0 ? ` (${rq.waitingStep})` : ''} · ${rq.supplying ?? 0} đang cung ứng` : 'Không có đề xuất đang mở',
            tone: (rq.pending || 0) > 0 ? 'warn' : (rq.supplying || 0) > 0 ? 'num' : 'muted' }
        : { key: 'requests', label: `Cần mua của ${project.code}`, value: 'Cần quyền xem đề xuất vật tư', tone: 'muted', target: mr, locked: 'Bạn chưa có quyền xem đề xuất vật tư của dự án này' });
      const po = route(query('/da', { projectId: pid, tab: 'material', materialTab: 'po' }), 'Đơn hàng');
      const od = s.orders;
      base.stats.push(od.state === 'ready'
        ? { key: 'orders', label: 'Đơn hàng', target: po,
            value: (od.open || 0) > 0 ? `${od.open} PO đang mở · ${moneyShort(od.openAmount)}${(od.awaitingApproval || 0) > 0 ? ` · ${od.awaitingApproval} chờ duyệt` : ''}` : 'Không có đơn hàng đang mở',
            tone: (od.awaitingApproval || 0) > 0 ? 'warn' : (od.open || 0) > 0 ? 'num' : 'muted' }
        : { key: 'orders', label: 'Đơn hàng', value: 'Cần quyền xem đơn hàng', tone: 'muted', target: po, locked: 'Bạn chưa có quyền xem đơn hàng của dự án này' });
      const wh = s.warehouse;
      base.stats.push(wh
        ? (wh.canView
          ? { key: 'warehouse', label: 'Kho', value: `${wh.name} · tồn & phiếu kho`, target: route('/inventory', 'Tồn kho'), tone: 'num' }
          : { key: 'warehouse', label: 'Kho', value: `${wh.name} · cần quyền Vật tư`, tone: 'muted', target: route('/inventory', 'Tồn kho'), locked: 'Nhờ quản trị cấp việc "Xem kho" ở Phân quyền kho' })
        : { key: 'warehouse', label: 'Kho', value: 'Dự án chưa gắn kho công trường', tone: 'muted', target: route(query('/da', { projectId: pid, tab: 'material' }), 'Vật tư') });
      views.push(base);
    }
  }

  // Tài chính dự án — chỉ khi máy chủ cho xem (null → ẩn hẳn).
  if (project && w.finance) {
    const g = group('finance');
    const f = w.finance;
    const fin = (tab: string) => route(query('/finance/project', { project: pid, tab }), 'Tài chính dự án');
    views.push({ id: 'finance', module: 'finance', title: g.label, sub: `${project.code}${f.progress != null ? ` · tiến độ ${Math.round(f.progress)}%` : ''}`, route: query('/finance/project', { project: pid }), routeLabel: g.routeLabel,
      stats: [
        { key: 'contract', label: 'HĐ chủ đầu tư', value: f.contractGross > 0 ? moneyShort(f.contractGross) : 'Chưa có hợp đồng', tone: f.contractGross > 0 ? 'num' : 'muted', target: fin('overview') },
        { key: 'received', label: 'Đã thu CĐT', value: f.openingTodo ? 'chưa khai đầu kỳ' : moneyShort(f.received), tone: f.openingTodo ? 'warn' : 'num', target: fin('overview'),
          hint: f.receivable > 0 ? `còn phải thu ${moneyShort(f.receivable)}${f.receivableOverdue > 0 ? ` · quá hạn ${moneyShort(f.receivableOverdue)}` : ''}` : undefined },
        { key: 'cost', label: 'Chi phí', value: f.cost != null ? `${moneyShort(f.cost)}${f.eac != null ? ` · dự kiến ${moneyShort(f.eac)}` : ''}` : 'Chưa có chi phí', tone: f.cost != null ? 'num' : 'muted', target: fin('cost'),
          hint: f.payable > 0 ? `nợ NCC ${moneyShort(f.payable)}${f.payableOverdue > 0 ? ` · quá hạn ${moneyShort(f.payableOverdue)}` : ''}` : undefined },
        { key: 'fund', label: 'Quỹ công trường', value: f.fundBalance != null ? moneyShort(f.fundBalance) : 'chưa khai', tone: f.fundBalance != null ? 'num' : 'warn', target: route('/site-fund', 'Quỹ công trường') },
      ] });
  }

  return views;
};

/** Dòng tóm tắt dưới lời chào: việc chờ + hạn hợp đồng của dự án đang xem. */
export const buildTodaySummary = (today: CenterToday | null, ctx: TodayContext): string => {
  const parts: string[] = [];
  if (ctx.mineCount !== null) parts.push(ctx.mineCount > 0 ? `${ctx.mineCount} việc chờ bạn` : 'không có việc chờ bạn');
  const project = today?.project;
  const days = daysUntil(project?.endDate, ctx.now);
  if (project && days !== null) parts.push(days < 0 ? `quá hạn hợp đồng ${project.code} ${-days} ngày` : days === 0 ? `hôm nay hết hạn hợp đồng ${project.code}` : `${days} ngày tới hạn hợp đồng ${project.code}`);
  return parts.join(' · ');
};
