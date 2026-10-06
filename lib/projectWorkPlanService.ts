import { supabase } from './supabase';

export type WorkPlanPeriodType = 'month' | 'week';
export type WorkPlanStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'superseded' | 'cancelled';

export interface WorkPlanLine {
  id?: string;
  taskId: string;
  workBoqItemId: string | null;
  wbsCode: string | null;
  taskName: string;
  groupName: string | null;
  unit: string | null;
  totalQty: number | null;
  doneBeforeQty: number | null;
  plannedQty: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  crewLabel: string | null;
  note: string | null;
  /** Work recorded in the period (Nhật ký / Chốt tiến độ). Null = nothing recorded yet. */
  actualQty?: number | null;
  lastProgressDate?: string | null;
  /** Lý do thay đổi của dòng trong bản điều chỉnh (null = dòng không đổi / bản gốc). */
  changeReasonCode?: string | null;
  responsibleParty?: ResponsibleParty | null;
  changeNote?: string | null;
}

export type ResponsibleParty = 'owner' | 'company' | 'vendor' | 'objective';
export interface PlanChangeReason { code: string; label: string; defaultParty: ResponsibleParty; needsDocument: boolean }
export interface WorkPlanAttachment { name: string; path: string; size: number; type: string; uploadedAt: string }
/** Việc bị bỏ khỏi kỳ trong bản điều chỉnh (so với bản nó thay thế). */
export interface WorkPlanRemovedLine {
  taskId: string; wbsCode: string | null; taskName: string; groupName: string | null; unit: string | null;
  plannedQty: number | null; plannedStart: string | null; plannedEnd: string | null; crewLabel: string | null;
  changeReasonCode: string | null; responsibleParty: ResponsibleParty | null; changeNote: string | null;
}

export interface WorkPlanEvent { action: string; at: string; reason: string | null; actorName: string | null }

export interface WorkPlan {
  id: string;
  projectId: string;
  constructionSiteId: string | null;
  periodType: WorkPlanPeriodType;
  periodStart: string;
  periodEnd: string;
  code: string;
  status: WorkPlanStatus;
  revisionNo: number;
  supersedesPlanId: string | null;
  note: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  submittedToUserId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  returnedAt: string | null;
  returnedByName: string | null;
  returnReason: string | null;
  changeReasonCode: string | null;
  responsibleParty: ResponsibleParty | null;
  changeSummary: string | null;
  attachments: WorkPlanAttachment[];
  removedLines: WorkPlanRemovedLine[];
  needsReviewAt: string | null;
  needsReviewReason: string | null;
  lines: WorkPlanLine[];
  events: WorkPlanEvent[];
}

export interface WorkPlanHistoryItem {
  id: string; code: string; periodStart: string; periodEnd: string; status: WorkPlanStatus;
  revisionNo: number; lineCount: number; approvedAt: string | null; updatedAt: string;
}

export interface WorkPlanBoard {
  periodType: WorkPlanPeriodType;
  periodStart: string;
  periodEnd: string;
  code: string;
  today: string;
  periodEnded: boolean;
  currentUserId: string | null;
  approved: WorkPlan | null;
  open: WorkPlan | null;
  /** Mọi bản của kỳ (trừ đã hủy), theo số bản tăng dần. */
  versions: WorkPlan[];
  reasons: PlanChangeReason[];
  permissions: { canEdit: boolean; canSubmit: boolean; canDelete: boolean; canApprove: boolean };
  approvers: Array<{ id: string; name: string }>;
  history: WorkPlanHistoryItem[];
}

export interface WorkPlanCandidate {
  taskId: string;
  workBoqItemId: string | null;
  wbsCode: string | null;
  taskName: string;
  groupName: string | null;
  unit: string | null;
  totalQty: number | null;
  doneBeforeQty: number | null;
  remainingQty: number | null;
  pctBefore: number | null;
  startDate: string | null;
  endDate: string | null;
  finished: boolean;
  overdue: boolean;
  inPeriod: boolean;
  suggestedQty: number | null;
  monthPlanQty: number | null;
}

export interface SaveWorkPlanInput {
  planId?: string;
  expectedRowVersion?: number;
  projectId: string;
  constructionSiteId: string | null;
  periodType: WorkPlanPeriodType;
  periodStart: string;
  note: string;
  lines: Array<Pick<WorkPlanLine, 'taskId' | 'plannedQty' | 'plannedStart' | 'plannedEnd' | 'crewLabel' | 'note' | 'changeReasonCode' | 'responsibleParty' | 'changeNote'>>;
  changeReasonCode?: string | null;
  responsibleParty?: ResponsibleParty | null;
  changeSummary?: string | null;
  attachments?: WorkPlanAttachment[];
  removedLines?: Array<{ taskId: string; changeReasonCode: string | null; responsibleParty?: ResponsibleParty | null; changeNote?: string | null }>;
}

export type WorkPlanAction = 'submit' | 'withdraw' | 'approve' | 'return' | 'delete' | 'keep';

export interface WorkPlanImpact {
  materials: Array<{ itemId: string; itemName: string; unit: string; baseQty: number; newQty: number; deltaQty: number;
    unitPrice: number | null; priceSource: 'budget' | 'last_po' | null }>;
  weeks: Array<{ planId: string; periodStart: string; status: WorkPlanStatus; createdByName: string | null }>;
  materialPlans: Array<{ planId: string; status: WorkPlanStatus; revisionNo: number }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  WORK_PLAN_VIEW_DENIED: 'Bạn chưa có quyền xem kế hoạch của dự án này. Nhờ quản trị cấp quyền "Kế hoạch tháng/tuần".',
  WORK_PLAN_EDIT_DENIED: 'Bạn chưa có quyền lập hoặc sửa kế hoạch.',
  WORK_PLAN_SUBMIT_DENIED: 'Bạn chưa có quyền gửi duyệt kế hoạch.',
  WORK_PLAN_APPROVE_DENIED: 'Bạn chưa có quyền duyệt kế hoạch kỳ này.',
  WORK_PLAN_DELETE_DENIED: 'Chỉ xóa được bản nháp chưa từng gửi duyệt.',
  WORK_PLAN_WITHDRAW_DENIED: 'Chỉ người gửi mới rút được kế hoạch đang chờ duyệt.',
  WORK_PLAN_SCOPE_DENIED: 'Công trường không thuộc dự án này.',
  WORK_PLAN_PERIOD_INVALID: 'Kỳ kế hoạch không hợp lệ.',
  WORK_PLAN_ALREADY_OPEN: 'Kỳ này đã có một bản kế hoạch đang soạn hoặc chờ duyệt. Tải lại để mở bản đó.',
  WORK_PLAN_ALREADY_APPROVED: 'Kỳ này đã có kế hoạch được duyệt. Dùng "Tạo bản điều chỉnh" để thay đổi.',
  WORK_PLAN_NOT_EDITABLE: 'Kế hoạch đã gửi duyệt hoặc đã duyệt nên không sửa trực tiếp được.',
  WORK_PLAN_NOT_SUBMITTED: 'Kế hoạch không còn ở trạng thái chờ duyệt. Tải lại để xem trạng thái mới.',
  WORK_PLAN_NOT_APPROVED: 'Chỉ tạo bản điều chỉnh từ kế hoạch đã duyệt.',
  WORK_PLAN_EMPTY: 'Thêm ít nhất một công việc trước khi gửi duyệt.',
  WORK_PLAN_TASK_INVALID: 'Có công việc không còn trong bảng tiến độ. Tải lại danh sách công việc.',
  WORK_PLAN_QTY_INVALID: 'Khối lượng kế hoạch không được âm.',
  WORK_PLAN_DATES_OUTSIDE_PERIOD: 'Ngày bắt đầu/kết thúc phải nằm trong kỳ kế hoạch.',
  WORK_PLAN_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại để người lập biết cần sửa gì.',
  WORK_PLAN_REVISION_REASON_REQUIRED: 'Nhập lý do điều chỉnh kế hoạch.',
  WORK_PLAN_APPROVER_INVALID: 'Người được chọn chưa có quyền duyệt kế hoạch kỳ này, hoặc là người lập.',
  WORK_PLAN_PERIOD_ENDED: 'Kỳ đã kết thúc — chỉ xem, không lập hay điều chỉnh kế hoạch nữa.',
  WORK_PLAN_START_LOCKED: 'Việc đã bắt đầu thì giữ ngày bắt đầu, chỉ dời ngày kết thúc',
  WORK_PLAN_START_IN_PAST: 'Không dời ngày bắt đầu về ngày đã qua',
  WORK_PLAN_END_IN_PAST: 'Không dời ngày kết thúc về ngày đã qua',
  WORK_PLAN_NEW_LINE_IN_PAST: 'Việc thêm mới phải bắt đầu từ hôm nay trở đi',
  WORK_PLAN_QTY_BELOW_DONE: 'Khối lượng kế hoạch không được thấp hơn phần đã làm trong kỳ',
  WORK_PLAN_REMOVE_DONE_LINE: 'Việc đã làm trong kỳ không bỏ khỏi kỳ được — giảm khối lượng về phần đã làm',
  WORK_PLAN_CHANGE_REASON_REQUIRED: 'Chọn lý do chính của bản điều chỉnh.',
  WORK_PLAN_CHANGE_SUMMARY_REQUIRED: 'Ghi mô tả ngắn điều gì thay đổi và vì sao (ít nhất 10 ký tự).',
  WORK_PLAN_NO_CHANGES: 'Bản điều chỉnh chưa thay đổi gì so với bản đang áp dụng.',
  WORK_PLAN_DOCUMENT_REQUIRED: 'Lý do này cần văn bản (công văn, biên bản) — đính kèm trước khi gửi.',
  WORK_PLAN_SELF_APPROVAL_DENIED: 'Người lập hoặc người gửi không tự duyệt / trả lại bản của mình.',
  WORK_PLAN_NOT_FLAGGED: 'Kế hoạch này không còn ở trạng thái cần xem lại. Tải lại.',
  WORK_PLAN_KEEP_REASON_REQUIRED: 'Ghi lý do giữ nguyên kế hoạch.',
  WORK_PLAN_REASON_INVALID: 'Lý do không có trong danh mục. Tải lại trang.',
  WORK_PLAN_PARTY_INVALID: 'Bên chịu trách nhiệm không hợp lệ.',
  WORK_PLAN_ATTACHMENTS_INVALID: 'Danh sách văn bản đính kèm không hợp lệ.',
  ROW_VERSION_CONFLICT: 'Kế hoạch vừa được người khác cập nhật. Tải lại rồi thử lại.',
};

const DETAIL_CODES = new Set(['WORK_PLAN_START_LOCKED', 'WORK_PLAN_START_IN_PAST', 'WORK_PLAN_END_IN_PAST', 'WORK_PLAN_NEW_LINE_IN_PAST',
  'WORK_PLAN_QTY_BELOW_DONE', 'WORK_PLAN_REMOVE_DONE_LINE']);

export const mapWorkPlanError = (error: { message?: string; code?: string; details?: string } | null): Error => {
  const code = Object.keys(ERROR_MESSAGES).sort((a, b) => b.length - a.length).find(key => error?.message?.includes(key));
  const detail = code && DETAIL_CODES.has(code) ? (error?.details ? `: ${error.details}.` : '.') : '';
  const mapped = new Error(code ? ERROR_MESSAGES[code] + detail : 'Không thực hiện được thao tác với kế hoạch. Thử lại sau.');
  (mapped as Error & { code?: string }).code = code || error?.code;
  return mapped;
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw mapWorkPlanError(error);
  return data as T;
};

export const projectWorkPlanService = {
  getBoard(input: { projectId: string; constructionSiteId: string | null; periodType: WorkPlanPeriodType; periodStart: string }) {
    return call<WorkPlanBoard>('get_project_work_plan_board_v1', {
      p_project_id: input.projectId, p_construction_site_id: input.constructionSiteId,
      p_period_type: input.periodType, p_period_start: input.periodStart,
    });
  },
  listCandidates(input: { projectId: string; constructionSiteId: string | null; periodType: WorkPlanPeriodType; periodStart: string }) {
    return call<WorkPlanCandidate[]>('list_project_work_plan_candidates_v1', {
      p_project_id: input.projectId, p_construction_site_id: input.constructionSiteId,
      p_period_type: input.periodType, p_period_start: input.periodStart,
    }).then(rows => rows || []);
  },
  save(input: SaveWorkPlanInput) {
    return call<{ planId: string; rowVersion: number; status: WorkPlanStatus }>('save_project_work_plan_v1', { p_input: input });
  },
  transition(input: { planId: string; expectedRowVersion: number; action: WorkPlanAction; reason?: string; recipientUserId?: string | null }) {
    return call<{ planId: string; rowVersion?: number; status?: WorkPlanStatus; deleted?: boolean }>('transition_project_work_plan_v1', { p_input: input });
  },
  revise(input: { planId: string; reason?: string }) {
    return call<{ planId: string; rowVersion: number; status: WorkPlanStatus }>('revise_project_work_plan_v1', { p_input: input });
  },
  /** Vật tư kéo theo + KH tuần bị ảnh hưởng của một bản so với bản nó thay thế. */
  previewImpact(planId: string) {
    return call<WorkPlanImpact>('preview_project_work_plan_impact_v1', { p_plan_id: planId });
  },
  async uploadAttachments(input: { projectId: string; constructionSiteId: string | null; files: File[] }): Promise<WorkPlanAttachment[]> {
    const out: WorkPlanAttachment[] = [];
    for (const file of input.files) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`Tệp ${file.name} vượt quá 25 MB.`);
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const safe = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${input.projectId}/${input.constructionSiteId || '-'}/${id}-${safe}`;
      const { error } = await supabase.storage.from(WORK_PLAN_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw new Error(`Không tải được ${file.name}: ${error.message}`);
      out.push({ name: file.name, path, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
    }
    return out;
  },
  async openAttachment(path: string) {
    const target = window.open('about:blank', '_blank');
    const { data, error } = await supabase.storage.from(WORK_PLAN_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) { target?.close(); throw new Error('Không mở được tệp.'); }
    if (target) { target.opener = null; target.location.href = data.signedUrl; } else window.location.assign(data.signedUrl);
  },
};

export const WORK_PLAN_BUCKET = 'work-plan-attachments';

export const RESPONSIBLE_PARTY_LABELS: Record<ResponsibleParty, string> = {
  owner: 'Chủ đầu tư', company: 'Công ty', vendor: 'Thầu phụ / NCC', objective: 'Khách quan',
};

// Period helpers (local dates, ISO weeks start on Monday).
const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseIsoDate = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };

export const normalizeWorkPlanPeriodStart = (type: WorkPlanPeriodType, value: string): string => {
  const date = parseIsoDate(value);
  if (type === 'month') return toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
  const offset = (date.getDay() + 6) % 7;
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset));
};

export const shiftWorkPlanPeriod = (type: WorkPlanPeriodType, start: string, step: number): string => {
  const date = parseIsoDate(start);
  if (type === 'month') return toIsoDate(new Date(date.getFullYear(), date.getMonth() + step, 1));
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * step));
};

export const workPlanPeriodEnd = (type: WorkPlanPeriodType, start: string): string => {
  const date = parseIsoDate(start);
  if (type === 'month') return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6));
};

const isoWeekNumber = (start: string) => {
  const date = parseIsoDate(start);
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  return 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
};

const dm = (value: string) => { const [, m, d] = value.split('-'); return `${d}/${m}`; };

export const formatWorkPlanPeriod = (type: WorkPlanPeriodType, start: string): string => {
  const [y, m] = start.split('-');
  if (type === 'month') return `Tháng ${Number(m)}/${y}`;
  const end = workPlanPeriodEnd('week', start);
  return `Tuần ${isoWeekNumber(start)} (${dm(start)} – ${dm(end)}/${end.slice(0, 4)})`;
};

export const WORK_PLAN_STATUS_LABELS: Record<WorkPlanStatus, string> = {
  draft: 'Nháp', submitted: 'Chờ duyệt', returned: 'Bị trả lại', approved: 'Đã duyệt',
  superseded: 'Đã thay bằng bản điều chỉnh', cancelled: 'Đã hủy',
};

/** Share of planned quantity done in the period; null when either side is unknown. */
export const workPlanLineAchievement = (line: Pick<WorkPlanLine, 'plannedQty' | 'actualQty'>): number | null => {
  if (line.plannedQty == null || line.plannedQty <= 0 || line.actualQty == null) return null;
  return (line.actualQty / line.plannedQty) * 100;
};
