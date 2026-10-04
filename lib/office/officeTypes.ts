import type { WorkTextDocument } from "../work/workTypes";
export type OfficeGroup = "ANNOUNCEMENT" | "INCOMING" | "OUTGOING" | "INTERNAL";
export type OfficeStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "RETURNED"
  | "REJECTED"
  | "APPROVED"
  | "WAITING_NUMBER"
  | "ISSUED"
  | "REVOKED"
  | "ARCHIVED";
export type ProcessingStatus =
  | "RECEIVED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED";
export type OfficeView =
  | "all"
  | "approval"
  | "numbering"
  | "assigned"
  | "created"
  | "unread"
  | "overdue"
  | "following"
  | "favorites"
  | "archive";
export type AudienceKind =
  | "company"
  | "user"
  | "department"
  | "factory"
  | "project"
  | "site"
  | "role";
export interface RecipientSpec {
  type: AudienceKind;
  id?: string;
  label?: string;
}
export interface OfficeOption {
  id: string;
  name: string;
  kind: string;
}
export interface OfficeType {
  id: string;
  code: string;
  name: string;
  groups: OfficeGroup[];
  requires_approval: boolean;
  requires_number: boolean;
  numbering_rule_id: string | null;
  workflow_id: string | null;
  archive_folder_id: string | null;
  is_active: boolean;
}
export interface OfficeRule {
  id: string;
  name: string;
  format: string;
  is_active: boolean;
}
export interface OfficeFolder {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}
export interface OfficeWorkflow {
  id: string;
  name: string;
  steps: { userId: string; label: string }[];
  department_id: string | null;
  project_id: string | null;
  version: number;
  is_active: boolean;
  stepNames?: Record<string, string>;
}
export interface OfficeCatalog {
  types: OfficeType[];
  rules: OfficeRule[];
  folders: OfficeFolder[];
  workflows: OfficeWorkflow[];
  canConfigure: boolean;
  canCreate: boolean;
  actorId: string;
}
export interface OfficeDraft {
  document_group: OfficeGroup;
  document_type_id: string;
  title: string;
  summary: string;
  content: WorkTextDocument;
  document_date: string;
  received_date: string | null;
  due_date: string | null;
  issuer_department_id: string | null;
  signer_user_id: string | null;
  signer_position: string | null;
  project_id: string | null;
  construction_site_id: string | null;
  source_organization: string | null;
  source_document_number: string | null;
  source_sender: string | null;
  external_recipient: string | null;
  urgency: "NORMAL" | "URGENT" | "VERY_URGENT";
  confidentiality: "NORMAL" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
  archive_folder_id: string | null;
  workflow_id: string | null;
  recipient_specs: RecipientSpec[];
  watcher_ids: string[];
}
export interface OfficeDocument extends OfficeDraft {
  id: string;
  status: OfficeStatus;
  processing_status: ProcessingStatus | null;
  document_number: string | null;
  version: number;
  creator_name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  revoked_at: string | null;
  numbered_at: string | null;
  approved_at: string | null;
  approval_round: number;
  assigned_to: string | null;
  collaborator_ids: string[];
  processing_instruction: string | null;
  processing_result: string | null;
  received_ack_at: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
}
export interface OfficeSummary {
  source_document_number: string | null;
  id: string;
  title: string;
  document_number: string | null;
  document_group: OfficeGroup;
  status: OfficeStatus;
  processing_status: ProcessingStatus | null;
  document_date: string;
  issued_at: string | null;
  revoked_at: string | null;
  created_at: string;
  urgency: OfficeDraft["urgency"];
  confidentiality: OfficeDraft["confidentiality"];
  due_date: string | null;
  creator_name: string;
  type_name: string;
  signer_name: string | null;
  department_name: string | null;
  project_name: string | null;
  is_recipient: boolean;
  read_at: string | null;
}
export interface OfficeAttachment {
  id: string;
  document_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  bucket: string;
  path: string;
  status: "PENDING" | "READY";
  created_at: string;
}
export interface OfficeApproval {
  id: string;
  round: number;
  step: number;
  label: string;
  name: string;
  user_id: string;
  status:
    | "WAITING"
    | "PENDING"
    | "APPROVED"
    | "RETURNED"
    | "REJECTED"
    | "CANCELLED";
  acted_at: string | null;
  comment: string | null;
}
export type OfficeCapability =
  | "edit"
  | "submit"
  | "approve"
  | "issue_number"
  | "publish"
  | "revoke"
  | "archive"
  | "assign"
  | "process"
  | "track"
  | "read";
export interface OfficeDetail {
  document: OfficeDocument;
  capabilities: Record<OfficeCapability, boolean>;
  attachments: OfficeAttachment[];
  approvals: OfficeApproval[];
  typeName: string;
  departmentName: string | null;
  projectName: string | null;
  signerName: string | null;
  assigneeName: string | null;
  recipientStats: { total: number; read: number; unread: number } | null;
  bookmark: { favorite: boolean; following: boolean };
}
export interface OfficeFilters {
  view?: OfficeView;
  group?: OfficeGroup | "";
  status?: OfficeStatus | "";
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: "newest" | "oldest" | "title";
  typeId?: string;
  departmentId?: string;
  projectId?: string;
  siteId?: string;
  folderId?: string;
  creatorId?: string;
  signerId?: string;
  urgency?: string;
  confidentiality?: string;
  from?: string;
  to?: string;
}
export interface OfficeDashboard {
  new: number;
  unread: number;
  approval: number;
  numbering: number;
  assigned: number;
  overdue: number;
  issuedThisMonth: number;
}
export interface OfficeRecipient {
  user_id: string;
  name: string;
  delivered_at: string;
  read_at: string | null;
}
export interface OfficeActivity {
  id: string;
  user_name: string;
  description: string;
  context: {
    comment?: string;
    number?: string;
    version: number;
    status: OfficeStatus;
  };
  created_at: string;
}
export type OfficeCommand =
  | "create"
  | "save"
  | "submit"
  | "approve"
  | "return"
  | "reject"
  | "issue_number"
  | "publish"
  | "revoke"
  | "archive"
  | "assign"
  | "acknowledge"
  | "start"
  | "complete"
  | "read"
  | "bookmark"
  | "attachment_begin"
  | "attachment_finish"
  | "attachment_remove";
export interface OfficeCommandInput {
  command: OfficeCommand;
  documentId?: string | null;
  expectedVersion?: number | null;
  payload?: object;
  key: string;
}
export interface OfficeCommandResult {
  id: string;
  version: number;
  status: OfficeStatus;
  attachment?: OfficeAttachment;
}
export interface OfficePage<T> {
  items: T[];
  total: number;
}
