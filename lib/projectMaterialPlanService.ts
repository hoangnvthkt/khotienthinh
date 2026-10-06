import { supabase } from './supabase';
import type { WorkPlanPeriodType, WorkPlanStatus } from './projectWorkPlanService';

export interface MaterialPlanSource {
  taskId: string; wbsCode: string | null; taskName: string | null;
  plannedWorkQty: number; workTotalQty: number; workUnit: string | null; budgetQty: number; derivedQty: number;
}

export interface MaterialPlanLine {
  id: string;
  itemId: string;
  sku: string | null;
  itemName: string;
  unit: string;
  category: string | null;
  needQty: number;
  requestedQty: number;
  neededDate: string | null;
  overReason: string | null;
  note: string | null;
  /** Live position of the material in the project (null = unknown). */
  boqQty: number | null;
  issuedQty: number | null;
  stockQty: number | null;
  stockKnown: boolean;
  sources: MaterialPlanSource[];
}

export type MaterialPlanGapReason = 'no_planned_qty' | 'no_work_qty' | 'no_boq_material' | 'no_item_code';
export interface MaterialPlanGap { taskId: string; wbsCode: string | null; taskName: string; groupName: string | null; reason: MaterialPlanGapReason }

export interface MaterialPlan {
  id: string; workPlanId: string; projectId: string; constructionSiteId: string | null;
  periodType: WorkPlanPeriodType; periodStart: string; periodEnd: string; code: string;
  status: WorkPlanStatus; revisionNo: number; note: string | null; neededDate: string | null;
  destinationWarehouseId: string | null; destinationWarehouseName: string | null;
  rowVersion: number; createdAt: string; updatedAt: string; createdByName: string | null;
  submittedAt: string | null; submittedByName: string | null; approvedAt: string | null; approvedByName: string | null;
  returnedAt: string | null; returnedByName: string | null; returnReason: string | null;
  workPlanRevisionNo: number | null; workPlanStatus: WorkPlanStatus | null;
  createdBy: string | null; submittedBy: string | null;
  /** KH thi công của kỳ đã đổi bản sau khi lập KH vật tư này — cần tính lại. */
  needsReviewAt: string | null; needsReviewReason: string | null;
  lines: MaterialPlanLine[];
  gaps: MaterialPlanGap[];
}

export interface MaterialPlanBoard {
  periodType: WorkPlanPeriodType; periodStart: string; periodEnd: string;
  currentUserId: string | null;
  workPlan: { id: string; code: string; revisionNo: number; approvedAt: string; lineCount: number } | null;
  workPlanPending: boolean;
  approved: MaterialPlan | null;
  open: MaterialPlan | null;
  permissions: { canEdit: boolean; canSubmit: boolean; canDelete: boolean; canApprove: boolean };
  approvers: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string; isDefault: boolean }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  WORK_PLAN_VIEW_DENIED: 'Bạn chưa có quyền xem kế hoạch của dự án này.',
  MATERIAL_PLAN_EDIT_DENIED: 'Bạn chưa có quyền lập hoặc sửa kế hoạch vật tư.',
  MATERIAL_PLAN_SUBMIT_DENIED: 'Bạn chưa có quyền gửi duyệt kế hoạch vật tư.',
  MATERIAL_PLAN_APPROVE_DENIED: 'Chỉ CHT (quyền "Duyệt KH tuần") mới duyệt được kế hoạch vật tư.',
  MATERIAL_PLAN_DELETE_DENIED: 'Chỉ xóa được bản nháp chưa từng gửi duyệt.',
  MATERIAL_PLAN_WITHDRAW_DENIED: 'Chỉ người gửi mới rút được kế hoạch đang chờ duyệt.',
  MATERIAL_PLAN_WORK_PLAN_NOT_APPROVED: 'Kế hoạch thi công của kỳ phải được duyệt trước.',
  MATERIAL_PLAN_ALREADY_OPEN: 'Kỳ này đã có kế hoạch vật tư đang soạn hoặc chờ duyệt. Tải lại để mở.',
  MATERIAL_PLAN_ALREADY_APPROVED: 'Kỳ này đã có kế hoạch vật tư được duyệt. Dùng "Tạo bản điều chỉnh".',
  MATERIAL_PLAN_NOT_EDITABLE: 'Kế hoạch vật tư đã gửi hoặc đã duyệt nên không sửa trực tiếp được.',
  MATERIAL_PLAN_NOT_SUBMITTED: 'Kế hoạch vật tư không còn chờ duyệt. Tải lại để xem trạng thái mới.',
  MATERIAL_PLAN_NOT_APPROVED: 'Chỉ tạo bản điều chỉnh từ kế hoạch vật tư đã duyệt.',
  MATERIAL_PLAN_EMPTY: 'Chưa có vật tư nào có SL đề nghị lớn hơn 0.',
  MATERIAL_PLAN_QTY_INVALID: 'SL đề nghị phải là số ≥ 0.',
  MATERIAL_PLAN_LINE_INVALID: 'Có dòng vật tư không còn trong kế hoạch. Tải lại.',
  MATERIAL_PLAN_WAREHOUSE_INVALID: 'Kho nhận không thuộc dự án.',
  MATERIAL_PLAN_OVER_BOQ_REASON_REQUIRED: 'Có vật tư vượt BOQ chưa ghi lý do. Nhập lý do ở các dòng tô đỏ.',
  MATERIAL_PLAN_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại để người lập biết cần sửa gì.',
  MATERIAL_PLAN_REVISION_REASON_REQUIRED: 'Nhập lý do điều chỉnh.',
  MATERIAL_PLAN_APPROVER_INVALID: 'Người được chọn chưa có quyền duyệt kế hoạch vật tư, hoặc là người lập.',
  MATERIAL_PLAN_SELF_APPROVAL_DENIED: 'Người lập hoặc người gửi không tự duyệt / trả lại kế hoạch vật tư của mình.',
  MATERIAL_PLAN_NOT_FLAGGED: 'Kế hoạch vật tư không còn ở trạng thái cần tính lại. Tải lại.',
  MATERIAL_PLAN_KEEP_REASON_REQUIRED: 'Ghi lý do giữ nguyên kế hoạch vật tư.',
  ROW_VERSION_CONFLICT: 'Kế hoạch vừa được người khác cập nhật. Tải lại rồi thử lại.',
};

export const mapMaterialPlanError = (error: { message?: string; code?: string; details?: string } | null): Error => {
  const code = Object.keys(ERROR_MESSAGES).sort((a, b) => b.length - a.length).find(key => error?.message?.includes(key));
  const detail = code === 'MATERIAL_PLAN_OVER_BOQ_REASON_REQUIRED' && error?.details ? ` (${error.details})` : '';
  const mapped = new Error(code ? ERROR_MESSAGES[code] + detail : 'Không thực hiện được thao tác với kế hoạch vật tư. Thử lại sau.');
  (mapped as Error & { code?: string }).code = code || error?.code;
  return mapped;
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw mapMaterialPlanError(error);
  return data as T;
};

export const projectMaterialPlanService = {
  getBoard(input: { projectId: string; constructionSiteId: string | null; periodType: WorkPlanPeriodType; periodStart: string }) {
    return call<MaterialPlanBoard>('get_project_material_plan_board_v1', {
      p_project_id: input.projectId, p_construction_site_id: input.constructionSiteId,
      p_period_type: input.periodType, p_period_start: input.periodStart,
    });
  },
  create(workPlanId: string) {
    return call<{ planId: string; rowVersion: number; lines: number }>('create_project_material_plan_v1', { p_input: { workPlanId } });
  },
  save(input: { planId: string; expectedRowVersion: number; note: string; neededDate: string | null; destinationWarehouseId: string | null;
    lines: Array<{ id: string; requestedQty: number; neededDate: string | null; overReason: string | null; note: string | null }> }) {
    return call<{ planId: string; rowVersion: number }>('save_project_material_plan_v1', { p_input: input });
  },
  transition(input: { planId: string; expectedRowVersion: number; action: 'submit' | 'withdraw' | 'approve' | 'return' | 'delete' | 'keep'; reason?: string; recipientUserId?: string | null }) {
    return call<{ planId: string; rowVersion?: number; deleted?: boolean }>('transition_project_material_plan_v1', { p_input: input });
  },
  revise(input: { planId: string; reason: string }) {
    return call<{ planId: string; rowVersion: number }>('revise_project_material_plan_v1', { p_input: input });
  },
};

/** Share of the BOQ quantity issued plus requested; null when BOQ is unknown. */
export const materialBoqUsage = (line: Pick<MaterialPlanLine, 'boqQty' | 'issuedQty' | 'requestedQty'>, requested = line.requestedQty): number | null => {
  if (line.boqQty == null || line.boqQty <= 0 || line.issuedQty == null) return null;
  return ((line.issuedQty + requested) / line.boqQty) * 100;
};

/** Same rule as the server: over BOQ beyond a 3-decimal rounding tolerance. */
export const isOverBoq = (line: Pick<MaterialPlanLine, 'boqQty' | 'issuedQty' | 'requestedQty'>, requested = line.requestedQty): boolean =>
  line.boqQty != null && line.boqQty > 0 && (line.issuedQty ?? 0) + requested > line.boqQty * 1.0001 + 0.001;

export const MATERIAL_PLAN_GAP_LABELS: Record<MaterialPlanGapReason, string> = {
  no_planned_qty: 'Chưa nhập KL kế hoạch',
  no_work_qty: 'Công việc chưa có khối lượng',
  no_boq_material: 'Chưa khai vật tư BOQ cho công việc',
  no_item_code: 'Vật tư BOQ chưa có mã kho',
};
