import type {
  RequestApproverSource,
  RequestCompletionPolicy,
  RequestFieldType,
  RequestFlowMode,
} from '../types';
import type { SaveRequestTemplateDraftInput } from './requestTemplateService';

export type RequestScopeKind = 'COMPANY' | 'ORG_UNIT' | 'PERMISSION_GROUP' | 'USER';

export interface RequestTemplateFieldDraft {
  key: string;
  label: string;
  fieldType: RequestFieldType;
  required: boolean;
  options: string[];
  sortOrder: number;
}

export interface RequestApproverBlockDraft {
  key: string;
  name: string;
  source: RequestApproverSource;
  fixedUserIds: string[];
  minimumDynamicApprovers: number | null;
  slaHours: number | null;
  sortOrder: number;
}

export interface RequestTemplateDraft {
  id?: string;
  name: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
  requestSlaHours: number | null;
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  fields: RequestTemplateFieldDraft[];
  approverBlocks: RequestApproverBlockDraft[];
  scopes: Array<{ kind: RequestScopeKind; targetId: string | null }>;
  fixedWatcherIds: string[];
  print: { browserPrintEnabled: boolean; docxStoragePath: string | null };
  notificationEvents: Array<'SUBMITTED' | 'ASSIGNED' | 'REASSIGNED' | 'REMINDER' | 'RETURNED' | 'APPROVED' | 'REJECTED'>;
}

export type RequestTemplateDraftAction =
  | { type: 'REPLACE_DRAFT'; draft: RequestTemplateDraft }
  | { type: 'PATCH_GENERAL'; patch: Pick<Partial<RequestTemplateDraft>, 'name' | 'description' | 'requestSlaHours'> }
  | { type: 'SET_FLOW'; flowMode: RequestFlowMode; completionPolicy: RequestCompletionPolicy }
  | { type: 'UPSERT_FIELD'; field: RequestTemplateFieldDraft }
  | { type: 'REMOVE_FIELD'; key: string }
  | { type: 'REORDER_FIELDS'; orderedKeys: string[] }
  | { type: 'UPSERT_APPROVER_BLOCK'; block: RequestApproverBlockDraft }
  | { type: 'REMOVE_APPROVER_BLOCK'; key: string }
  | { type: 'REORDER_APPROVER_BLOCKS'; orderedKeys: string[] }
  | { type: 'SET_SCOPES'; scopes: RequestTemplateDraft['scopes'] }
  | { type: 'SET_WATCHERS'; userIds: string[] }
  | { type: 'SET_PRINT'; print: RequestTemplateDraft['print'] }
  | { type: 'SET_NOTIFICATIONS'; events: RequestTemplateDraft['notificationEvents'] };

export interface RequestTemplateValidationIssue {
  section: 'GENERAL' | 'FORM' | 'APPROVAL' | 'SCOPE' | 'PRINT';
  code: string;
  message: string;
}

export const createEmptyRequestTemplateDraft = (): RequestTemplateDraft => ({
  name: '', description: '', status: 'DRAFT', requestSlaHours: null,
  flowMode: 'SEQUENTIAL', completionPolicy: 'ALL', fields: [], approverBlocks: [],
  scopes: [], fixedWatcherIds: [],
  print: { browserPrintEnabled: true, docxStoragePath: null },
  notificationEvents: ['SUBMITTED', 'ASSIGNED', 'RETURNED', 'APPROVED', 'REJECTED'],
});

export const createFieldKey = (label: string, existing: string[]): string => {
  const base = label.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'field';
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
};

export const createApproverBlock = (
  source: RequestApproverSource,
  sortOrder: number,
): RequestApproverBlockDraft => ({
  key: crypto.randomUUID(),
  name: source === 'DIRECT_MANAGER' ? 'Quản lý trực tiếp'
    : source === 'DYNAMIC_CREATOR_SELECT' ? 'Người duyệt được chọn khi gửi'
      : 'Khối người duyệt',
  source,
  fixedUserIds: [],
  minimumDynamicApprovers: source === 'DYNAMIC_CREATOR_SELECT' ? 1 : null,
  slaHours: null,
  sortOrder,
});

export const changeApproverBlockSource = (
  block: RequestApproverBlockDraft,
  source: RequestApproverSource,
): RequestApproverBlockDraft => {
  if (source === 'DIRECT_MANAGER') {
    return { ...block, source, fixedUserIds: [], minimumDynamicApprovers: null };
  }
  if (source === 'DYNAMIC_CREATOR_SELECT') {
    return {
      ...block,
      source,
      fixedUserIds: [],
      minimumDynamicApprovers: Number.isInteger(block.minimumDynamicApprovers)
        && (block.minimumDynamicApprovers ?? 0) > 0
        ? block.minimumDynamicApprovers
        : 1,
    };
  }
  return {
    ...block,
    source,
    fixedUserIds: source === 'FIXED_SINGLE' ? block.fixedUserIds.slice(0, 1) : block.fixedUserIds,
    minimumDynamicApprovers: null,
  };
};

export const reorderByKeys = <T extends { key: string; sortOrder: number }>(items: T[], orderedKeys: string[]): T[] => {
  const byKey = new Map(items.map(item => [item.key, item]));
  if (orderedKeys.length !== items.length || orderedKeys.some(key => !byKey.has(key))) return items;
  return orderedKeys.map((key, index) => ({ ...byKey.get(key)!, sortOrder: index + 1 }));
};

const upsert = <T extends { key: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex(existing => existing.key === item.key);
  return index < 0 ? [...items, item] : items.map(existing => existing.key === item.key ? item : existing);
};

export const requestTemplateDraftReducer = (draft: RequestTemplateDraft, action: RequestTemplateDraftAction): RequestTemplateDraft => {
  switch (action.type) {
    case 'REPLACE_DRAFT': return action.draft;
    case 'PATCH_GENERAL': return { ...draft, ...action.patch };
    case 'SET_FLOW': return { ...draft, flowMode: action.flowMode, completionPolicy: action.completionPolicy };
    case 'UPSERT_FIELD': return { ...draft, fields: upsert(draft.fields, action.field) };
    case 'REMOVE_FIELD': return { ...draft, fields: draft.fields.filter(field => field.key !== action.key) };
    case 'REORDER_FIELDS': return { ...draft, fields: reorderByKeys(draft.fields, action.orderedKeys) };
    case 'UPSERT_APPROVER_BLOCK': return { ...draft, approverBlocks: upsert(draft.approverBlocks, { ...action.block, fixedUserIds: [...new Set(action.block.fixedUserIds)] }) };
    case 'REMOVE_APPROVER_BLOCK': return { ...draft, approverBlocks: draft.approverBlocks.filter(block => block.key !== action.key) };
    case 'REORDER_APPROVER_BLOCKS': return { ...draft, approverBlocks: reorderByKeys(draft.approverBlocks, action.orderedKeys) };
    case 'SET_SCOPES': return { ...draft, scopes: action.scopes };
    case 'SET_WATCHERS': return { ...draft, fixedWatcherIds: action.userIds };
    case 'SET_PRINT': return { ...draft, print: action.print };
    case 'SET_NOTIFICATIONS': return { ...draft, notificationEvents: action.events };
  }
};

const validSla = (value: number | null) => value === null || (Number.isInteger(value) && value >= 1 && value <= 8760);

export const validateRequestTemplateForSave = (draft: RequestTemplateDraft): RequestTemplateValidationIssue[] => {
  const issues: RequestTemplateValidationIssue[] = [];

  if (!draft.name.trim()) {
    issues.push({ section: 'GENERAL', code: 'NAME_REQUIRED', message: 'Tên mẫu yêu cầu là bắt buộc.' });
  }
  if (!draft.approverBlocks.length) {
    issues.push({ section: 'APPROVAL', code: 'APPROVER_REQUIRED', message: 'Mẫu cần ít nhất một khối người duyệt.' });
  }
  for (const block of draft.approverBlocks) {
    if (
      (block.source === 'FIXED_SINGLE' || block.source === 'FIXED_MULTI')
      && block.fixedUserIds.length === 0
    ) {
      issues.push({
        section: 'APPROVAL',
        code: 'FIXED_APPROVER_REQUIRED',
        message: `Khối “${block.name || 'Người duyệt cố định'}” cần chọn ít nhất một người duyệt.`,
      });
    }
  }

  return issues;
};

export const validateRequestTemplateForPublish = (draft: RequestTemplateDraft): RequestTemplateValidationIssue[] => {
  const issues: RequestTemplateValidationIssue[] = [];
  if (!draft.name.trim()) issues.push({ section: 'GENERAL', code: 'NAME_REQUIRED', message: 'Tên mẫu yêu cầu là bắt buộc.' });
  if (!validSla(draft.requestSlaHours)) issues.push({ section: 'GENERAL', code: 'REQUEST_SLA_INVALID', message: 'SLA đề xuất phải từ 1 đến 8760 giờ.' });
  if (!draft.fields.length) issues.push({ section: 'FORM', code: 'FORM_FIELD_REQUIRED', message: 'Mẫu cần ít nhất một trường dữ liệu.' });
  if (new Set(draft.fields.map(field => field.key.trim())).size !== draft.fields.length || draft.fields.some(field => !field.key.trim())) issues.push({ section: 'FORM', code: 'FIELD_KEY_INVALID', message: 'Mã trường dữ liệu phải duy nhất và không được rỗng.' });
  if (draft.fields.some(field => field.fieldType === 'select' && !field.options.some(option => option.trim()))) issues.push({ section: 'FORM', code: 'SELECT_OPTION_REQUIRED', message: 'Trường danh sách chọn cần ít nhất một lựa chọn.' });
  if (draft.fields.some(field => field.fieldType === 'table' && !field.options.some(option => option.trim()))) issues.push({ section: 'FORM', code: 'TABLE_COLUMN_REQUIRED', message: 'Trường dữ liệu dạng bảng cần ít nhất một cột.' });
  if (!draft.scopes.length || draft.scopes.some(scope => scope.kind === 'COMPANY' ? scope.targetId !== null : !scope.targetId)) issues.push({ section: 'SCOPE', code: 'SCOPE_INVALID', message: 'Phạm vi sử dụng mẫu chưa hợp lệ.' });
  if (!draft.approverBlocks.length) issues.push({ section: 'APPROVAL', code: 'APPROVER_REQUIRED', message: 'Mẫu cần ít nhất một khối người duyệt.' });
  for (const block of draft.approverBlocks) {
    if (!validSla(block.slaHours)) issues.push({ section: 'APPROVAL', code: 'BLOCK_SLA_INVALID', message: 'SLA khối duyệt phải từ 1 đến 8760 giờ.' });
    if (block.source === 'FIXED_SINGLE' && block.fixedUserIds.length !== 1) issues.push({ section: 'APPROVAL', code: 'FIXED_SINGLE_REQUIRED', message: 'Khối duyệt cố định cần đúng một người duyệt.' });
    if (block.source === 'FIXED_MULTI' && block.fixedUserIds.length < 2) issues.push({ section: 'APPROVAL', code: 'FIXED_MULTI_REQUIRED', message: 'Khối duyệt nhiều người cần ít nhất hai người duyệt.' });
    if (block.source === 'DIRECT_MANAGER' && block.fixedUserIds.length) issues.push({ section: 'APPROVAL', code: 'DIRECT_MANAGER_FIXED_USERS', message: 'Quản lý trực tiếp không nhận người duyệt cố định.' });
    if (block.source === 'DYNAMIC_CREATOR_SELECT' && (!Number.isInteger(block.minimumDynamicApprovers) || (block.minimumDynamicApprovers ?? 0) < 1)) issues.push({ section: 'APPROVAL', code: 'DYNAMIC_MINIMUM_REQUIRED', message: 'Khối người duyệt linh động cần số người duyệt tối thiểu từ 1.' });
    if (block.source !== 'DYNAMIC_CREATOR_SELECT' && block.minimumDynamicApprovers !== null) issues.push({ section: 'APPROVAL', code: 'DYNAMIC_MINIMUM_UNEXPECTED', message: 'Chỉ khối người duyệt linh động mới có số người duyệt tối thiểu.' });
  }
  if (draft.print.docxStoragePath !== null && !draft.print.docxStoragePath.trim()) issues.push({ section: 'PRINT', code: 'DOCX_PATH_INVALID', message: 'Đường dẫn mẫu DOCX không được rỗng.' });
  return issues;
};

export const toSaveDraftInput = (draft: RequestTemplateDraft, expectedUpdatedAt?: string): SaveRequestTemplateDraftInput => ({
  templateId: draft.id, expectedUpdatedAt, name: draft.name.trim(), description: draft.description.trim(),
  formSchema: draft.fields.map(field => ({ ...field, label: field.label.trim(), options: (field.fieldType === 'select' || field.fieldType === 'table') ? field.options.map(option => option.trim()).filter(Boolean) : [] })),
  usageScope: {
    companyWide: draft.scopes.some(scope => scope.kind === 'COMPANY'),
    orgUnitIds: draft.scopes.filter(scope => scope.kind === 'ORG_UNIT').map(scope => scope.targetId!).filter(Boolean),
    permissionCodes: draft.scopes.filter(scope => scope.kind === 'PERMISSION_GROUP').map(scope => scope.targetId!).filter(Boolean),
    userIds: draft.scopes.filter(scope => scope.kind === 'USER').map(scope => scope.targetId!).filter(Boolean),
  },
  flowMode: draft.flowMode, completionPolicy: draft.completionPolicy, requestSlaHours: draft.requestSlaHours,
  blocks: draft.approverBlocks, watcherUserIds: draft.fixedWatcherIds, printConfig: draft.print,
  notificationConfig: Object.fromEntries(draft.notificationEvents.map(event => [event, true])),
});

export const buildRequestTemplateSaveInput = (
  draft: RequestTemplateDraft,
  updatedAt: string | null,
): SaveRequestTemplateDraftInput => {
  if (draft.id && !updatedAt) {
    throw new Error('REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED');
  }

  return toSaveDraftInput(
    draft,
    draft.id ? updatedAt : undefined,
  );
};

export const shouldScheduleRequestTemplateAutosave = ({
  hasTemplateId,
  isDirty,
  isBlocked,
  isStructurallySaveable,
  hasValidationIssues,
}: {
  hasTemplateId: boolean;
  isDirty: boolean;
  isBlocked: boolean;
  isStructurallySaveable: boolean;
  hasValidationIssues: boolean;
}): boolean => hasTemplateId
  && isDirty
  && !isBlocked
  && isStructurallySaveable
  && !hasValidationIssues;
