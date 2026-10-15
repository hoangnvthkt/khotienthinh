// Điều chỉnh tiến độ có duyệt (PR-2, chủ SP duyệt 15/10/2026). Dự án bật kiểm soát: ngày, khối lượng,
// thêm / xóa việc chỉ đổi qua phiếu; CHT duyệt, tùy chọn thêm bước "Duyệt dời về đích"; mỗi lần duyệt lưu một phiên bản.
import type { ProjectTask } from '../types';
import { supabase } from './supabase';

export type ScheduleParty = 'owner' | 'company' | 'objective';
export type ScheduleChangeStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'cancelled';
export type ScheduleLineAction = 'update' | 'add' | 'delete';

export const SCHEDULE_PARTY_LABELS: Record<ScheduleParty, string> = { owner: 'CĐT', company: 'Công ty', objective: 'Khách quan' };
export const SCHEDULE_PARTIES: ScheduleParty[] = ['owner', 'company', 'objective'];
// Lý do mặc định "NCC" của KH tháng/tuần tính cho Công ty ở tiến độ tổng (chủ SP 15/10).
export const toScheduleParty = (party: string | null | undefined): ScheduleParty =>
  party === 'owner' || party === 'objective' ? party : 'company';

export interface ScheduleUser { id: string; name: string }
export interface ScheduleAttachment { name: string; path: string; size?: number; type?: string; uploadedAt?: string }
export interface ScheduleReason { code: string; label: string; defaultParty: ScheduleParty; needsDocument: boolean }

export interface ScheduleChangeLine {
  taskId: string;
  action: ScheduleLineAction;
  parentId: string | null;
  wbsCode: string | null;
  taskName: string;
  isLeaf: boolean;
  beforeStart: string | null;
  beforeEnd: string | null;
  beforeQty: number | null;
  afterStart: string | null;
  afterEnd: string | null;
  afterQty: number | null;
  deltaDays: number | null;
  reasonCode: string | null;
  responsibleParty: ScheduleParty | null;
  note: string | null;
  payload: { unit?: string; assignee?: string; assigneeUserId?: string; sortOrder?: number; isMilestone?: boolean };
}

export interface ScheduleChange {
  id: string;
  projectId: string;
  constructionSiteId: string | null;
  code: string;
  status: ScheduleChangeStatus;
  step: 'approve' | 'confirm' | null;
  reasonCode: string | null;
  responsibleParty: ScheduleParty | null;
  summary: string | null;
  attachments: ScheduleAttachment[];
  isContractExtension: boolean;
  finishBefore: string | null;
  finishAfter: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvers: ScheduleUser[];
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  versionId: string | null;
  updatedAt: string;
  rowVersion: number;
  lines: ScheduleChangeLine[];
  events: Array<{ action: string; actorId: string | null; actorName: string | null; reason: string | null; at: string }>;
}

export interface ScheduleReviewPlan {
  id: string; code: string | null; periodType: 'month' | 'week'; periodStart: string; periodEnd: string;
  status: string; reason: string | null; flaggedAt: string;
}

export interface ScheduleControl {
  controlled: boolean;
  currentUserId?: string | null;
  enabledAt?: string;
  contractFinishDate?: string | null;
  currentFinish?: string | null;
  canPropose?: boolean;
  canApprove?: boolean;
  canConfirm?: boolean;
  proposers?: ScheduleUser[];
  approvers?: ScheduleUser[];
  confirmers?: ScheduleUser[];
  /** Ai sẽ duyệt nếu người đang xem lập phiếu (CHT; CHT tự lập → Admin). */
  myApprovers?: ScheduleUser[];
  openChange?: ScheduleChange | null;
  recentChanges?: Array<{ id: string; code: string; status: string; finishBefore: string | null; finishAfter: string | null;
    createdByName: string | null; approvedAt: string | null; confirmedAt: string | null; reasonCode: string | null;
    responsibleParty: ScheduleParty | null; lineCount: number }>;
  reviewPlans?: ScheduleReviewPlan[];
}

/** Dòng gửi lên máy chủ khi lưu nháp (máy chủ tự lấy số "trước"). */
export interface ScheduleDraftLineInput {
  taskId: string;
  action: ScheduleLineAction;
  afterStart?: string;
  afterEnd?: string;
  afterQty?: number;
  reasonCode?: string | null;
  responsibleParty?: ScheduleParty | null;
  note?: string | null;
  name?: string;
  parentId?: string | null;
  wbsCode?: string | null;
  unit?: string | null;
  assignee?: string | null;
  assigneeUserId?: string | null;
  sortOrder?: number;
  isMilestone?: boolean;
}

export interface ScheduleDraftHeader {
  reasonCode: string | null;
  responsibleParty: ScheduleParty | null;
  summary: string;
  attachments: ScheduleAttachment[];
  isContractExtension: boolean;
}

export type LineMeta = Record<string, { reasonCode?: string | null; responsibleParty?: ScheduleParty | null; note?: string | null }>;

const ERROR_MESSAGES: Record<string, string> = {
  SCHEDULE_CHANGE_REQUIRED: 'Ngày, khối lượng và thêm / xóa việc chỉ đổi qua "Điều chỉnh tiến độ" và cần duyệt.',
  SCHEDULE_VERSION_AUTOMATIC: 'Phiên bản được lưu tự động mỗi lần duyệt điều chỉnh, không cần chốt tay.',
  SCHEDULE_CONTROL_DISABLED: 'Dự án này chưa bật điều chỉnh tiến độ có duyệt.',
  SCHEDULE_CHANGE_ALREADY_OPEN: 'Đang có một phiếu điều chỉnh mở. Tải lại để xem.',
  SCHEDULE_CHANGE_NOT_FOUND: 'Không tìm thấy phiếu điều chỉnh.',
  SCHEDULE_NOT_CREATOR: 'Chỉ người lập phiếu được sửa hoặc gửi.',
  SCHEDULE_CHANGE_NOT_EDITABLE: 'Phiếu không còn ở trạng thái sửa được.',
  SCHEDULE_CHANGE_NOT_PENDING: 'Phiếu không còn chờ duyệt.',
  SCHEDULE_STALE_VERSION: 'Phiếu vừa được người khác cập nhật. Tải lại để xem bản mới.',
  SCHEDULE_INVALID_PAYLOAD: 'Dữ liệu phiếu không hợp lệ.',
  SCHEDULE_INVALID_LINE: 'Có dòng không hợp lệ: kiểm tra ngày bắt đầu, kết thúc và khối lượng.',
  SCHEDULE_NO_CHANGES: 'Bản nháp chưa có thay đổi ngày, khối lượng hay việc thêm / xóa.',
  SCHEDULE_REASON_REQUIRED: 'Chọn lý do chính và bên chịu trách nhiệm.',
  SCHEDULE_SUMMARY_REQUIRED: 'Ghi diễn giải ít nhất 10 ký tự.',
  SCHEDULE_DOCUMENT_REQUIRED: 'Cần đính kèm chứng từ (bên CĐT, lý do cần văn bản hoặc gia hạn hợp đồng).',
  SCHEDULE_EXTENSION_INVALID: 'Gia hạn hợp đồng cần bên chịu trách nhiệm là CĐT và ngày về đích mới sau hạn hợp đồng.',
  SCHEDULE_NO_APPROVER: 'Dự án chưa có người giữ quyền "Duyệt điều chỉnh". Nhờ Admin gán trong Phân quyền dự án.',
  SCHEDULE_SELF_APPROVAL: 'Người lập không duyệt phiếu của chính mình.',
  SCHEDULE_RETURN_REASON_REQUIRED: 'Ghi lý do trả lại.',
  SCHEDULE_CHANGE_STALE: 'Bảng tiến độ đã đổi sau khi lập phiếu ở việc',
  SCHEDULE_BACKDATE: 'Không sửa lùi: việc đã làm giữ ngày bắt đầu, việc đã xong không đổi ngày, ngày kết thúc mới không trước hôm nay. Việc',
  SCHEDULE_DELETE_BLOCKED: 'Không xóa được việc đã có số liệu (nhật ký, KH tuần, nghiệm thu…) hoặc còn việc con chưa xóa:',
  GANTT_HIERARCHY_INVALID: 'Việc cha của việc thêm mới không còn trong bảng tiến độ:',
  GANTT_DUPLICATE_WBS: 'Mã WBS bị trùng:',
  GANTT_PERMISSION_DENIED: 'Bạn không có quyền thực hiện thao tác này ở Tiến độ.',
};

export class ScheduleChangeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ScheduleChangeError'; this.code = code; }
}

export const mapScheduleError = (error: unknown): ScheduleChangeError => {
  const value = error as { message?: string; details?: string; hint?: string } | null;
  const text = [value?.message, value?.details, value?.hint].filter(Boolean).join(' ');
  const code = Object.keys(ERROR_MESSAGES).find(key => text.includes(key));
  if (!code) return new ScheduleChangeError('UNKNOWN', 'Không lưu được điều chỉnh tiến độ. Thử lại sau ít phút.');
  const detail = value?.details && !value.details.includes(code) ? ` ${value.details}.` : '';
  return new ScheduleChangeError(code, ERROR_MESSAGES[code] + detail);
};

export const isScheduleLockedError = (error: unknown) => {
  const text = [(error as { message?: string })?.message, (error as { details?: string })?.details].filter(Boolean).join(' ');
  return text.includes('SCHEDULE_CHANGE_REQUIRED') || text.includes('SCHEDULE_VERSION_AUTOMATIC');
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw mapScheduleError(error);
  return data as T;
};

export const SCHEDULE_CHANGE_BUCKET = 'schedule-change-attachments';

export const scheduleChangeService = {
  getControl(scope: { projectId: string; constructionSiteId?: string | null }) {
    return call<ScheduleControl>('get_project_schedule_control_v1', {
      p_project_id: scope.projectId, p_construction_site_id: scope.constructionSiteId || '',
    });
  },
  saveDraft(input: { projectId: string; constructionSiteId?: string | null; changeId: string | null; rowVersion: number | null;
    header: ScheduleDraftHeader; lines: ScheduleDraftLineInput[] }) {
    return call<ScheduleChange>('save_project_schedule_change_v1', {
      p_project_id: input.projectId, p_construction_site_id: input.constructionSiteId || '', p_change_id: input.changeId,
      p_expected_row_version: input.rowVersion, p_header: input.header, p_lines: input.lines,
    });
  },
  submit(changeId: string, rowVersion: number) {
    return call<ScheduleChange>('submit_project_schedule_change_v1', { p_change_id: changeId, p_expected_row_version: rowVersion });
  },
  withdraw(changeId: string, rowVersion: number, cancel: boolean) {
    return call<ScheduleChange>('withdraw_project_schedule_change_v1', { p_change_id: changeId, p_expected_row_version: rowVersion, p_cancel: cancel });
  },
  decide(changeId: string, rowVersion: number, decision: 'approve' | 'return', reason?: string) {
    return call<ScheduleChange>('decide_project_schedule_change_v1', {
      p_change_id: changeId, p_expected_row_version: rowVersion, p_decision: decision, p_reason: reason || null,
    });
  },
  async listReasons(): Promise<ScheduleReason[]> {
    const { data, error } = await supabase.from('project_plan_change_reasons')
      .select('code,label,default_party,needs_document,sort_order').eq('is_active', true).order('sort_order').limit(100);
    if (error) throw mapScheduleError(error);
    return (data || []).map(r => ({ code: r.code, label: r.label, defaultParty: toScheduleParty(r.default_party), needsDocument: !!r.needs_document }));
  },
  async uploadAttachments(input: { projectId: string; constructionSiteId?: string | null; files: File[] }): Promise<ScheduleAttachment[]> {
    const out: ScheduleAttachment[] = [];
    for (const file of input.files) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`Tệp ${file.name} vượt quá 25 MB.`);
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const safe = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${input.projectId}/${input.constructionSiteId || '-'}/${id}-${safe}`;
      const { error } = await supabase.storage.from(SCHEDULE_CHANGE_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw new Error(`Không tải được ${file.name}: ${error.message}`);
      out.push({ name: file.name, path, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
    }
    return out;
  },
  async openAttachment(path: string) {
    const target = window.open('about:blank', '_blank');
    const { data, error } = await supabase.storage.from(SCHEDULE_CHANGE_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) { target?.close(); throw new Error('Không mở được tệp.'); }
    if (target) { target.opener = null; target.location.href = data.signedUrl; } else window.location.assign(data.signedUrl);
  },
};

// ---------------------------------------------------------------------------- tính toán thuần (có test)
const dayMs = 86_400_000;
export const daysDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / dayMs);
const qtyOf = (task: ProjectTask) => Number(task.provisionalQuantity || 0);

export const scheduleFinish = (tasks: Pick<ProjectTask, 'endDate'>[]): string | null =>
  tasks.reduce<string | null>((max, task) => (task.endDate && (!max || task.endDate > max) ? task.endDate : max), null);

/** Cập nhật ngày việc cha theo việc con (chỉ nhánh có việc đổi). */
export const rollupAncestors = (tasks: ProjectTask[], changedIds: Iterable<string>): ProjectTask[] => {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const children = new Map<string, ProjectTask[]>();
  for (const task of tasks) if (task.parentId) children.set(task.parentId, [...(children.get(task.parentId) || []), task]);
  const parents = new Set<string>();
  for (const id of changedIds) {
    let parentId = byId.get(id)?.parentId;
    while (parentId && !parents.has(parentId)) { parents.add(parentId); parentId = byId.get(parentId)?.parentId; }
  }
  if (parents.size === 0) return tasks;
  const next = new Map(byId);
  const depth = (id: string) => { let d = 0; let p = byId.get(id)?.parentId; while (p) { d += 1; p = byId.get(p)?.parentId; } return d; };
  for (const parentId of [...parents].sort((a, b) => depth(b) - depth(a))) {
    const kids = (children.get(parentId) || []).map(kid => next.get(kid.id)!).filter(Boolean);
    const parent = next.get(parentId);
    if (!parent || kids.length === 0) continue;
    const startDate = kids.reduce((min, kid) => (kid.startDate < min ? kid.startDate : min), kids[0].startDate);
    const endDate = kids.reduce((max, kid) => (kid.endDate > max ? kid.endDate : max), kids[0].endDate);
    if (startDate !== parent.startDate || endDate !== parent.endDate) {
      next.set(parentId, { ...parent, startDate, endDate, duration: daysDiff(startDate, endDate) });
    }
  }
  return tasks.map(task => next.get(task.id) || task);
};

/** Khác biệt giữa bảng đang áp dụng và bản nháp → dòng phiếu (chỉ ngày, khối lượng, thêm, xóa). */
export const buildDraftLines = (current: ProjectTask[], draft: ProjectTask[], meta: LineMeta = {}): ScheduleDraftLineInput[] => {
  const before = new Map(current.map(task => [task.id, task]));
  const after = new Map(draft.map(task => [task.id, task]));
  const lines: ScheduleDraftLineInput[] = [];
  const extra = (id: string) => ({ reasonCode: meta[id]?.reasonCode ?? null, responsibleParty: meta[id]?.responsibleParty ?? null, note: meta[id]?.note ?? null });
  for (const task of draft) {
    const old = before.get(task.id);
    if (!old) {
      lines.push({ taskId: task.id, action: 'add', afterStart: task.startDate, afterEnd: task.endDate, afterQty: qtyOf(task),
        name: task.name, parentId: task.parentId || null, wbsCode: task.wbsCode || null, unit: task.fallbackUnit || null,
        assignee: task.assignee || null, assigneeUserId: task.assigneeUserId || null, sortOrder: task.order ?? 0,
        isMilestone: !!task.isMilestone, ...extra(task.id) });
    } else if (old.startDate !== task.startDate || old.endDate !== task.endDate || qtyOf(old) !== qtyOf(task)) {
      lines.push({ taskId: task.id, action: 'update', afterStart: task.startDate, afterEnd: task.endDate, afterQty: qtyOf(task), ...extra(task.id) });
    }
  }
  for (const task of current) if (!after.has(task.id)) lines.push({ taskId: task.id, action: 'delete', ...extra(task.id) });
  return lines;
};

/** Dựng lại bản nháp từ dòng phiếu đã lưu (mở lại nháp). */
export const applyLinesToTasks = (current: ProjectTask[], lines: ScheduleChangeLine[], scope: { projectId: string; constructionSiteId?: string | null }): ProjectTask[] => {
  const byTask = new Map(lines.map(line => [line.taskId, line]));
  const kept = current.filter(task => byTask.get(task.id)?.action !== 'delete').map(task => {
    const line = byTask.get(task.id);
    if (!line || line.action !== 'update' || !line.afterStart || !line.afterEnd) return task;
    return { ...task, startDate: line.afterStart, endDate: line.afterEnd, duration: daysDiff(line.afterStart, line.afterEnd),
      provisionalQuantity: line.afterQty ?? task.provisionalQuantity };
  });
  const added = lines.filter(line => line.action === 'add' && line.afterStart && line.afterEnd).map((line): ProjectTask => ({
    id: line.taskId, projectId: scope.projectId, constructionSiteId: scope.constructionSiteId || null,
    parentId: line.parentId || undefined, name: line.taskName, startDate: line.afterStart!, endDate: line.afterEnd!,
    duration: daysDiff(line.afterStart!, line.afterEnd!), progress: 0, progressMode: 'weekly_report',
    isMilestone: !!line.payload?.isMilestone, order: line.payload?.sortOrder ?? 0, wbsCode: line.wbsCode || undefined,
    fallbackUnit: line.payload?.unit, provisionalQuantity: line.afterQty ?? 0, assignee: line.payload?.assignee,
    assigneeUserId: line.payload?.assigneeUserId, rowVersion: 0,
  } as ProjectTask));
  return [...kept, ...added];
};

export interface ScheduleDiffRow {
  taskId: string; action: ScheduleLineAction; wbsCode: string | null; name: string; parentId: string | null; isLeaf: boolean;
  beforeStart: string | null; beforeEnd: string | null; beforeQty: number | null;
  afterStart: string | null; afterEnd: string | null; afterQty: number | null; deltaDays: number | null;
  unit: string | null; progress: number; setsFinish: boolean;
}

export interface ScheduleDiffSummary {
  rows: ScheduleDiffRow[];
  moved: number; added: number; deleted: number; qtyChanged: number;
  finishBefore: string | null; finishAfter: string | null; finishDelta: number;
}

/** Bảng thay đổi để hiển thị (việc cha tự cập nhật theo con không tính là một thay đổi riêng). */
export const summarizeDraft = (current: ProjectTask[], draft: ProjectTask[]): ScheduleDiffSummary => {
  const before = new Map(current.map(task => [task.id, task]));
  const parentIds = new Set(draft.map(task => task.parentId).filter(Boolean) as string[]);
  const finishBefore = scheduleFinish(current);
  const finishAfter = scheduleFinish(draft);
  const rows: ScheduleDiffRow[] = [];
  for (const line of buildDraftLines(current, draft)) {
    const old = before.get(line.taskId);
    const now = draft.find(task => task.id === line.taskId);
    const task = now || old!;
    const isLeaf = !parentIds.has(line.taskId) && !current.some(item => item.parentId === line.taskId);
    rows.push({
      taskId: line.taskId, action: line.action, wbsCode: task.wbsCode || null, name: task.name, parentId: task.parentId || null, isLeaf,
      beforeStart: old?.startDate || null, beforeEnd: old?.endDate || null, beforeQty: old ? qtyOf(old) : null,
      afterStart: line.action === 'delete' ? null : now?.startDate || null, afterEnd: line.action === 'delete' ? null : now?.endDate || null,
      afterQty: line.action === 'delete' || !now ? null : qtyOf(now),
      deltaDays: line.action === 'update' && old && now ? daysDiff(old.endDate, now.endDate) : null,
      unit: task.fallbackUnit || task.unit || null, progress: task.progress || 0,
      setsFinish: !!finishAfter && finishAfter !== finishBefore && now?.endDate === finishAfter && line.action !== 'delete',
    });
  }
  const leafRows = rows.filter(row => row.isLeaf);
  return {
    rows,
    moved: leafRows.filter(row => row.action === 'update' && (row.beforeStart !== row.afterStart || row.beforeEnd !== row.afterEnd)).length,
    added: leafRows.filter(row => row.action === 'add').length,
    deleted: rows.filter(row => row.action === 'delete').length,
    qtyChanged: leafRows.filter(row => row.action === 'update' && row.beforeQty !== row.afterQty).length,
    finishBefore, finishAfter,
    finishDelta: finishBefore && finishAfter ? daysDiff(finishBefore, finishAfter) : 0,
  };
};
