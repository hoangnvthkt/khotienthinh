// Gửi duyệt đề xuất vật tư DỰ ÁN — dùng chung cho form Đề xuất (RequestModal) và form gọn trong khung chat Trợ lý (chủ SP 18/10/2026).
// Đúng các bước form vẫn làm: workflow dự án phải hợp lệ → phiếu ghi trạng thái Nháp + nhật ký "đã gửi" → lưu (addRequest của app:
// bảng requests, ảnh chụp BOQ, sự kiện) → bắt đầu workflow V2 với người xử lý bước đầu đã chọn → đọc lại phiếu.
import { RequestStatus, type MaterialRequest, type ProjectSubmissionTarget } from '../types';
import { projectSubmissionService } from './projectSubmissionService';
import { projectWorkflowService } from './projectWorkflowService';
import { getMaterialRequestWorkflowPatch, materialRequestService } from './materialRequestService';

export class MaterialRequestNotSavedError extends Error {
  constructor() { super('Không lưu được phiếu đề xuất lên hệ thống. Vui lòng thử lại.'); this.name = 'MaterialRequestNotSavedError'; }
}

export interface MaterialRequestBinding { workflowTemplateId: string }

/** Workflow đề xuất vật tư của dự án (bắt buộc với đề xuất dự án). */
export const getMaterialRequestBinding = async (projectId?: string | null, constructionSiteId?: string | null): Promise<MaterialRequestBinding> => {
  const configuration = await projectWorkflowService.getConfiguration('material_request', projectId || null, constructionSiteId || null);
  if (!configuration?.valid || !configuration.binding) {
    throw new Error(configuration?.errors?.[0] || 'Dự án chưa cấu hình workflow đề xuất vật tư hợp lệ.');
  }
  return configuration.binding;
};

/** Phiếu nháp → bản ghi lúc gửi duyệt (workflow V2 giữ trạng thái Nháp, bước "draft"; người xử lý do workflow giao). */
export const toSubmittedProjectRequest = (draft: MaterialRequest, userId: string, note?: string | null, now = new Date().toISOString()): MaterialRequest => ({
  ...draft,
  status: RequestStatus.DRAFT,
  submittedToUserId: null,
  submittedToName: null,
  submittedToPermission: null,
  submissionNote: null,
  ...projectSubmissionService.actionMeta(userId, false),
  ...getMaterialRequestWorkflowPatch('draft', userId),
  logs: [
    ...(draft.logs || []),
    { action: 'SUBMITTED', userId, timestamp: now, note: note || undefined },
  ],
});

export const targetUserIds = (target: Pick<ProjectSubmissionTarget, 'userId' | 'userIds'>) =>
  target.userIds?.length ? target.userIds : target.userId ? [target.userId] : [];

/** Lưu phiếu rồi bắt đầu workflow với người xử lý bước đầu. addRequest = hàm lưu của app (AppContext). */
export const saveAndStartWorkflow = async (
  requestToSave: MaterialRequest,
  binding: MaterialRequestBinding,
  target: Pick<ProjectSubmissionTarget, 'userId' | 'userIds' | 'note'>,
  deps: { addRequest: (request: MaterialRequest) => Promise<boolean> },
): Promise<MaterialRequest> => {
  const saved = await deps.addRequest(requestToSave);
  if (!saved) throw new MaterialRequestNotSavedError();
  await projectWorkflowService.startMaterialRequestWorkflowV2({
    requestId: requestToSave.id,
    templateId: binding.workflowTemplateId,
    firstAssigneeUserIds: targetUserIds(target),
    comment: target.note || undefined,
  });
  return (await materialRequestService.getById(requestToSave.id)) || requestToSave;
};
