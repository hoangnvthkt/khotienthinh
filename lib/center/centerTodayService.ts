import { supabase } from '../supabase';

// "Hôm nay": một RPC (vcc_my_center_v1) trả số liệu 6 nhóm widget cho chính người gọi; máy chủ gọi lại
// RPC / luật quyền của từng module. Phần không được xem về state 'denied' — trình duyệt không hiện 0 thay cho nó.

export type WidgetState = 'ready' | 'denied' | 'empty' | 'error';

export interface CenterProject {
  id: string;
  code: string;
  name: string;
  status: string | null;
  endDate: string | null;
  /** selected (tự chọn) · assignment (điều động H2) · most_work (nhiều việc chờ nhất) · member (dự án đầu tiên tôi thuộc) */
  source: 'selected' | 'assignment' | 'most_work' | 'member' | null;
  site: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
}

export interface CenterProjectOption { id: string; code: string; name: string; waiting: number }

export interface ProjectWidget {
  construction: { state: WidgetState; slips?: number; fronts?: number; people?: number; summaryStatus?: string | null };
  supply: { state: WidgetState; count?: number; amount?: number; nextPo?: { poId: string; poNumber: string; expectedDate: string | null } | null };
  progress: { state: WidgetState; mode?: string; percent?: number; total?: number; done?: number; overdue?: number; inProgress?: number; notStarted?: number; endDate?: string | null };
  waiting: number;
}

export interface HrmWidget {
  state: WidgetState;
  attendance?: { checkIn: string | null; checkOut: string | null; locationName: string | null; status: string | null } | null;
  leave?: { availableDays: number; pendingDays: number; year: number } | null;
  timesheet?: { workDays: number; month: number; year: number; periodStatus: string | null } | null;
  team?: { state: WidgetState; total?: number; present?: number; assignments?: number };
}

export interface WorkWidget {
  workEnabled: boolean;
  assigned: { active: number; overdue: number; nearest: { code: string; taskCode: string | null; dueAt: string } | null } | null;
  created: { open: number; awaitingReview: number } | null;
  requests: { pending: number; returned: number; latest: { id: string; code: string; title: string; status: string; waitingOn: string | null } | null };
}

export interface OfficeWidget {
  documents: { state: WidgetState; count?: number; first?: { id: string; documentNumber: string | null; title: string } | null };
  nextTrip: { id: string; code: string; status: string; pickupAt: string; destination: string; vehicle: string | null } | null;
}

export interface SupplyWidget {
  requests: { state: WidgetState; pending?: number; supplying?: number; waitingStep?: string | null };
  orders: { state: WidgetState; open?: number; openAmount?: number; awaitingApproval?: number };
  warehouse: { id: string; name: string; canView: boolean } | null;
}

/** Thẻ Tài chính dự án: đúng payload get_finance_project_summary_v1 (null = không được xem → ẩn widget). */
export interface FinanceWidget {
  projectId: string;
  contractGross: number;
  received: number;
  receivable: number;
  receivableOverdue: number;
  openingTodo: boolean;
  cost: number | null;
  committed: number | null;
  eac: number | null;
  payable: number;
  payableOverdue: number;
  fundBalance: number | null;
  progress: number | null;
}

export interface CenterToday {
  generatedAt: string;
  today: string;
  project: CenterProject | null;
  projectOptions: CenterProjectOption[];
  widgets: {
    project: ProjectWidget | null;
    hrm: HrmWidget;
    work: WorkWidget;
    office: OfficeWidget;
    supply: SupplyWidget | null;
    finance: FinanceWidget | null;
  };
}

type Row = Record<string, unknown>;
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null);
const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const n0 = (value: unknown): number => num(value) ?? 0;
const state = (value: unknown): WidgetState => (value === 'ready' || value === 'denied' || value === 'empty' || value === 'error' ? value : 'error');

const parseProjectWidget = (raw: unknown): ProjectWidget | null => {
  const row = obj(raw);
  if (!row) return null;
  const construction = obj(row.construction) || {};
  const supply = obj(row.supply) || {};
  const progress = obj(row.progress) || {};
  const nextPo = obj(supply.nextPo);
  return {
    construction: { state: state(construction.state), slips: num(construction.slips) ?? undefined, fronts: num(construction.fronts) ?? undefined,
      people: num(construction.people) ?? undefined, summaryStatus: str(construction.summaryStatus) },
    supply: { state: state(supply.state), count: num(supply.count) ?? undefined, amount: num(supply.amount) ?? undefined,
      nextPo: nextPo && str(nextPo.poId) ? { poId: str(nextPo.poId)!, poNumber: str(nextPo.poNumber) || '', expectedDate: str(nextPo.expectedDate) } : null },
    progress: { state: state(progress.state), mode: str(progress.mode) || undefined, percent: num(progress.percent) ?? undefined, total: num(progress.total) ?? undefined,
      done: num(progress.done) ?? undefined, overdue: num(progress.overdue) ?? undefined, inProgress: num(progress.inProgress) ?? undefined,
      notStarted: num(progress.notStarted) ?? undefined, endDate: str(progress.endDate) },
    waiting: n0(row.waiting),
  };
};

const parseHrm = (raw: unknown): HrmWidget => {
  const row = obj(raw);
  if (!row) return { state: 'error' };
  const attendance = obj(row.attendance);
  const leave = obj(row.leave);
  const timesheet = obj(row.timesheet);
  const team = obj(row.team);
  return {
    state: state(row.state),
    attendance: attendance ? { checkIn: str(attendance.checkIn), checkOut: str(attendance.checkOut), locationName: str(attendance.locationName), status: str(attendance.status) } : null,
    leave: leave ? { availableDays: n0(leave.availableDays), pendingDays: n0(leave.pendingDays), year: n0(leave.year) } : null,
    timesheet: timesheet ? { workDays: n0(timesheet.workDays), month: n0(timesheet.month), year: n0(timesheet.year), periodStatus: str(timesheet.periodStatus) } : null,
    team: team ? { state: state(team.state), total: num(team.total) ?? undefined, present: num(team.present) ?? undefined, assignments: num(team.assignments) ?? undefined } : undefined,
  };
};

const parseWork = (raw: unknown): WorkWidget => {
  const row = obj(raw) || {};
  const assigned = obj(row.assigned);
  const created = obj(row.created);
  const requests = obj(row.requests) || {};
  const nearest = obj(assigned?.nearest);
  const latest = obj(requests.latest);
  return {
    workEnabled: row.workEnabled === true,
    assigned: assigned ? { active: n0(assigned.active), overdue: n0(assigned.overdue),
      nearest: nearest && str(nearest.dueAt) ? { code: str(nearest.code) || '', taskCode: str(nearest.taskCode), dueAt: str(nearest.dueAt)! } : null } : null,
    created: created ? { open: n0(created.open), awaitingReview: n0(created.awaitingReview) } : null,
    requests: { pending: n0(requests.pending), returned: n0(requests.returned),
      latest: latest && str(latest.id) ? { id: str(latest.id)!, code: str(latest.code) || '', title: str(latest.title) || '', status: str(latest.status) || '', waitingOn: str(latest.waitingOn) } : null },
  };
};

const parseOffice = (raw: unknown): OfficeWidget => {
  const row = obj(raw) || {};
  const documents = obj(row.documents) || {};
  const first = obj(documents.first);
  const trip = obj(row.nextTrip);
  return {
    documents: { state: state(documents.state), count: num(documents.count) ?? undefined,
      first: first && str(first.id) ? { id: str(first.id)!, documentNumber: str(first.documentNumber), title: str(first.title) || '' } : null },
    nextTrip: trip && str(trip.id) ? { id: str(trip.id)!, code: str(trip.code) || '', status: str(trip.status) || '', pickupAt: str(trip.pickupAt) || '',
      destination: str(trip.destination) || '', vehicle: str(trip.vehicle) } : null,
  };
};

const parseSupply = (raw: unknown): SupplyWidget | null => {
  const row = obj(raw);
  if (!row) return null;
  const requests = obj(row.requests) || {};
  const orders = obj(row.orders) || {};
  const warehouse = obj(row.warehouse);
  return {
    requests: { state: state(requests.state), pending: num(requests.pending) ?? undefined, supplying: num(requests.supplying) ?? undefined, waitingStep: str(requests.waitingStep) },
    orders: { state: state(orders.state), open: num(orders.open) ?? undefined, openAmount: num(orders.openAmount) ?? undefined, awaitingApproval: num(orders.awaitingApproval) ?? undefined },
    warehouse: warehouse && str(warehouse.id) ? { id: str(warehouse.id)!, name: str(warehouse.name) || 'Kho', canView: warehouse.canView === true } : null,
  };
};

const parseFinance = (raw: unknown): FinanceWidget | null => {
  const row = obj(raw);
  if (!row || !str(row.projectId)) return null;
  return {
    projectId: str(row.projectId)!,
    contractGross: n0(row.contractGross), received: n0(row.received), receivable: n0(row.receivable), receivableOverdue: n0(row.receivableOverdue),
    openingTodo: row.openingTodo === true, cost: num(row.cost), committed: num(row.committed), eac: num(row.eac),
    payable: n0(row.payable), payableOverdue: n0(row.payableOverdue), fundBalance: num(row.fundBalance), progress: num(row.progress),
  };
};

export const parseCenterToday = (raw: unknown): CenterToday => {
  const row = obj(raw) || {};
  const project = obj(row.project);
  const site = obj(project?.site);
  const widgets = obj(row.widgets) || {};
  const source = str(project?.source);
  return {
    generatedAt: str(row.generatedAt) || new Date().toISOString(),
    today: str(row.today) || new Date().toISOString().slice(0, 10),
    project: project && str(project.id) ? {
      id: str(project.id)!, code: str(project.code) || '', name: str(project.name) || '', status: str(project.status), endDate: str(project.endDate),
      source: source === 'selected' || source === 'assignment' || source === 'most_work' || source === 'member' ? source : null,
      site: site && str(site.id) ? { id: str(site.id)!, name: str(site.name) || '', latitude: num(site.latitude), longitude: num(site.longitude) } : null,
    } : null,
    projectOptions: (Array.isArray(row.projectOptions) ? row.projectOptions : []).map(obj)
      .filter((option): option is Row => !!option && !!str(option.id))
      .map(option => ({ id: str(option.id)!, code: str(option.code) || '', name: str(option.name) || '', waiting: n0(option.waiting) })),
    widgets: {
      project: parseProjectWidget(widgets.project),
      hrm: parseHrm(widgets.hrm),
      work: parseWork(widgets.work),
      office: parseOffice(widgets.office),
      supply: parseSupply(widgets.supply),
      finance: parseFinance(widgets.finance),
    },
  };
};

export const fetchCenterToday = async (projectId: string | null): Promise<CenterToday> => {
  const { data, error } = await supabase.rpc('vcc_my_center_v1', { p_project_id: projectId });
  if (error) throw error;
  return parseCenterToday(data);
};
