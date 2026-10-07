import { supabase } from '../supabase';
import type { CenterWidgetId } from './centerRegistry';
import type { DrillTarget } from './drill';
import type { CenterProject } from './centerTodayService';

// Thao tác nhanh trong từng ô "Hôm nay" (kế hoạch 07 mục 5). Máy chủ (vcc_my_actions_v1) trả "được bấm gì";
// trình duyệt chỉ hiện đúng cờ: bật → mở form / màn thật của module, tắt → 🔒 kèm lý do.

export interface CenterActionFlags {
  projectId: string | null;
  employee: boolean;
  project: { materialRequest: boolean; dailyLog: boolean; dailyReport: boolean; workPlan: boolean } | null;
  hrm: { checkin: boolean; leave: boolean; makeup: boolean; timesheet: boolean; assignment: boolean };
  work: { request: boolean; workflow: boolean; po: boolean; task: boolean };
  office: { compose: boolean; incoming: boolean; booking: boolean; directory: boolean };
  supply: { hot: boolean; inbox: boolean; receive: boolean; count: boolean; warehouseId: string | null } | null;
  finance: { siteFund: boolean; projectFinance: boolean; paymentRequest: boolean } | null;
}

/** Form mở ngay trong Center (modal thật của module). */
export type CenterModal = 'request' | 'leave';

export type ActionTarget = DrillTarget | { kind: 'modal'; modal: CenterModal; title: string };

export interface WidgetAction {
  key: string;
  label: string;
  /** Nút chính của nhóm (nền màu module). */
  primary?: boolean;
  enabled: boolean;
  /** Vì sao bị khóa — hiện ở tooltip, không hiện số 0 hay ẩn nút. */
  lockReason?: string;
  target: ActionTarget;
}

type Row = Record<string, unknown>;
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null);
const flag = (row: Row | null, key: string): boolean => row?.[key] === true;

export const parseCenterActionFlags = (raw: unknown): CenterActionFlags => {
  const row = obj(raw) || {};
  const project = obj(row.project);
  const hrm = obj(row.hrm);
  const work = obj(row.work);
  const office = obj(row.office);
  const supply = obj(row.supply);
  const finance = obj(row.finance);
  return {
    projectId: typeof row.projectId === 'string' && row.projectId ? row.projectId : null,
    employee: row.employee === true,
    project: project ? { materialRequest: flag(project, 'materialRequest'), dailyLog: flag(project, 'dailyLog'), dailyReport: flag(project, 'dailyReport'), workPlan: flag(project, 'workPlan') } : null,
    hrm: { checkin: flag(hrm, 'checkin'), leave: flag(hrm, 'leave'), makeup: flag(hrm, 'makeup'), timesheet: flag(hrm, 'timesheet'), assignment: flag(hrm, 'assignment') },
    work: { request: flag(work, 'request'), workflow: flag(work, 'workflow'), po: flag(work, 'po'), task: flag(work, 'task') },
    office: { compose: flag(office, 'compose'), incoming: flag(office, 'incoming'), booking: flag(office, 'booking'), directory: flag(office, 'directory') },
    supply: supply ? { hot: flag(supply, 'hot'), inbox: flag(supply, 'inbox'), receive: flag(supply, 'receive'), count: flag(supply, 'count'),
      warehouseId: typeof supply.warehouseId === 'string' && supply.warehouseId ? supply.warehouseId : null } : null,
    finance: finance ? { siteFund: flag(finance, 'siteFund'), projectFinance: flag(finance, 'projectFinance'), paymentRequest: flag(finance, 'paymentRequest') } : null,
  };
};

export const fetchCenterActions = async (projectId: string | null): Promise<CenterActionFlags> => {
  const { data, error } = await supabase.rpc('vcc_my_actions_v1', { p_project_id: projectId });
  if (error) throw error;
  return parseCenterActionFlags(data);
};

const route = (path: string, title: string): ActionTarget => ({ kind: 'route', path, title });
const tab = (renderer: 'procurement' | 'finance' | 'site_assignment', props: Record<string, string>, title: string, path: string): ActionTarget =>
  ({ kind: 'tab', renderer, props, title, route: path });
const modal = (name: CenterModal, title: string): ActionTarget => ({ kind: 'modal', modal: name, title });
const query = (base: string, params: Record<string, string | null | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value); });
  const encoded = search.toString();
  return encoded ? `${base}?${encoded}` : base;
};
const mondayOf = (now: Date): string => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const NO_EMPLOYEE = 'Tài khoản chưa gắn với hồ sơ nhân viên — nhờ HR gắn';
const NO_PROJECT = 'Chọn dự án trước';
const act = (key: string, label: string, enabled: boolean, target: ActionTarget, lockReason: string, primary = false): WidgetAction =>
  ({ key, label, primary, enabled, lockReason: enabled ? undefined : lockReason, target });

/** Nút của một ô, theo cờ máy chủ. Luôn trả đủ nút (khóa khi thiếu quyền) để người dùng biết ô này làm được gì. */
export const buildWidgetActions = (
  widget: CenterWidgetId,
  flags: CenterActionFlags | null,
  project: CenterProject | null,
  now: Date,
): WidgetAction[] => {
  const pid = project?.id || null;
  const da = (params: Record<string, string | null>) => query('/da', { projectId: pid, ...params });
  switch (widget) {
    case 'project': {
      const f = flags?.project;
      const reason = !pid ? NO_PROJECT : !flags ? 'Đang kiểm tra quyền' : 'Chưa có quyền này trong Tổ chức dự án';
      return [
        act('material_request', 'Lập đề xuất vật tư', !!pid && !!f?.materialRequest, route(da({ tab: 'material', materialTab: 'request' }), 'Đề xuất vật tư'), reason, true),
        act('daily_log', 'Tạo nhật ký', !!pid && !!f?.dailyLog, route(da({ tab: 'dailylog' }), 'Nhật ký'), reason),
        act('work_plan', 'Kế hoạch tuần', !!pid && !!f?.workPlan, route(da({ tab: 'work_plan', period: 'week', start: mondayOf(now) }), 'Kế hoạch tuần'), reason),
        act('daily_report', 'Báo cáo ngày', !!pid && !!f?.dailyReport, route(da({ tab: 'dailylog' }), 'Báo cáo ngày'), reason),
      ];
    }
    case 'hrm': {
      const f = flags?.hrm;
      return [
        act('checkin', 'Chấm công', !!f?.checkin, route('/hrm/checkin', 'Chấm công'), NO_EMPLOYEE, true),
        act('leave', 'Xin nghỉ phép', !!f?.leave, modal('leave', 'Xin nghỉ phép'), NO_EMPLOYEE),
        act('makeup', 'Chấm công bù', !!f?.makeup, route(query('/hrm/attendance', { tab: 'proposals' }), 'Chấm công bù'), NO_EMPLOYEE),
        act('timesheet', 'Bảng công của tôi', !!f?.timesheet, route(query('/hrm/timesheet', { year: String(now.getFullYear()), month: String(now.getMonth() + 1) }), 'Bảng công'), NO_EMPLOYEE),
        act('assignment', 'Điều động', !!f?.assignment, tab('site_assignment', {}, 'Điều động công trường', '/hrm/assignments'), 'Chỉ HR / HR Manage lập điều động'),
      ];
    }
    case 'work': {
      const f = flags?.work;
      return [
        act('request', 'Tạo đề xuất', !!f?.request, modal('request', 'Tạo đề xuất'), 'Chưa có quyền tạo yêu cầu', true),
        act('workflow', 'Tạo phiếu quy trình', !!f?.workflow, route('/wf', 'Quy trình'), 'Chưa có quyền tạo phiếu quy trình'),
        act('po', 'Lập đơn hàng', !!f?.po, tab('procurement', {}, 'Mua hàng', '/procurement'), 'Chỉ Mua hàng lập đơn hàng'),
        act('task', 'Tạo công việc', !!f?.task, route(query('/work/my', { create: '1' }), 'Vioo Work'), 'Vioo Work chưa bật hoặc chưa có quyền tạo việc'),
      ];
    }
    case 'office': {
      const f = flags?.office;
      return [
        act('booking', 'Đặt xe', f ? f.booking : true, route('/booking/vehicle', 'Đặt xe'), 'Chưa mở đặt xe', true),
        act('compose', 'Soạn văn bản', !!f?.compose, route('/office/new', 'Soạn văn bản'), 'Chưa có quyền soạn văn bản Office'),
        act('incoming', 'Văn bản đến', !!f?.incoming, route(query('/office/documents', { view: 'assigned' }), 'Văn bản đến'), 'Chưa có quyền Vioo Office'),
        act('directory', 'Tra cứu nhân viên', !!f?.directory, route('/ep', 'Hồ sơ nhân sự'), 'Chưa có quyền xem danh bạ'),
      ];
    }
    case 'supply': {
      const f = flags?.supply;
      const reason = !pid ? NO_PROJECT : 'Chưa có quyền này';
      return [
        act('hot', 'Mua nóng / CCDC', !!pid && !!f?.hot, tab('procurement', { initialMode: 'hot' }, 'Mua nóng', query('/procurement', { mode: 'hot' })), !pid ? NO_PROJECT : 'Cần quyền Mua nóng ở dự án này', true),
        act('inbox', 'Xem Cần mua', !!f?.inbox, tab('procurement', {}, 'Cần mua', '/procurement'), 'Chỉ Mua hàng xem Cần mua'),
        act('receive', 'Nhận hàng', !!pid && !!f?.receive, route('/operations', 'Phiếu kho'), !pid ? NO_PROJECT : 'Cần việc Thủ kho ở kho công trường'),
        act('count', 'Kiểm kê', !!pid && !!f?.count, route('/audit', 'Kiểm kê'), !pid ? NO_PROJECT : 'Cần việc Thủ kho ở kho công trường'),
      ].map(item => ({ ...item, lockReason: item.enabled ? undefined : item.lockReason || reason }));
    }
    case 'finance': {
      const f = flags?.finance;
      return [
        act('site_fund', 'Chi quỹ công trường', !!pid && !!f?.siteFund, route('/site-fund', 'Quỹ công trường'), !pid ? NO_PROJECT : 'Bạn không giữ quỹ công trường của dự án này', true),
        act('project_finance', 'Tài chính dự án', !!pid && !!f?.projectFinance, route(query('/finance/project', { project: pid }), 'Tài chính dự án'), !pid ? NO_PROJECT : 'Dự án chưa bật công tắc xem tài chính cho bạn'),
        act('payment_request', 'Đề nghị chi', !!f?.paymentRequest, tab('finance', { initialSection: 'requests' }, 'Đề nghị chi', '/finance/requests'), 'Chỉ Tài chính — Ghi nhận lập đề nghị chi'),
      ];
    }
    default: return [];
  }
};
