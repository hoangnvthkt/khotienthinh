
export enum Role {
  ADMIN = 'ADMIN',
  WAREHOUSE_KEEPER = 'WAREHOUSE_KEEPER',
  EMPLOYEE = 'EMPLOYEE', // Nhân viên
}

export enum TransactionType {
  IMPORT = 'IMPORT', // Nhập kho
  EXPORT = 'EXPORT', // Xuất kho
  TRANSFER = 'TRANSFER', // Chuyển kho
  ADJUSTMENT = 'ADJUSTMENT', // Kiểm kê/Điều chỉnh
  LIQUIDATION = 'LIQUIDATION', // Xuất hủy
  LEGACY_IN = 'in',
  LEGACY_NHAP = 'nhap',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  LEGACY_PENDING = 'pending',
  LEGACY_COMPLETED = 'completed',
  LEGACY_CANCELLED = 'cancelled',
}

export enum RequestStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',       // Chờ duyệt
  APPROVED = 'APPROVED',     // Đã duyệt (Chờ xuất)
  REJECTED = 'REJECTED',     // Từ chối
  IN_TRANSIT = 'IN_TRANSIT', // Đã xuất kho (Đang vận chuyển)
  COMPLETED = 'COMPLETED',   // Đã nhận hàng
  LEGACY_PENDING = 'pending',
  LEGACY_APPROVED = 'approved',
}

export enum MaterialRequestFulfillmentMode {
  RECEIVE_TO_STOCK = 'RECEIVE_TO_STOCK',
  DIRECT_CONSUMPTION = 'DIRECT_CONSUMPTION',
}

export type MaterialRequestOrigin = 'wms' | 'project';

export type WarehouseType = 'GENERAL' | 'SITE' | 'OFFICE'; // Tổng | Công trường | Văn phòng

export interface User {
  id: string;
  authId?: string; // Supabase Auth user id
  name: string;
  email: string;
  username?: string; // Tên đăng nhập
  password?: string; // Mật khẩu
  phone?: string; // SĐT nhân viên
  role: Role;
  avatar?: string;
  assignedWarehouseId?: string; // ID kho được giao quản lý; WAREHOUSE_KEEPER không gán kho = phòng vật tư/toàn bộ kho
  allowedModules?: string[]; // Danh sách module được phép sử dụng (VD: ['WMS', 'TS'])
  adminModules?: string[]; // Danh sách module mà user là Quản trị viên ứng dụng
  allowedSubModules?: Record<string, string[]>; // Module key -> danh sách route sub-app được phép (VD: { "HRM": ["/hrm/attendance", "/hrm/leave"] })
  adminSubModules?: Record<string, string[]>; // Module key -> danh sách route sub-app có quyền CRUD (VD: { "HRM": ["/hrm/employees"] })
  signatureUrl?: string; // URL ảnh chữ ký số
  isActive?: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  address: string;
  type: WarehouseType;
  isArchived?: boolean; // Soft delete flag
}

// ==================== NHÀ CUNG CẤP MASTER ====================
// Đây là nguồn dữ liệu NCC duy nhất — dùng chung cho Kho (WMS) và Dự án (DA)
// ProjectVendor trong module DA tham chiếu bảng project_vendors riêng
// nhưng cùng cấu trúc dữ liệu để tương thích.
export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;   // Người liên hệ
  phone: string;
  email?: string;
  address?: string;
  taxCode?: string;        // Mã số thuế
  debt: number;            // Công nợ (VNĐ)
  rating?: number;         // Đánh giá 1-5 sao
  categories?: string[];   // Loại hàng/dịch vụ cung cấp
  notes?: string;
  createdAt?: string;
}

// ==================== HRM MASTER DATA ====================

export interface HrmArea {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface HrmOffice {
  id: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  checkInRadius?: number;   // mét — bán kính check-in (default 100m)
  managerId?: string;       // User ID của người quản lý (duyệt đề xuất CC)
  createdAt?: string;
}

export interface HrmEmployeeType {
  id: string;
  name: string;
  createdAt?: string;
}

export interface HrmPosition {
  id: string;
  name: string;
  level?: number;
  createdAt?: string;
}

export interface HrmSalaryPolicy {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface HrmWorkSchedule {
  id: string;
  name: string;
  description?: string;
  morningStart?: string;    // "08:00" — giờ bắt đầu ca sáng
  morningEnd?: string;      // "12:00" — giờ kết thúc ca sáng
  afternoonStart?: string;  // "13:00" — giờ bắt đầu ca chiều
  afternoonEnd?: string;    // "17:00" — giờ kết thúc ca chiều
  createdAt?: string;
}

export interface HrmShiftType {
  id: string;
  name: string;
  startTime: string;          // "08:00"
  endTime: string;            // "17:00"
  breakMinutes: number;       // Phút nghỉ trưa (default 60)
  graceLateMins: number;      // Grace period đi muộn (phút, default 15)
  graceEarlyMins: number;     // Grace period về sớm (phút, default 15)
  standardWorkingHours: number; // Giờ làm chuẩn (default 8)
  otMultiplierNormal: number;   // Hệ số OT ngày thường (default 1.5)
  otMultiplierWeekend: number;  // Hệ số OT cuối tuần (default 2.0)
  otMultiplierHoliday: number;  // Hệ số OT ngày lễ (default 3.0)
  nightShiftPremium: number;    // Phụ cấp ca đêm % (default 0.3)
  isNightShift: boolean;
  color: string;
  isActive: boolean;
  createdAt?: string;
}

export interface HrmEmployeeShift {
  id: string;
  employeeId: string;
  shiftTypeId: string;
  shiftDate?: string;         // YYYY-MM-DD (null = ca mặc định)
  isDayOff: boolean;
  note?: string;
  createdAt?: string;
}

export interface HrmConstructionSite {
  id: string;
  name: string;
  address?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  checkInRadius?: number;   // mét — bán kính check-in (default 200m)
  managerId?: string;       // User ID của người quản lý (duyệt đề xuất CC)
  createdAt?: string;
}

// ==================== DỰ ÁN (DA) ====================

// ── Tổ chức Dự Án — Phân bổ nhân sự + quyền nghiệp vụ ──
export interface ProjectPermissionType {
  id: string;
  code: string;       // 'view' | 'edit' | 'submit' | 'verify' | 'confirm' | 'approve'
  name: string;
  module?: string;    // NULL = áp dụng mọi module DA
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
}

export interface ProjectStaff {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  userId: string;
  positionId: string;          // FK → hrm_positions.id
  startDate?: string;
  endDate?: string;
  note?: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
  // Joined fields (populated by service)
  userName?: string;
  userAvatar?: string;
  positionName?: string;
  positionLevel?: number;
  permissions?: ProjectStaffPermission[];
}

export interface ProjectStaffPermission {
  id: string;
  staffId: string;
  permissionTypeId: string;
  isActive: boolean;
  grantedBy?: string;
  grantedAt?: string;
  // Joined
  permissionCode?: string;
  permissionName?: string;
}

export interface ProjectSubmissionTarget {
  userId: string;
  userIds?: string[];
  name: string;
  names?: string[];
  permissionCode?: string;
  note?: string;
}

export interface ProjectSubmissionFields {
  submittedToUserId?: string | null;
  submittedToName?: string | null;
  submittedToPermission?: string | null;
  submissionNote?: string | null;
  everSubmitted?: boolean;
  lastActionBy?: string | null;
  lastActionAt?: string | null;
  workflowStep?: MaterialRequestWorkflowStep | string | null;
  workflowStepStartedAt?: string | null;
  workflowStepDueAt?: string | null;
  workflowStepSlaHours?: number | null;
  workflowStepActorUserId?: string | null;
  workflowInstanceId?: string | null;
  workflowSubjectId?: string | null;
  workflowTemplateId?: string | null;
}

export type MaterialRequestWorkflowStep =
  | 'draft'
  | 'site_manager_review'
  | 'material_department_review'
  | 'batch_planning'
  | 'site_quality_check'
  | 'site_receipt'
  | 'completed'
  | 'rejected'
  | 'returned_to_creator';

export type MaterialRequestKanbanStage =
  | 'draft'
  | 'site_manager_review'
  | 'material_department_review'
  | 'batch_planning'
  | 'site_quality_check'
  | 'site_receipt'
  | 'completed'
  | 'closed';

export type MaterialRequestKanbanLaneId =
  | MaterialRequestKanbanStage
  | 'legacy_review'
  | `workflow:${string}`;

export interface MaterialRequestEvent {
  id: string;
  requestId: string;
  projectId: string;
  fromStep?: string | null;
  toStep?: string | null;
  action: string;
  actorUserId: string;
  targetUserId?: string | null;
  targetPermission?: string | null;
  note?: string | null;
  slaHours?: number | null;
  dueAt?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed';
export type ProjectProgressCalculationMode = 'gantt_weighted' | 'budget' | 'duration' | 'task_count' | 'contract_value' | 'manual';

export interface ProjectMasterCategory {
  id: string;
  code?: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectGroup extends ProjectMasterCategory {}
export interface ProjectTypeMaster extends ProjectMasterCategory {}
export interface ProjectSector extends ProjectMasterCategory {}

export type WorkGroupMemberRole = 'lead' | 'member';

export interface WorkGroup {
  id: string;
  code?: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkGroupMember {
  id: string;
  groupId: string;
  userId: string;
  memberRole: WorkGroupMemberRole;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkGroupWithMembers extends WorkGroup {
  members: WorkGroupMember[];
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description?: string;
  clientName?: string;
  projectType: 'construction' | 'infrastructure' | 'maintenance' | 'other' | string;
  projectGroupId?: string | null;
  projectTypeId?: string | null;
  projectSectorId?: string | null;
  workflowTemplateId?: string | null;
  status: ProjectStatus | 'cancelled';
  constructionSiteId?: string | null;
  managerId?: string;
  startDate?: string;
  endDate?: string;
  progressCalculationMode?: ProjectProgressCalculationMode;
  manualProgressPercent?: number;
  createdBy?: string;
  source?: 'manual' | 'backfill';
  isPinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
  isHidden?: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  hiddenReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectDeleteImpactItem {
  key: string;
  label: string;
  count: number;
  totalAmount: number;
}

export interface ProjectDeleteImpact {
  projectId: string;
  constructionSiteId?: string | null;
  items: ProjectDeleteImpactItem[];
  totalRows: number;
  totalAmount: number;
  hasImpact: boolean;
  warnings: string[];
}

export interface ProjectFinance {
  id: string;
  projectId?: string | null;
  constructionSiteId: string;

  // Hợp đồng
  contractValue: number;
  contractSignDate?: string;
  estimatedEndDate?: string;

  // Ngân sách (Dự toán)
  budgetMaterials: number;
  budgetLabor: number;
  budgetSubcontract: number;
  budgetMachinery: number;
  budgetOverhead: number;

  // Chi phí thực tế
  actualMaterials: number;
  actualLabor: number;
  actualSubcontract: number;
  actualMachinery: number;
  actualOverhead: number;

  // Doanh thu
  revenueReceived: number;
  revenuePending: number;

  // Tiến độ
  progressPercent: number;
  status: ProjectStatus;

  notes?: string;
  updatedAt: string;
}

export type ProjectCostCategory = 'materials' | 'labor' | 'subcontract' | 'machinery' | 'overhead' | 'other';
export type ProjectTxType = 'expense' | 'revenue_received' | 'revenue_pending';
export type ProjectTxSource = 'manual' | 'import' | 'workflow';

export interface ProjectTransaction {
  id: string;
  projectId?: string | null;
  projectFinanceId: string;
  constructionSiteId: string;
  type: ProjectTxType;
  category: ProjectCostCategory;
  amount: number;
  description: string;
  date: string;
  source: ProjectTxSource;
  sourceRef?: string;
  attachments?: Attachment[];
  createdBy?: string;
  createdAt: string;
}

export type PaymentScheduleStatus = 'pending' | 'paid' | 'overdue';
export type PaymentScheduleMilestoneType = 'advance' | 'progress' | 'settlement' | 'retention' | 'other';
export type PaymentDossierStatus = 'not_started' | 'preparing' | 'submitted' | 'approved';
export type PaymentQualityStatus = 'not_applicable' | 'not_confirmed' | 'passed' | 'failed';
export interface PaymentSchedule {
  id: string;
  projectId?: string | null;
  constructionSiteId: string;
  contractId?: string;
  contractType?: ContractItemType;
  appendixId?: string;
  sequenceNo?: number;
  milestoneType?: PaymentScheduleMilestoneType;
  description: string;         // "Đợt 1 - Tạm ứng 30%"
  amount: number;
  dueDate: string;
  paidDate?: string;
  paidAmount?: number;
  status: PaymentScheduleStatus;
  type: 'receivable' | 'payable'; // Phải thu (CĐT) / Phải trả (NTP)
  contactName?: string;           // Tên CĐT hoặc NTP
  plannedTaskIds?: string[];
  plannedScopeNote?: string;
  dossierStatus?: PaymentDossierStatus;
  qualityStatus?: PaymentQualityStatus;
  qualityConfirmedBy?: string;
  qualityConfirmedName?: string;
  qualityConfirmedAt?: string;
  qualityNote?: string;
  note?: string;
}

export interface PaymentSchedulePlannedTask {
  id: string;
  name: string;
  wbsCode?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number | null;
}

export interface PaymentScheduleWorkbenchRow extends PaymentSchedule {
  contractCode?: string;
  contractName?: string;
  contractValue?: number;
  contractCurrency?: 'VND' | 'USD';
  counterpartyName?: string;
  plannedTasks: PaymentSchedulePlannedTask[];
  daysUntilDue: number;
  isUpcoming: boolean;
  isOverdue: boolean;
  remainingAmount: number;
}

export interface PaymentScheduleWorkbenchSummary {
  customerContractValue: number;
  totalReceivable: number;
  totalPayable: number;
  upcomingCount: number;
  overdueCount: number;
  paidAmount: number;
  pendingAmount: number;
  paidCount: number;
  totalCount: number;
}

// ==================== HỢP ĐỒNG (HD) ====================
export type ContractType = 'main' | 'subcontract';
export type ContractStatus = 'draft' | 'active' | 'completed' | 'terminated';

export interface ProjectContract {
  id: string;
  constructionSiteId: string;
  contractNumber: string;
  type: ContractType;
  partyName: string;
  value: number;
  signDate: string;
  startDate: string;
  endDate: string;
  paymentTerms?: string;
  attachments?: Attachment[];
  status: ContractStatus;
  note?: string;
  createdAt: string;
}

// ==================== TIẾN ĐỘ (Gantt) ====================
export type TaskDependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ProjectTaskProgressMode = 'manual' | 'derived_from_acceptance' | 'completion_request' | 'daily_log' | 'children_auto' | 'weekly_report';
export type ProjectTaskCompletionStatus = 'submitted' | 'verified' | 'approved' | 'returned' | 'cancelled';

export type DelayCategory = 'material' | 'weather' | 'drawing' | 'labor' | 'other';
export type ResourceType = 'worker' | 'machine' | 'specialist';
export type GateStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface ProjectTask {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  parentId?: string;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;         // ngày
  progress: number;         // >=0; weekly reports may exceed 100 for over-completion
  progressMode?: ProjectTaskProgressMode;
  assignee?: string;
  assigneeUserId?: string;   // User ID người phụ trách chuẩn từ project_staff
  dependencies?: { taskId: string; type: TaskDependencyType; requiresGateApproval?: boolean }[];
  isMilestone: boolean;
  color?: string;
  notes?: string;
  order: number;
  // GĐ1: Network Graph & Critical Path
  lagTime?: number;           // Thời gian chờ (ngày) giữa task và predecessor
  floatDays?: number;         // Slack/Float — số ngày có thể trễ mà không ảnh hưởng dự án
  isCritical?: boolean;       // Nằm trên đường găng?
  // GĐ1: Baseline (Shadow)
  baselineStart?: string;     // Kế hoạch gốc — ngày bắt đầu
  baselineEnd?: string;       // Kế hoạch gốc — ngày kết thúc
  baselineLocked?: boolean;   // Đã chốt baseline?
  // GĐ1: Resource Management
  resourceCount?: number;     // Số nhân lực/máy cần
  resourceType?: ResourceType;
  estimatedCostPerDay?: number; // Chi phí ước tính/ngày
  // GĐ3: Delay Tracking
  delayReason?: string;
  delayCategory?: DelayCategory;
  // GĐ1: Gate Approval
  gateStatus?: GateStatus;
  gateApprovedBy?: string;
  gateApprovedAt?: string;
  baselineVersion?: string;
  baselineChangeReason?: string;
  // Tiến độ: Ngày thực tế
  actualStartDate?: string;   // Ngày bắt đầu thực tế (ISO date)
  actualEndDate?: string;     // Ngày kết thúc thực tế (ISO date)
  // WBS & đơn vị
  wbsCode?: string;           // Mã WBS: "1.1.3"
  fallbackUnit?: string;      // Đơn vị tính fallback (khi chưa liên kết BOQ)
  provisionalQuantity?: number; // Khối lượng tạm tính nội bộ cho tiến độ/BOQ triển khai
  watchers?: string[];        // User IDs theo dõi hạng mục
  // FastCons: BOQ Integration — DEPRECATED, dùng task_contract_items thay thế
  // Xem taskContractItemService.ts + TaskContractItem type
  /** @deprecated Dùng task_contract_items join contract_items để đọc BOQ */
  code?: string;              // Mã hạng mục BOQ legacy
  /** @deprecated Dùng task_contract_items join contract_items để đọc BOQ */
  quantity?: number;          // Khối lượng theo BOQ
  /** @deprecated Dùng task_contract_items join contract_items để đọc BOQ */
  unit?: string;              // Đơn vị tính BOQ legacy
  /** @deprecated Dùng task_contract_items join contract_items để đọc BOQ */
  unitPrice?: number;         // Đơn giá (VNĐ)
  /** @deprecated Dùng task_contract_items join contract_items để đọc BOQ */
  totalPrice?: number;        // Auto = quantity × unitPrice
  /** @deprecated Dùng ContractItem.completedQuantity thay thế */
  completedQuantity?: number; // KL hoàn thành thực tế (cộng dồn từ nhật ký)
  contractItemId?: string;    // FK → ContractItem.id (liên kết hạng mục HĐ)

}

export interface ProjectTaskCompletionRequest extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  taskId: string;
  status: ProjectTaskCompletionStatus;
  proposedQuantity: number;
  acceptedQuantity: number;
  note?: string | null;
  returnReason?: string | null;
  attachments: Attachment[];
  submittedBy?: string | null;
  submittedAt: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  returnedBy?: string | null;
  returnedAt?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectWorkBoqSyncStatus = 'synced' | 'manual' | 'orphaned';

export interface ProjectWorkBoqItem {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  sourceTaskId?: string | null;
  parentId?: string | null;
  wbsCode?: string | null;
  name: string;
  unit: string;
  plannedQty: number;
  unitPrice: number;
  totalAmount?: number;
  sortOrder: number;
  syncStatus: ProjectWorkBoqSyncStatus;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectWeeklyTaskProgress {
  id?: string;
  scopeKey: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  taskId: string;
  weekStart: string;
  progressPercent: number;
  quantityDone: number;
  note?: string | null;
  attachments?: Attachment[];
  updatedBy?: string | null;
  updatedAt?: string;
  createdAt?: string;
}

export interface ProjectValueProgressMetric {
  contractTotalValue: number;
  purchasedValue: number;
  issuedValue: number;
  recognizedValue: number;
  valueProgressPercent: number;
}

export type ProjectOpeningBalanceStatus = string;

export interface ProjectOpeningBalance {
  id?: string;
  scopeKey: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  asOfDate: string;
  contractValue: number;
  constructionProgressPercent: number;
  purchasedValue: number;
  issuedValue: number;
  usedValue: number;
  recognizedValue: number;
  status: ProjectOpeningBalanceStatus;
  note?: string | null;
  stockTransactionIds?: string[];
  materialProjectTransactionId?: string | null;
  createdBy?: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectOpeningBalanceLine {
  id?: string;
  openingBalanceId?: string;
  inventoryItemId?: string | null;
  sku: string;
  itemName: string;
  unit: string;
  warehouseId: string;
  purchasedQty: number;
  issuedQty: number;
  usedQty: number;
  remainingQty: number;
  unitPrice: number;
  remainingValue: number;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type ProjectOpeningBalanceImportRow = Omit<ProjectOpeningBalanceLine, 'id' | 'openingBalanceId' | 'createdAt' | 'updatedAt'> & {
  rowNumber?: number;
  errors?: string[];
};

export type BoqReconciliationStatus = 'draft' | 'submitted' | 'reviewed' | 'locked';

export interface BoqReconciliationContractLine {
  id?: string;
  groupId: string;
  contractItemId: string;
  contractId?: string | null;
  contractType: ContractItemType;
  originalQuantity: number;
  originalUnit?: string | null;
  allocatedQuantity: number;
  allocatedPercent?: number | null;
  convertedQuantity: number;
  convertedUnit?: string | null;
  conversionFactor: number;
  conversionFormula?: string | null;
  unitPriceSnapshot: number;
  amountSnapshot: number;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoqReconciliationWorkLine {
  id?: string;
  groupId: string;
  workBoqItemId: string;
  sourceTaskId?: string | null;
  originalQuantity: number;
  originalUnit?: string | null;
  allocatedQuantity: number;
  allocatedPercent?: number | null;
  convertedQuantity: number;
  convertedUnit?: string | null;
  conversionFactor: number;
  conversionFormula?: string | null;
  unitPriceSnapshot: number;
  amountSnapshot: number;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoqReconciliationGroup extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  contractType: ContractItemType;
  contractId?: string | null;
  code?: string | null;
  name: string;
  description?: string | null;
  status: BoqReconciliationStatus;
  preparedById?: string | null;
  preparedByName?: string | null;
  reviewedById?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  lockedById?: string | null;
  lockedByName?: string | null;
  lockedAt?: string | null;
  contractLines?: BoqReconciliationContractLine[];
  workLines?: BoqReconciliationWorkLine[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskContractItem {
  id: string;
  taskId: string;
  contractItemId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  weightPercent?: number;
  note?: string;
  createdAt?: string;
}

export interface ProjectBaseline {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  name: string;
  lockedAt: string;
  lockedBy?: string;
  tasksSnapshot: ProjectTask[];
  createdAt?: string;
}

export type ProjectDelayEventStatus = 'reported' | 'accepted' | 'applied' | 'resolved' | 'void';

export interface ProjectDelayEvent {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  sourceDailyLogId?: string | null;
  taskId?: string | null;
  taskNameSnapshot: string;
  category: DelayCategory;
  reason?: string | null;
  impactDays: number;
  status: ProjectDelayEventStatus;
  responsibility?: string | null;
  occurredOn: string;
  createdBy?: string | null;
  acceptedBy?: string | null;
  acceptedAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectScheduleRevision {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  reason?: string | null;
  sourceDelayEventIds: string[];
  appliedBy?: string | null;
  appliedAt: string;
  createdAt?: string;
}

export interface ProjectScheduleRevisionTask {
  id?: string;
  revisionId: string;
  taskId?: string | null;
  taskNameSnapshot: string;
  beforeStart: string;
  beforeEnd: string;
  beforeDuration: number;
  afterStart: string;
  afterEnd: string;
  afterDuration: number;
  deltaDays: number;
  wasCritical: boolean;
  floatBefore: number;
  createdAt?: string;
}

// ==================== NHẬT KÝ CÔNG TRƯỜNG ====================
export type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'storm';
export type DailyLogStatus = 'draft' | 'submitted' | 'verified' | 'rejected';

export interface DelayTaskEntry {
  taskId: string;
  taskName: string;        // cache tên để hiển thị
  delayDays: number;
  reason: string;          // ghi chú tự do
  category: DelayCategory; // 'material' | 'weather' | 'drawing' | 'labor' | 'other'
}

// FastCons: Chi tiết nhật ký (gộp KL/VT/NC/Máy vào 1 DailyLog)
export interface DailyLogVolume {
  contractItemId?: string;    // FK → ContractItem khi đã đối chiếu/nghiệm thu
  contractItemName?: string;  // Cache tên hạng mục
  taskId?: string;            // FK → ProjectTask (nếu liên kết Gantt)
  taskName?: string;          // Cache tên hạng mục tiến độ
  workBoqItemId?: string;     // FK → ProjectWorkBoqItem để gom thực tế theo BOQ thi công
  workBoqItemName?: string;   // Cache tên đầu mục BOQ thi công
  quantity: number;           // KL thực hiện trong ngày
  unit: string;               // Đơn vị tính
  note?: string;
  photoUrl?: string;
  attachments?: Attachment[]; // Bằng chứng khối lượng trong nhật ký
}

export interface DailyLogMaterial {
  materialId?: string;        // FK → MaterialBudgetItem.id hoặc InventoryItem.id khi chọn từ tồn kho công trường
  itemName: string;           // Tên vật tư
  unit: string;               // Đơn vị: kg, m3, bao...
  quantity: number;           // SL sử dụng trong ngày
  note?: string;
}

export type LaborType = 'tho_chinh' | 'tho_phu' | 'van_hanh' | 'giam_sat' | 'khac';
export const LABOR_TYPE_LABELS: Record<LaborType, string> = {
  tho_chinh: 'Thợ chính',
  tho_phu: 'Thợ phụ',
  van_hanh: 'Vận hành',
  giam_sat: 'Giám sát',
  khac: 'Khác',
};

export interface DailyLogLabor {
  laborType: LaborType | string;
  catalogItemId?: string;
  catalogCode?: string;
  catalogName?: string;
  groupName?: string;
  partnerId?: string;
  partnerName?: string;
  taskId?: string;
  taskName?: string;
  count: number;              // Số lượng
  hours?: number;             // Giờ làm (default 8)
  unitCost?: number;          // Đơn giá / ngày
  totalCost?: number;         // Auto = count × unitCost
  note?: string;
}

export type MachineType = 'excavator' | 'crane' | 'truck' | 'mixer' | 'pump' | 'compactor' | 'other';
export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  excavator: 'Máy đào',
  crane: 'Cần trục',
  truck: 'Xe tải',
  mixer: 'Trộn bê tông',
  pump: 'Máy bơm',
  compactor: 'Máy đầm',
  other: 'Khác',
};

export interface DailyLogMachine {
  machineName: string;        // Tên máy cụ thể
  machineType: MachineType | string;
  catalogItemId?: string;
  catalogCode?: string;
  catalogName?: string;
  groupName?: string;
  taskId?: string;
  taskName?: string;
  shifts: number;             // Số ca (0.5, 1, 1.5, 2)
  unitCost?: number;          // Đơn giá / ca
  totalCost?: number;         // Auto = shifts × unitCost
  note?: string;
}

export interface DailyLog {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  date: string;
  weather: WeatherType;
  workerCount: number;
  description: string;
  acceptanceDescription?: string;
  workSafetyOk?: boolean;
  envHygieneOk?: boolean;
  trafficSafetyOk?: boolean;
  supervisorConstructionEval?: string;
  supervisorAcceptanceEval?: string;
  supervisorSafetyOk?: boolean;
  supervisorHygieneOk?: boolean;
  supervisorTrafficOk?: boolean;
  issues?: string;
  photos?: { name: string; url: string }[];
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  delayTasks?: DelayTaskEntry[];
  photoRequired?: boolean;
  verified?: boolean;
  verifiedBy?: string;
  verifiedById?: string;
  verifiedAt?: string;
  status?: DailyLogStatus;
  submittedBy?: string;
  submittedById?: string;
  submittedAt?: string;
  submittedToUserId?: string;
  submittedToName?: string;
  submittedToPermission?: string;
  submissionNote?: string;
  requestedVerifierId?: string;
  requestedVerifierName?: string;
  rejectedBy?: string;
  rejectedById?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  everSubmitted?: boolean;
  lastActionBy?: string | null;
  lastActionAt?: string | null;
  createdBy: string;
  createdById?: string;
  createdAt: string;
  // FastCons: Chi tiết nhật ký gộp
  volumes?: DailyLogVolume[];      // Khối lượng thi công theo hạng mục
  materials?: DailyLogMaterial[];  // Vật tư sử dụng
  laborDetails?: DailyLogLabor[];  // Nhân công chi tiết
  machines?: DailyLogMachine[];    // Máy thi công
}

// ==================== NGHIỆM THU NHÀ THẦU (Legacy — giữ lại tương thích) ====================
export type AcceptanceStatus = 'draft' | 'submitted' | 'approved' | 'paid';

export interface AcceptanceRecord {
  id: string;
  contractId: string;           // Liên kết HĐ thầu phụ
  projectId?: string | null;
  constructionSiteId?: string | null;
  periodNumber: number;         // Đợt nghiệm thu (1, 2, 3...)
  description: string;          // "Nghiệm thu đợt 1 - Phần móng"
  periodStart: string;
  periodEnd: string;
  approvedValue: number;        // Giá trị nghiệm thu
  retentionPercent: number;     // % giữ lại bảo hành (VD: 5%)
  retentionAmount?: number;     // Auto = approvedValue * retentionPercent / 100
  payableAmount?: number;       // Auto = approvedValue - retentionAmount
  status: AcceptanceStatus;
  attachments?: Attachment[];
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  note?: string;
  createdAt: string;
}

// ==================== BOQ HẠNG MỤC HỢP ĐỒNG (FastCons) ====================

export type ContractItemType = 'customer' | 'subcontractor';

export interface ContractItem {
  id: string;
  contractId: string;           // FK → CustomerContract.id hoặc SubcontractorContract.id
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  parentId?: string;            // Phân cấp cha/con (nhóm hạng mục)
  code: string;                 // Mã hạng mục: "1", "1.1", "2"
  name: string;                 // Tên hạng mục: "Đào đất móng"
  unit: string;                 // Đơn vị: m3, kg, m2, md
  quantity: number;             // Khối lượng HĐ
  unitPrice: number;            // Đơn giá (VNĐ)
  revisedUnitPrice?: number;     // Đơn giá hiện hành sau điều chỉnh
  totalPrice: number;           // Auto = quantity × unitPrice
  originalQuantity?: number;     // Snapshot khối lượng gốc
  originalUnitPrice?: number;    // Snapshot đơn giá gốc
  originalTotalPrice?: number;   // Snapshot thành tiền gốc
  variationQuantity?: number;    // Tổng tăng/giảm KL từ phát sinh approved
  variationAmount?: number;      // Tổng tăng/giảm giá trị từ phát sinh approved
  revisedQuantity?: number;      // KL hợp đồng sau phát sinh
  revisedTotalPrice?: number;    // GT hợp đồng sau phát sinh
  isLocked?: boolean;            // Đã phát sinh nghiệm thu/thanh toán
  lockedAt?: string;
  description?: string;
  category?: string;
  brand?: string;
  origin?: string;
  technicalSpec?: string;
  length?: number;
  width?: number;
  height?: number;
  materialUnitPrice?: number;
  laborUnitPrice?: number;
  machineUnitPrice?: number;
  workCode?: string;
  // Tracking KL
  completedQuantity?: number;   // KL hoàn thành lũy kế (auto từ nhật ký/nghiệm thu)
  completedPercent?: number;    // Auto = completedQuantity / quantity × 100
  // Metadata
  order: number;
  note?: string;
  createdAt?: string;
}

export type ContractItemResourceType = 'material' | 'labor' | 'machine';

export interface ContractItemResource {
  id: string;
  contractItemId: string;
  resourceType: ContractItemResourceType;
  code?: string;
  name: string;
  unit?: string;
  norm: number;
  coefficient: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  order: number;
  createdAt?: string;
}

// ==================== THANH TOÁN THEO CHUẨN FASTCONS ====================

export type QuantityAcceptanceStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'cancelled';
export type PaymentCertificateStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'paid' | 'cancelled';
export type ContractVariationStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export type PaymentEligibilityBlockReason =
  | 'eligible'
  | 'missing_verified_log'
  | 'missing_internal_acceptance'
  | 'missing_contract_acceptance'
  | 'missing_task_contract_link'
  | 'over_boq'
  | 'certificate_pending'
  | 'payment_pending'
  | 'fully_paid'
  | 'cashflow_unsynced';

export type PaymentEligibilityNextAction =
  | 'create_acceptance'
  | 'create_certificate'
  | 'open_gantt'
  | 'open_contract'
  | 'open_certificate'
  | 'open_cashflow'
  | 'none';

export type PaymentEligibilityStatus = 'eligible' | 'blocked' | 'pending' | 'paid';

export interface PaymentEligibilitySourceLog {
  id: string;
  date: string;
  quantity: number;
  unit?: string | null;
  taskId?: string | null;
  taskName?: string | null;
  workBoqItemId?: string | null;
  workBoqItemName?: string | null;
  reason?: string;
}

export interface PaymentEligibilitySourceDocument {
  id: string;
  type: 'internal_acceptance' | 'contract_acceptance' | 'payment_certificate';
  label: string;
  status: string;
  periodNumber?: number;
  amount: number;
  quantity?: number;
}

export interface PaymentEligibilityRow {
  id: string;
  status: PaymentEligibilityStatus;
  contractId?: string | null;
  contractType: ContractItemType;
  contractCode?: string;
  contractName?: string;
  counterpartyName?: string;
  contractItemId?: string | null;
  boqCode: string;
  boqName: string;
  regionLabel: string;
  taskId?: string | null;
  taskName?: string | null;
  taskWbsCode?: string | null;
  taskProgress?: number | null;
  taskStatus?: string | null;
  taskStartDate?: string | null;
  taskEndDate?: string | null;
  taskActualStartDate?: string | null;
  taskActualEndDate?: string | null;
  taskIsCritical?: boolean;
  taskIsOverdue?: boolean;
  unit?: string;
  unitPrice: number;
  contractQuantity: number;
  revisedContractQuantity: number;
  contractAmount: number;
  executedQuantity: number;
  executedAmount: number;
  internalAcceptedQuantity: number;
  internalAcceptedAmount: number;
  contractAcceptedQuantity: number;
  contractAcceptedAmount: number;
  certifiedQuantity: number;
  certifiedAmount: number;
  pendingCertifiedAmount: number;
  paidQuantity: number;
  paidAmount: number;
  payableRemainingAmount: number;
  certifiableRemainingAmount: number;
  blockedAmount: number;
  blockReason: PaymentEligibilityBlockReason;
  blockLabel: string;
  nextAction: PaymentEligibilityNextAction;
  nextActionLabel: string;
  cashflowSynced: boolean;
  sourceLogs: PaymentEligibilitySourceLog[];
  sourceDocuments: PaymentEligibilitySourceDocument[];
}

export interface PaymentEligibilitySummary {
  totalEligibleAmount: number;
  totalBlockedAmount: number;
  totalPayableRemainingAmount: number;
  eligibleCount: number;
  blockedCount: number;
  pendingCount: number;
  paidCount: number;
  waitingContractAcceptanceCount: number;
  waitingProgressMappingCount: number;
  cashflowUnsyncedCount: number;
}

export interface PaymentEligibilityWorkbench {
  rows: PaymentEligibilityRow[];
  summary: PaymentEligibilitySummary;
}

export interface PaymentCertificateItem {
  id?: string;
  paymentCertificateId?: string;
  contractItemId: string;       // FK → ContractItem.id
  contractItemCode?: string;    // Cache mã hạng mục
  contractItemName?: string;    // Cache tên hạng mục
  unit?: string;                // Cache ĐVT
  contractQuantity: number;     // KL theo HĐ
  revisedContractQuantity?: number;
  previousQuantity: number;     // KL đã nghiệm thu các đợt trước
  currentQuantity: number;      // KL nghiệm thu đợt này
  certifiedQuantity?: number;   // Alias nghiệp vụ cho currentQuantity
  cumulativeQuantity: number;   // Auto = previousQuantity + currentQuantity
  unitPrice: number;            // Đơn giá
  contractAmount?: number;      // GT hạng mục HĐ sau phát sinh
  currentAmount: number;        // GT đề nghị thanh toán kỳ này, nhập tay
  cumulativeAmount: number;     // GT thanh toán lũy kế
  paymentPercent?: number;      // % thanh toán kỳ này so với giá trị hạng mục HĐ
  sourceAcceptedAmount?: number;// GT nghiệm thu làm tham chiếu khi tạo thanh toán
  sourceAcceptanceItemId?: string;
  paymentNote?: string;
  note?: string;
}

export interface PaymentCertificate extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  contractId: string;           // FK → CustomerContract hoặc SubcontractorContract
  contractType: ContractItemType; // 'customer' | 'subcontractor'
  constructionSiteId: string;
  periodNumber: number;         // Đợt thanh toán: 1, 2, 3...
  periodStart: string;
  periodEnd: string;
  description?: string;         // "Thanh toán đợt 2 — Phần thân"
  acceptanceId?: string;
  // Chi tiết hạng mục
  items: PaymentCertificateItem[];
  // Giá trị tổng hợp
  totalContractValue: number;       // GT HĐ (cache)
  totalCompletedValue: number;      // GT hoàn thành lũy kế = Σ(cumulativeAmount)
  currentCompletedValue: number;    // GT hoàn thành đợt này = Σ(currentAmount)
  grossThisPeriod?: number;         // GT hoàn thành kỳ này
  grossCumulative?: number;         // GT hoàn thành lũy kế
  // Khấu trừ & Phạt
  advanceRecovery: number;          // Thu hồi tạm ứng kỳ này, nhập tay
  advanceRecoveryThisPeriod?: number;
  advanceRecoveryCumulative?: number;
  retentionPercent: number;         // Legacy/reference
  retentionAmount: number;          // Giữ lại bảo hành kỳ này, nhập tay
  retentionThisPeriod?: number;
  retentionCumulative?: number;
  penaltyAmount: number;            // Phạt (nhập tay)
  penaltyReason?: string;
  deductionAmount: number;          // Khấu trừ khác (nhập tay)
  deductionReason?: string;
  // Lũy kế
  previousCertifiedAmount: number;  // GT đã TT các đợt trước
  currentPayableAmount: number;     // GT TT đợt này (= Gross - Recovery - Retention - Penalty - Deduction)
  payableThisPeriod?: number;
  // Workflow
  status: PaymentCertificateStatus;
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  note?: string;
  attachments?: Attachment[];
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentCertificateAdvanceRecovery {
  id?: string;
  paymentCertificateId: string;
  advancePaymentId: string;
  recoveryAmount: number;
  createdAt?: string;
}

// ==================== TẠM ỨNG (FastCons) ====================

export type AdvancePaymentStatus = 'active' | 'fully_recovered' | 'cancelled';

export interface AdvancePayment {
  id: string;
  projectId?: string | null;
  contractId: string;           // FK → HĐ
  contractType: ContractItemType;
  constructionSiteId: string;
  amount: number;               // Số tiền tạm ứng
  date: string;                 // Ngày tạm ứng
  recoveryPercent: number;      // % thu hồi mỗi đợt (VD: 30% → thu 30% GT hoàn thành)
  recoveredAmount: number;      // Đã thu hồi lũy kế
  remainingAmount: number;      // Auto = amount - recoveredAmount
  status: AdvancePaymentStatus;
  note?: string;
  createdAt: string;
}

export type QuantityAcceptanceScope = 'internal' | 'contract';

export interface QuantityAcceptanceItem {
  id?: string;
  acceptanceId?: string;
  contractItemId?: string | null;
  contractItemCode?: string;
  contractItemName?: string;
  taskId?: string | null;
  taskName?: string | null;
  workBoqItemId?: string | null;
  workBoqItemName?: string | null;
  unit?: string;
  previousAcceptedQuantity: number;
  proposedQuantity: number;
  acceptedQuantity: number;
  cumulativeAcceptedQuantity: number;
  unitPrice: number;
  acceptedPercent?: number;     // % nghiệm thu kỳ này do hai bên chốt
  suggestedAmount?: number;     // GT gợi ý từ KL quy đổi × đơn giá
  acceptedAmount: number;       // GT nghiệm thu kỳ này, nhập tay
  sourceDailyLogVolumeIds?: string[];
  amountNote?: string;
  note?: string;
}

export interface QuantityAcceptance extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  contractId: string;
  contractType: ContractItemType;
  acceptanceScope?: QuantityAcceptanceScope;
  constructionSiteId: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  description?: string;
  status: QuantityAcceptanceStatus;
  items: QuantityAcceptanceItem[];
  totalAcceptedAmount: number;
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  returnedBy?: string;
  returnedAt?: string;
  returnReason?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ContractVariationItem {
  id?: string;
  variationId?: string;
  contractItemId?: string;
  actionType?: 'update_quantity' | 'update_price' | 'add_item' | 'reduce_remove';
  code: string;
  name: string;
  unit: string;
  quantityDelta: number;
  unitPrice: number;
  amountDelta: number;
  beforeQuantity?: number;
  afterQuantity?: number;
  beforeUnitPrice?: number;
  afterUnitPrice?: number;
  beforeAmount?: number;
  afterAmount?: number;
  metadata?: Record<string, any>;
  note?: string;
}

export interface ContractVariation extends ProjectSubmissionFields {
  id: string;
  contractId: string;
  contractType: ContractItemType;
  constructionSiteId: string;
  code: string;
  title: string;
  status: ContractVariationStatus;
  reason?: string;
  adjustmentDate?: string;
  versionNumber?: number;
  discountPercent?: number;
  discountAmount?: number;
  overheadCost?: number;
  vatPercent?: number;
  vatAmount?: number;
  contractValueAfter?: number;
  attachments?: ContractAttachment[];
  appendixId?: string;
  items: ContractVariationItem[];
  totalAmountDelta: number;
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export type ContractAppendixStatus = 'draft' | 'signed' | 'active' | 'cancelled';

export interface ContractAppendix {
  id: string;
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  appendixNumber: string;
  name: string;
  signedDate?: string;
  value: number;
  status: ContractAppendixStatus;
  variationIds: string[];
  attachments: ContractAttachment[];
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ==================== DANH MỤC KHOẢN MỤC CHI PHÍ DỰ ÁN (FastCons) ====================

export type CostItemSource = 'manual' | 'contract' | 'dailylog' | 'payment';

export interface ProjectCostItem {
  id: string;
  projectId?: string | null;
  constructionSiteId: string;
  code: string;                 // Mã phân cấp: "I", "I.1", "II", "II.3"
  name: string;                 // Tên khoản mục: "Chi phí vật liệu"
  parentId?: string;            // FK → ProjectCostItem.id (cây phân cấp)
  order: number;
  budgetAmount: number;         // Dự toán (VNĐ)
  actualAmount: number;         // Thực tế (auto sum từ nguồn)
  varianceAmount?: number;      // Auto = actualAmount - budgetAmount
  variancePercent?: number;     // Auto = varianceAmount / budgetAmount × 100
  formula?: string;             // Công thức tính (VD: "{VL} + 75%*{MTC}")
  warningThreshold?: number;    // % cảnh báo vượt (VD: 90 → cảnh báo khi actual > 90% budget)
  source: CostItemSource;       // Nguồn dữ liệu thực tế
  isAutoCalculated?: boolean;   // true = tự động tính từ nguồn, false = nhập tay
  note?: string;
  createdAt?: string;
}

export type ProjectCostActualSource = 'transaction' | 'purchase_order' | 'subcontract' | 'dailylog' | 'manual';

export interface ProjectCostActual {
  id: string;
  constructionSiteId: string;
  costItemId?: string;
  category: ProjectCostCategory;
  source: ProjectCostActualSource;
  sourceRef?: string;
  amount: number;
  description?: string;
  date: string;
  createdAt?: string;
}

export interface ProjectFinancialSummary {
  revisedContractValue: number;
  approvedVariationValue: number;
  forecastFinalCost: number;
  actualCost: number;
  budgetAmount: number;
  budgetVariance: number;
  contractMargin: number;
  certifiedRevenue: number;
  paidRevenue: number;
  cashIn: number;
  cashOut: number;
  cashPosition: number;
}

// ==================== VẬT TƯ & HAO HỤT ====================
export type MaterialRequestStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled';

export interface MaterialBudgetItem {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  workBoqItemId?: string | null;  // Link toi dau muc BOQ trien khai
  inventoryItemId?: string;       // Link tới InventoryItem.id trong module Kho
  materialCode?: string;        // Mã vật tư chuẩn: VT_CT_1-Thep_phi22
  category: string;             // Nhóm: Xi măng, Thép, Cát...
  itemName: string;             // Tên vật tư cụ thể
  unit: string;                 // Đơn vị: kg, m3, tấn, bao...
  budgetQty: number;            // KL vật tư tự tính = KL dự toán đầu mục * wasteThreshold
  budgetUnitPrice: number;      // Đơn giá dự toán
  budgetTotal?: number;         // Auto: budgetQty * budgetUnitPrice
  actualQty: number;            // Khối lượng thực tế công trường đã nhận thành công
  actualTotal?: number;         // Auto: actualQty * budgetUnitPrice
  wasteQty?: number;            // Auto: actualQty - budgetQty
  wastePercent?: number;        // Auto: (actualQty - budgetQty)/budgetQty * 100
  wasteValue?: number;          // Giá trị hao hụt (VNĐ) = wasteQty * unitPrice
  wasteThreshold: number;       // Ngưỡng hao hụt; với dòng G8 là định mức hao phí cho 1 đơn vị công tác
  cumulativeRequested?: number; // LK yêu cầu cấp
  cumulativeImported?: number;  // LK nhập kho (từ PO)
  cumulativeExported?: number;  // LK xuất kho (= actualQty)
  stockBalance?: number;        // Tồn kho = Nhập - Xuất
  budgetOverPercent?: number;   // % vượt ngân sách = (LK_YC - NS) / NS * 100
  autoAlert?: string;           // Cảnh báo tự động
  sortOrder?: number;
  notes?: string;
  sourceType?: 'manual' | 'excel_import' | 'g8_norm';
  sourceNormMappingId?: string | null;
  sourceNormComponentEstimateId?: string | null;
  sourceNormCodeSnapshot?: string | null;
}

export type MaterialDemandDistributionMethod = 'pre_start' | 'linear' | 'custom_curve';
export type MaterialForecastWindow = '7d' | '30d' | '90d';
export type MaterialPlanningRuleSource = 'item' | 'category' | 'default';

export interface MaterialPlanningRule {
  id?: string;
  scopeKey: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  inventoryItemId?: string | null;
  category?: string | null;
  leadTimeDays: number;
  distributionMethod: MaterialDemandDistributionMethod;
  curveTemplateId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlanningCurvePoint {
  id?: string;
  curveId: string;
  sequence: number;
  percentage: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlanningCurveTemplate {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  points: PlanningCurvePoint[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MaterialForecastDetail {
  id: string;
  materialBudgetItemId: string;
  workBoqItemId?: string | null;
  taskId?: string | null;
  wbsCode?: string | null;
  taskName: string;
  startDate?: string | null;
  endDate?: string | null;
  needDate?: string | null;
  remainingDemandQty: number;
  leadTimeDays: number;
  distributionMethod: MaterialDemandDistributionMethod;
  curveTemplateId?: string | null;
  curveTemplateName?: string | null;
  demandQty: Record<MaterialForecastWindow, number>;
  demandValue: Record<MaterialForecastWindow, number>;
  warnings: string[];
}

export interface MaterialForecastRow {
  key: string;
  inventoryItemId?: string | null;
  sku?: string | null;
  itemName: string;
  category: string;
  unit: string;
  unitPrice: number;
  planningUnitPrice: number;
  planningUnitPriceSource: 'latest_confirmed_po' | 'latest_received' | 'material_master' | 'fallback';
  siteAvailableQty: number;
  incomingQty: Record<MaterialForecastWindow, number>;
  demandQty: Record<MaterialForecastWindow, number>;
  demandValue: Record<MaterialForecastWindow, number>;
  shortageQty: Record<MaterialForecastWindow, number>;
  shortageValue: Record<MaterialForecastWindow, number>;
  forecastQty7d: number;
  forecastQty30d: number;
  forecastQty90d: number;
  forecastValue7d: number;
  forecastValue30d: number;
  forecastValue90d: number;
  shortageQty7d: number;
  shortageQty30d: number;
  shortageQty90d: number;
  shortageValue7d: number;
  shortageValue30d: number;
  shortageValue90d: number;
  leadTimeDays: number;
  distributionMethod: MaterialDemandDistributionMethod;
  curveTemplateId?: string | null;
  curveTemplateName?: string | null;
  ruleSource: MaterialPlanningRuleSource;
  warnings: string[];
  details: MaterialForecastDetail[];
}

export interface MaterialPlanningSummary {
  rowCount: number;
  demandQty: Record<MaterialForecastWindow, number>;
  demandValue: Record<MaterialForecastWindow, number>;
  shortageQty: Record<MaterialForecastWindow, number>;
  shortageValue: Record<MaterialForecastWindow, number>;
  shortageRowCount: number;
  criticalShortageCount: number;
  missingInventoryCount: number;
  etaMissingPoCount: number;
  invalidTaskCount: number;
}

export interface MaterialPlanningForecast {
  rows: MaterialForecastRow[];
  summary: MaterialPlanningSummary;
}

export interface MaterialPlanningDraftPo {
  poNumber: string;
  targetWarehouseId: string;
  expectedDeliveryDate?: string;
  sourceMode?: PurchaseOrderSourceMode;
  items: PurchaseOrderItem[];
  note?: string;
}

export interface ProjectMaterialRequest extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  requestNumber: string;        // Số phiếu: YC-001
  requestedBy: string;
  requestDate: string;
  items: { itemName: string; unit: string; qty: number; boqItemId?: string; note?: string }[];
  totalItems: number;
  status: MaterialRequestStatus;
  approvedBy?: string;
  approvedAt?: string;
  fulfilledAt?: string;
  note?: string;
  createdAt: string;
}

// ==================== CUNG ỨNG ====================
export type POStatus = 'draft' | 'sent' | 'confirmed' | 'in_transit' | 'partial' | 'delivered' | 'closed' | 'returned' | 'cancelled';
export type PurchaseOrderSourceMode = 'from_request' | 'proactive_project' | 'proactive_stock';

export interface ProjectVendor {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  name: string;
  contact: string;           // Người liên hệ
  phone: string;
  email?: string;
  address?: string;
  taxCode?: string;          // Mã số thuế
  rating: number;            // 1-5
  categories: string[];      // Loại vật tư cung cấp
  totalOrders?: number;
  totalValue?: number;
  notes?: string;
  createdAt: string;
}

export interface PurchaseOrder extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  vendorId: string;
  vendorName?: string;       // cache tên NCC
  poNumber: string;          // PO-001
  items: PurchaseOrderItem[];
  totalAmount: number;
  orderDate: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  status: POStatus;
  sourceMode?: PurchaseOrderSourceMode;
  procurementGroupId?: string | null;
  procurementGroupNo?: string | null;
  qrToken?: string;
  targetWarehouseId?: string;
  receivedTransactionIds?: string[];
  materialRequestId?: string;
  deliveryNote?: string;     // Ghi chú giao hàng
  note?: string;
  createdAt: string;
}

export interface PurchaseOrderItem {
  lineId?: string;
  itemId: string;
  vendorId?: string | null;
  vendorName?: string | null;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  receivedQty?: number;
  returnedQty?: number;
  neededDate?: string;
  workBoqItemId?: string | null;
  workBoqItemName?: string | null;
  materialBudgetItemId?: string | null;
  materialBudgetItemName?: string | null;
  requestId?: string | null;
  requestCode?: string | null;
  requestLineId?: string | null;
  budgetQtySnapshot?: number;
  reservedBeforeQtySnapshot?: number;
  previousRequestedQtySnapshot?: number;
  previousOrderedQtySnapshot?: number;
  previousReceivedQtySnapshot?: number;
  isOverBoq?: boolean;
  overQty?: number;
  overPercent?: number;
  overReason?: string;
  overBudgetQtySnapshot?: number;
  overBudgetPercentSnapshot?: number;
  overBudgetReason?: string;
  isManualItem?: boolean;
  itemNameSnapshot?: string;
  unitSnapshot?: string;
  stockUnitSnapshot?: string;
  purchaseUnitSnapshot?: string;
  purchaseConversionFactor?: number;
  specification?: string;
  manualReason?: string;
  note?: string;

  // Dynamic Technical Specs (stored in JSONB items, no DB migration needed)
  specs?: Record<string, { value: number | string; unit?: string; label?: string }>;
  pricingMode?: 'standard' | 'by_area' | 'by_length' | 'by_weight' | 'by_volume';
  computedArea?: number;
  computedWeight?: number;
  computedLineTotal?: number;
}

export type PurchaseOrderSupplierReturnStatus = 'pending' | 'completed' | 'cancelled';

export interface PurchaseOrderSupplierReturnLine {
  id: string;
  supplierReturnId: string;
  purchaseOrderLineId: string;
  itemId: string;
  receivedQtySnapshot: number;
  previouslyReturnedQtySnapshot: number;
  returnQty: number;
  unit?: string | null;
  unitPrice: number;
  createdAt: string;
}

export interface PurchaseOrderSupplierReturn {
  id: string;
  returnNo: string;
  purchaseOrderId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  vendorId?: string | null;
  sourceWarehouseId: string;
  status: PurchaseOrderSupplierReturnStatus;
  transactionId: string;
  reason: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
  completedBy?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  updatedAt: string;
  lines: PurchaseOrderSupplierReturnLine[];
}

export interface PurchaseOrderRequestLineLink {
  id?: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  materialRequestId: string;
  materialRequestCode?: string | null;
  requestLineId: string;
  itemId: string;
  workBoqItemId?: string | null;
  materialBudgetItemId?: string | null;
  requestedQty: number;
  orderedQty: number;
  unit?: string | null;
  note?: string | null;
  createdAt?: string;
}

export type OrgUnitType = 'company' | 'department' | 'construction_site' | 'factory' | 'custom';

export interface OrgUnit {
  id: string;
  name: string;
  type: OrgUnitType;
  customTypeLabel?: string; // User-defined type label when type='custom'
  parentId?: string | null;
  description?: string;
  orderIndex: number;
  color?: string;           // Optional accent color for 3D scene
  createdAt?: string;
}

export interface Employee {
  id: string;
  name?: string;
  employeeCode: string; // Mã nhân sự TT00x
  fullName: string;
  title: string;
  gender: 'Nam' | 'Nữ' | 'Khác';
  phone: string;
  email: string;
  dateOfBirth?: string;
  startDate?: string;
  officialDate?: string;
  status: 'Đang làm việc' | 'Đã nghỉ việc';
  userId?: string; // Liên kết tới bảng users
  // HRM Master Data FK fields
  areaId?: string;
  officeId?: string;
  employeeTypeId?: string;
  positionId?: string;
  salaryPolicyId?: string;
  workScheduleId?: string;
  constructionSiteId?: string;
  departmentId?: string;
  factoryId?: string;
  maritalStatus?: string;
  avatarUrl?: string; // URL ảnh đại diện nhân sự (Supabase Storage)
  orgUnitId?: string; // FK → org_units.id — dùng cho 3D Org Map (phòng ban / chi nhánh)
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemCategory {
  id: string;
  name: string;
}

export interface ItemUnit {
  id: string;
  name: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;          // Đơn vị tồn kho & xuất kho (VD: Cây, Cái, Tấm)
  purchaseUnit?: string; // Đơn vị mua hàng (VD: KG, Tấn) - khác với unit nếu có
  purchaseConversionFactor?: number; // 1 đơn vị mua = bao nhiêu đơn vị tồn kho; chiều ngược lại = số lượng tồn kho / hệ số
  priceIn: number;
  priceOut: number;
  minStock: number;
  defaultLeadTimeDays?: number;
  supplierId?: string; // Link to Supplier
  imageUrl?: string;
  location?: string; // Vị trí trong kho, ví dụ: Kệ A-3, Ô 2
  stockByWarehouse: Record<string, number>; // warehouseId -> quantity (in base unit)
}

export type MaterialCodeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface MaterialCodeRequest {
  id: string;
  code: string;
  requestedByUserId: string;
  requestedByName?: string | null;
  proposedName: string;
  proposedUnit: string;
  proposedCategory?: string | null;
  proposedSpecification?: string | null;
  proposedSupplierId?: string | null;
  reason: string;
  status: MaterialCodeRequestStatus;
  approvedSku?: string | null;
  approvedItemId?: string | null;
  approvedByUserId?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface TransactionItem {
  itemId: string;
  quantity: number;            // Số lượng theo đơn vị tồn kho (Cây, Cái...)
  price?: number;              // Snapshot giá tại thời điểm giao dịch
  materialRequestId?: string;
  requestLineId?: string;
  fulfillmentBatchId?: string;
  materialIssueOrderId?: string;
  materialIssueLineId?: string;
  materialIssueReturnId?: string;
  recipientType?: MaterialIssueRecipientType;
  recipientNameSnapshot?: string;
  varianceReason?: string;
  // --- Thông tin kế toán (chỉ áp dụng khi NHẬP KHO với đơn vị mua khác) ---
  accountingQty?: number;      // Số lượng theo đơn vị mua (VD: 10.05 KG)
  accountingUnit?: string;     // Đơn vị mua (VD: 'KG') - snapshot tại thời điểm nhập
  accountingPrice?: number;    // Đơn giá theo đơn vị mua (VD: 15000 VNĐ/KG)
}

export type MaterialIssueRecipientType = 'employee' | 'work_group' | 'subcontractor' | 'partner' | 'manual';

export type MaterialIssueStatus =
  | 'draft'
  | 'submitted'
  | 'wms_pending'
  | 'issued'
  | 'partially_received'
  | 'received'
  | 'settling'
  | 'partially_returned'
  | 'closed'
  | 'rejected'
  | 'cancelled';

export type MaterialIssueLedgerType =
  | 'issue'
  | 'receive_confirm'
  | 'return'
  | 'consume'
  | 'loss'
  | 'adjustment';

export interface MaterialIssueLine {
  id: string;
  issueOrderId: string;
  itemId: string;
  skuSnapshot?: string | null;
  itemNameSnapshot: string;
  unit?: string | null;
  requestedQty: number;
  approvedQty: number;
  issuedQty: number;
  receivedQty: number;
  consumedQty: number;
  returnedQty: number;
  lostQty: number;
  unitPrice: number;
  materialBudgetItemId?: string | null;
  materialRequestLineId?: string | null;
  workBoqItemId?: string | null;
  subcontractorContractId?: string | null;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaterialIssueReceiptLine {
  id: string;
  receiptId: string;
  issueLineId: string;
  itemId: string;
  receivedQty: number;
  varianceReason?: string | null;
  createdAt?: string;
}

export interface MaterialIssueReceipt {
  id: string;
  issueOrderId: string;
  receiptNo: string;
  status: 'confirmed' | 'cancelled';
  receivedBy?: string | null;
  receivedByName?: string | null;
  receivedAt: string;
  note?: string | null;
  signatureUrl?: string | null;
  attachments?: any[];
  createdAt?: string;
  lines?: MaterialIssueReceiptLine[];
}

export interface MaterialIssueReturnLine {
  id: string;
  issueReturnId: string;
  issueLineId: string;
  itemId: string;
  returnQty: number;
  unit?: string | null;
  reason?: string | null;
  createdAt?: string;
}

export interface MaterialIssueReturn {
  id: string;
  issueOrderId: string;
  returnNo: string;
  targetWarehouseId: string;
  status: 'pending' | 'completed' | 'cancelled';
  transactionId: string;
  reason: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
  completedBy?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  updatedAt?: string;
  lines?: MaterialIssueReturnLine[];
}

export interface MaterialIssueOrder {
  id: string;
  issueNo: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  sourceWarehouseId: string;
  recipientType: MaterialIssueRecipientType;
  recipientId?: string | null;
  recipientName: string;
  responsibleUserId?: string | null;
  subcontractorContractId?: string | null;
  materialRequestId?: string | null;
  workBoqItemId?: string | null;
  neededDate?: string | null;
  status: MaterialIssueStatus;
  transactionId?: string | null;
  qrToken?: string | null;
  note?: string | null;
  overrideReason?: string | null;
  attachments?: any[];
  createdBy?: string | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  issuedBy?: string | null;
  issuedAt?: string | null;
  closedBy?: string | null;
  closedAt?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lines: MaterialIssueLine[];
  receipts?: MaterialIssueReceipt[];
  returns?: MaterialIssueReturn[];
}

export interface MaterialPartyLedgerEntry {
  id: string;
  issueOrderId: string;
  issueLineId?: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  ledgerType: MaterialIssueLedgerType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  recipientType: MaterialIssueRecipientType;
  recipientId?: string | null;
  recipientName: string;
  itemId: string;
  itemNameSnapshot: string;
  unit?: string | null;
  quantityDelta: number;
  reason?: string | null;
  metadata?: Record<string, any>;
  createdBy?: string | null;
  createdAt?: string;
}

export interface MaterialPartyBalance {
  projectId?: string | null;
  constructionSiteId?: string | null;
  recipientType: MaterialIssueRecipientType;
  recipientId?: string | null;
  recipientName: string;
  itemId: string;
  itemNameSnapshot: string;
  unit?: string | null;
  balanceQty: number;
}

export interface Transaction {
  id: string;
  code?: string;
  type: TransactionType;
  date: string;
  items: TransactionItem[];
  sourceWarehouseId?: string; // For Export/Transfer
  targetWarehouseId?: string; // For Import/Transfer
  supplierId?: string; // For Import
  requesterId: string; // User requesting
  createdBy?: string;
  approverId?: string; // User approving
  status: TransactionStatus;
  note?: string;
  relatedRequestId?: string; // Link to MaterialRequest
  pendingItems?: InventoryItem[]; // Full metadata for new items created during bulk import
}

export type InventoryLedgerTransactionType =
  | 'purchase_receipt'
  | 'transfer_receipt'
  | 'project_return_receipt'
  | 'project_issue'
  | 'transfer_issue'
  | 'loss_issue'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'reversal';

export type InventoryLedgerMovementDirection = 'in' | 'out';

export interface InventoryTransactionLedgerHeader {
  id: string;
  code: string;
  transactionType: InventoryLedgerTransactionType;
  status: 'posted' | 'reversed';
  transactionDate: string;
  sourceType: string;
  sourceId: string;
  sourceCode: string;
  relatedRequestId?: string | null;
  projectId?: string | null;
  constructionSiteId?: string | null;
  description?: string | null;
  metadata?: Record<string, any>;
  createdBy?: string | null;
  approvedBy?: string | null;
  postedAt?: string | null;
  reversedAt?: string | null;
  reversalOfInventoryTransactionId?: string | null;
  createdAt?: string;
}

export interface InventoryLedgerEntry {
  id: string;
  inventoryTransactionId: string;
  entryNo: number;
  documentCode: string;
  transactionDate: string;
  transactionType: InventoryLedgerTransactionType;
  movementDirection: InventoryLedgerMovementDirection;
  materialId: string;
  warehouseId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  lotNo?: string | null;
  batchNo?: string | null;
  serialNo?: string | null;
  sourceType: string;
  sourceId: string;
  sourceCode: string;
  sourceLineId?: string | null;
  relatedRequestId?: string | null;
  quantityIn: number;
  quantityOut: number;
  quantityDelta: number;
  unit?: string | null;
  unitPrice: number;
  amount: number;
  balanceAfterQty: number;
  balanceAfterValue: number;
  description?: string | null;
  metadata?: Record<string, any>;
  createdBy?: string | null;
  approvedBy?: string | null;
  createdAt?: string;
}

export interface InventoryBalance {
  id: string;
  materialId: string;
  warehouseId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  lotNo?: string | null;
  batchNo?: string | null;
  serialNo?: string | null;
  onHandQty: number;
  totalValue: number;
  averageUnitCost: number;
  lastLedgerEntryId?: string | null;
  lastTransactionDate?: string | null;
  updatedAt?: string;
}

export interface AuditLog {
  action: string;
  userId: string;
  timestamp: string;
  note?: string;
  overrideReason?: string;
}

// ==================== LOSS MANAGEMENT ====================

export enum LossReason {
  NATURAL_LOSS = 'NATURAL_LOSS',       // Hao hụt tự nhiên
  DAMAGE = 'DAMAGE',                   // Hư hỏng
  THEFT = 'THEFT',                     // Thất thoát/mất cắp
  MEASUREMENT = 'MEASUREMENT',         // Sai lệch đo lường
  EXPIRED = 'EXPIRED',                 // Hết hạn/biến chất
  PROCESS_WASTE = 'PROCESS_WASTE',     // Hao hụt gia công
}

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  [LossReason.NATURAL_LOSS]: 'Hao hụt tự nhiên',
  [LossReason.DAMAGE]: 'Hư hỏng',
  [LossReason.THEFT]: 'Thất thoát / mất cắp',
  [LossReason.MEASUREMENT]: 'Sai lệch đo lường',
  [LossReason.EXPIRED]: 'Hết hạn / biến chất',
  [LossReason.PROCESS_WASTE]: 'Hao hụt gia công',
};

export interface MaterialLossNorm {
  id: string;
  itemId?: string;        // specific item (optional)
  categoryId?: string;    // or by category
  lossType: LossReason;
  allowedPercentage: number;  // % allowed loss
  period: 'monthly' | 'quarterly' | 'yearly';
  createdBy?: string;
  createdAt?: string;
}

export interface AuditSessionItem {
  itemId: string;
  itemName: string;
  sku: string;
  unit?: string;
  systemStock: number;
  actualStock: number;
  delta: number;
  lossReason?: LossReason;
  note?: string;
  exceedsNorm?: boolean;
  lossPercent?: number;
  normPercent?: number;
  lossValue?: number;
}

export interface AuditSession {
  id: string;
  warehouseId: string;
  warehouseName: string;
  date: string;
  auditorId: string;
  auditorName: string;
  items: AuditSessionItem[];
  totalItems: number;
  totalDiscrepancies: number;
  totalExceedNorm: number;
  totalLossValue: number;
  transactionId?: string;
}

// New Global Activity Structure
export type ActivityType = 'TRANSACTION' | 'INVENTORY' | 'REQUEST' | 'SYSTEM';

export interface GlobalActivity {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  type: ActivityType;
  action: string;
  description: string;
  timestamp: string;
  warehouseId?: string; // ID kho liên quan để lọc nhật ký
  status?: 'SUCCESS' | 'WARNING' | 'INFO' | 'DANGER';
}

export interface RequestItem {
  lineId?: string;
  itemId: string;
  requestQty: number;
  approvedQty: number; // Số lượng cam kết/cấp duyệt, thực xuất tính từ fulfillment batches
  issuedQty?: number;
  orderedQty?: number;
  procurementQty?: number;
  fulfillmentStatus?: 'pending' | 'approved_for_issue' | 'issued' | 'procurement_required' | 'ordered' | 'fulfilled';
  workBoqItemId?: string | null;
  workBoqItemName?: string | null;
  materialBudgetItemId?: string | null;
  materialBudgetItemName?: string | null;
  neededDate?: string;
  note?: string;
  budgetQtySnapshot?: number;
  reservedBeforeQtySnapshot?: number;
  previousRequestedQtySnapshot?: number;
  previousOrderedQtySnapshot?: number;
  previousReceivedQtySnapshot?: number;
  isOverBoq?: boolean;
  overQty?: number;
  overPercent?: number;
  overReason?: string;
  overBudgetQtySnapshot?: number;
  overBudgetPercentSnapshot?: number;
  overBudgetReason?: string;
  isManualItem?: boolean;
  itemNameSnapshot?: string;
  unitSnapshot?: string;
  skuSnapshot?: string;
  specification?: string;
  manualReason?: string;
}

export interface MaterialRequestBoqLineSnapshot {
  id?: string;
  requestId: string;
  requestLineId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  workBoqItemId?: string | null;
  materialBudgetItemId: string;
  inventoryItemId?: string | null;
  itemNameSnapshot?: string | null;
  unitSnapshot?: string | null;
  requestQty: number;
  budgetQtySnapshot: number;
  reservedBeforeQty: number;
  isOverBoq: boolean;
  overQty: number;
  overPercent: number;
  overReason?: string | null;
  requestStatusSnapshot?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type MaterialRequestFulfillmentBatchStatus = 'draft' | 'issued' | 'received' | 'variance_pending' | 'returned' | 'cancelled';
export type MaterialRequestFulfillmentSourceType = 'stock' | 'po_receipt' | 'mixed';

export interface MaterialRequestFulfillmentLine {
  id: string;
  batchId: string;
  materialRequestId: string;
  requestLineId: string;
  itemId: string;
  materialBudgetItemId?: string | null;
  workBoqItemId?: string | null;
  poId?: string | null;
  poLineId?: string | null;
  requestedQtySnapshot: number;
  committedQtySnapshot: number;
  issuedQty: number;
  receivedQty: number;
  unit?: string | null;
  varianceReason?: string | null;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaterialRequestFulfillmentBatch {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  materialRequestId: string;
  batchNo: string;
  batchDate: string;
  sourceWarehouseId?: string | null;
  targetWarehouseId?: string | null;
  fulfillmentMode: MaterialRequestFulfillmentMode;
  sourceType: MaterialRequestFulfillmentSourceType;
  status: MaterialRequestFulfillmentBatchStatus;
  transactionId?: string | null;
  qrToken?: string | null;
  reason?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  issuedBy?: string | null;
  issuedAt?: string | null;
  receivedBy?: string | null;
  receivedAt?: string | null;
  cancelReason?: string | null;
  updatedAt?: string;
  lines: MaterialRequestFulfillmentLine[];
}

export interface MaterialRequestLineFulfillmentSummary {
  materialRequestId: string;
  requestLineId: string;
  itemId: string;
  requestedQty: number;
  committedQty: number;
  orderedQty: number;
  issuedQty: number;
  receivedQty: number;
  remainingToIssue: number;
  remainingToReceive: number;
}

export interface MaterialRequestFulfillmentSummary {
  materialRequestId: string;
  requestedQty: number;
  committedQty: number;
  orderedQty: number;
  issuedQty: number;
  receivedQty: number;
  remainingToIssue: number;
  remainingToReceive: number;
  lineSummaries: MaterialRequestLineFulfillmentSummary[];
}

export interface MaterialRequest extends ProjectSubmissionFields {
  id: string;
  code: string; // e.g., MR-2023-001
  projectId?: string | null;
  constructionSiteId?: string | null;
  requestOrigin?: MaterialRequestOrigin;
  siteWarehouseId: string; // Kho công trường yêu cầu
  sourceWarehouseId?: string; // Kho cung cấp (thường là kho tổng)
  requesterId: string;
  requestedBy?: string;
  status: RequestStatus;
  items: RequestItem[];
  createdDate: string;
  date?: string;
  expectedDate: string;
  note?: string;
  fulfillmentMode?: MaterialRequestFulfillmentMode;
  overrideReason?: string;
  relatedTransactionId?: string;
  logs: AuditLog[];
}

export interface Stats {
  totalValue: number;
  lowStockCount: number;
  pendingRequests: number;
  monthlyFlow: { name: string; in: number; out: number }[];
}

// ==================== WORKFLOW MODULE ====================

export enum WorkflowNodeType {
  START = 'START',
  ACTION = 'ACTION',
  APPROVAL = 'APPROVAL',
  END = 'END',
}

export enum WorkflowInstanceStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum WorkflowInstanceAction {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  REOPENED = 'REOPENED',
}

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'file';

export type ProjectWorkflowSubjectType = 'material_request';
export type ProjectWorkflowSubjectStatus = 'RUNNING' | 'RETURNED' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export type WorkflowStepAssignmentStatus = 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'SKIPPED';
export type ProjectWorkflowAction = 'approve' | 'return' | 'reject' | 'resubmit' | 'reassign' | 'rollback';
export type WorkflowParticipantRole = 'ADMIN' | 'WATCHER' | 'CREATOR' | 'ASSIGNEE';
export type WorkflowApprovalPolicy = 'ANY_ONE';
export type ProjectWorkflowBindingScope = 'global' | 'project' | 'site';
export type WorkflowAssignmentTargetType = 'user' | 'department' | 'project_permission' | 'creator';
export type ProjectWorkflowAssignmentMode =
  | 'select_on_submit'
  | 'select_on_transition'
  | 'fixed_user'
  | 'permission_pool'
  | 'previous_assignee'
  | 'creator';

export interface WorkflowAssignmentTarget {
  type: WorkflowAssignmentTargetType;
  userId?: string;
  orgUnitId?: string;
  permissionCode?: string;
}

export interface ProjectWorkflowNodeConfig {
  assigneeRole?: Role;
  assigneeUserId?: string;
  formFields?: { name: string; label: string; type: 'text' | 'number' | 'textarea'; required?: boolean }[];
  slaHours?: number;
  assignmentMode?: ProjectWorkflowAssignmentMode;
  approvalPolicy?: WorkflowApprovalPolicy;
  assignmentTargets?: WorkflowAssignmentTarget[];
  stepWatcherTargets?: WorkflowAssignmentTarget[];
  eligiblePermissionCodes?: string[];
  eligibleRole?: Role | null;
  returnPolicy?: 'to_creator' | 'previous_step';
  allowReject?: boolean;
  allowReassign?: boolean;
}

export interface WorkflowRuntimeNode {
  id: string;
  workflowInstanceId: string;
  templateVersionId?: string | null;
  templateNodeId?: string | null;
  type: WorkflowNodeType;
  label: string;
  config: ProjectWorkflowNodeConfig;
  positionX: number;
  positionY: number;
  createdAt?: string;
}

export interface WorkflowRuntimeEdge {
  id: string;
  workflowInstanceId: string;
  templateVersionId?: string | null;
  templateEdgeId?: string | null;
  sourceInstanceNodeId: string;
  targetInstanceNodeId: string;
  label?: string | null;
  sortOrder: number;
  createdAt?: string;
}

export interface WorkflowCustomField {
  id: string;
  name: string;        // key identifier (e.g., "bo_phan")
  label: string;       // Display label (e.g., "Bộ phận/Công trường")
  type: CustomFieldType;
  required: boolean;
  options?: string[];   // For 'select' type
  placeholder?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  createdBy: string; // user id
  isActive: boolean;
  customFields: WorkflowCustomField[];
  managers: string[];         // user IDs — admin-like except delete
  defaultWatchers: string[];  // user IDs — view-only on all instances
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  templateId: string;
  type: WorkflowNodeType;
  label: string;
  config: ProjectWorkflowNodeConfig;
  positionX: number;
  positionY: number;
}

export interface ProjectWorkflowSubject {
  id: string;
  workflowInstanceId?: string | null;
  workflowSubjectId?: string | null;
  workflowTemplateId?: string | null;
  templateVersionId?: string | null;
  subjectType: ProjectWorkflowSubjectType;
  subjectId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  currentAssigneeUserId?: string | null;
  currentAssigneeUserIds?: string[];
  currentNodeId?: string | null;
  currentInstanceNodeId?: string | null;
  status: ProjectWorkflowSubjectStatus;
  returnToNodeId?: string | null;
  returnToInstanceNodeId?: string | null;
  lastActionInstanceNodeId?: string | null;
  returnToAssigneeUserId?: string | null;
  returnToAssigneeUserIds?: string[];
  returnedByUserId?: string | null;
  returnedAt?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  currentNode?: WorkflowNode | null;
  currentRuntimeNode?: WorkflowRuntimeNode | null;
  workflowInstance?: WorkflowInstance | null;
  participants?: WorkflowParticipant[];
}

export interface WorkflowStepAssignment {
  id: string;
  workflowSubjectId: string;
  workflowInstanceId?: string | null;
  nodeId?: string | null;
  instanceNodeId?: string | null;
  assigneeUserId?: string | null;
  assignedBy?: string | null;
  status: WorkflowStepAssignmentStatus;
  assignedAt: string;
  actedAt?: string | null;
  actionComment?: string | null;
  returnToNodeId?: string | null;
  dueAt?: string | null;
  slaHours?: number | null;
  assignmentSource?: string | null;
  assignmentGroupType?: string | null;
  assignmentGroupId?: string | null;
  assignmentRoundId?: string | null;
  metadata?: Record<string, any>;
}

export interface ProjectWorkflowActionContext {
  action: ProjectWorkflowAction;
  subject: ProjectWorkflowSubject;
  nextNode?: WorkflowNode | null;
  assigneeUserId?: string | null;
  assigneeUserIds?: string[];
  assigneeNames?: string[];
  comment?: string;
}

export interface WorkflowParticipant {
  id: string;
  workflowSubjectId: string;
  workflowInstanceId?: string | null;
  userId: string;
  role: WorkflowParticipantRole;
  source?: string;
  sourceRef?: string | null;
  nodeId?: string | null;
  instanceNodeId?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  isActive: boolean;
}

export interface ProjectWorkflowRollbackDependencyResult {
  allowed: boolean;
  activeCount: number;
  dependencies: Array<{
    type: string;
    id?: string;
    status: 'active' | 'reversed' | 'cancelled' | 'returned' | 'void' | string;
    source?: string;
    relationType?: string;
  }>;
}

export interface ProjectWorkflowBinding {
  id: string;
  subjectType: ProjectWorkflowSubjectType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  workflowTemplateId: string;
  isDefault: boolean;
  isActive: boolean;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  workflowTemplate?: WorkflowTemplate | null;
}

export interface ProjectWorkflowConfiguration {
  subjectType: ProjectWorkflowSubjectType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  binding?: ProjectWorkflowBinding | null;
  scope?: ProjectWorkflowBindingScope | null;
  valid: boolean;
  errors: string[];
  canManage: boolean;
  validation?: {
    valid: boolean;
    errors: string[];
    startCount?: number;
    endCount?: number;
    taskCount?: number;
  };
}

export interface ProjectWorkflowRuntimeContext {
  subject: ProjectWorkflowSubject;
  nodes: WorkflowRuntimeNode[];
  edges: WorkflowRuntimeEdge[];
}

export interface ProjectWorkflowCommentAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  kind: 'image' | 'file';
  uploadedAt?: string;
}

export interface ProjectWorkflowComment {
  id: string;
  workflowSubjectId: string;
  workflowInstanceId?: string | null;
  subjectType: ProjectWorkflowSubjectType;
  subjectId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  authorUserId: string;
  body: string;
  attachments?: ProjectWorkflowCommentAttachment[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

export type ProjectWorkflowBoardFilter = 'all' | 'mine' | 'overdue' | 'returned' | 'watching';
export type WorkflowTemplateLifecycleStatus = 'draft' | 'published' | 'deactivated';

export interface MaterialRequestWorkflowBoardCard {
  id: string;
  code?: string;
  status?: RequestStatus | string;
  workflowStep?: MaterialRequestWorkflowStep | string | null;
  workflowStepStartedAt?: string | null;
  workflowStepDueAt?: string | null;
  workflowStepSlaHours?: number | null;
  projectId?: string | null;
  constructionSiteId?: string | null;
  requesterId?: string | null;
  requesterName?: string | null;
  submittedToUserId?: string | null;
  submittedToName?: string | null;
  createdDate?: string | null;
  expectedDate?: string | null;
  itemCount?: number;
  itemPreview?: RequestItem[];
  subject?: Partial<ProjectWorkflowSubject> & {
    currentNodeLabel?: string | null;
    currentNodeType?: string | null;
  } | null;
  currentRuntimeNode?: Partial<WorkflowRuntimeNode> | null;
  currentAssignees?: Array<{ id: string; name?: string | null }>;
  slaState?: 'none' | 'normal' | 'urgent' | 'overdue';
  fulfillmentSummary?: {
    batchCount: number;
    activeBatchCount: number;
    committedQty: number;
    issuedQty: number;
    receivedQty: number;
  };
  eventPreview?: Array<{
    id: string;
    action: string;
    actorUserId?: string | null;
    targetUserId?: string | null;
    note?: string | null;
    createdAt?: string | null;
  }>;
  downstream?: {
    activeCount: number;
    totalCount: number;
  };
}

export type MaterialRequestBoardCard = MaterialRequestWorkflowBoardCard;

export interface MaterialRequestBoardFilters {
  filter?: ProjectWorkflowBoardFilter;
  search?: string;
  status?: string;
  stage?: string;
  mineOnly?: boolean;
  overdueOnly?: boolean;
  returnedOnly?: boolean;
  watchingOnly?: boolean;
}

export interface MaterialRequestBoardPage {
  cards: MaterialRequestBoardCard[];
  cursor?: string | null;
  nextCursor?: string | null;
}

export interface MaterialRequestDetailResult {
  request: MaterialRequest;
  workflowSubject?: ProjectWorkflowSubject | null;
  runtimeContext?: ProjectWorkflowRuntimeContext | null;
  assignments: WorkflowStepAssignment[];
  fulfillmentBatches: MaterialRequestFulfillmentBatch[];
  events: MaterialRequestEvent[];
}

export interface ProjectWorkflowTimelineEntry {
  kind: 'assignment' | 'event';
  id: string;
  workflowSubjectId?: string;
  workflowInstanceId?: string | null;
  nodeId?: string | null;
  instanceNodeId?: string | null;
  assignmentRoundId?: string | null;
  nodeLabel?: string | null;
  nodeType?: string | null;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  assignedBy?: string | null;
  assignedByName?: string | null;
  status?: WorkflowStepAssignmentStatus | string;
  assignedAt?: string | null;
  actedAt?: string | null;
  actionComment?: string | null;
  action?: string;
  actorUserId?: string | null;
  actorName?: string | null;
  targetUserId?: string | null;
  targetName?: string | null;
  note?: string | null;
  dueAt?: string | null;
  slaHours?: number | null;
  metadata?: Record<string, any>;
  createdAt?: string | null;
}

export interface ProjectWorkflowActionContextResult {
  subjectType: ProjectWorkflowSubjectType;
  subjectId: string;
  workflowSubjectId: string;
  status: ProjectWorkflowSubjectStatus;
  currentNode?: Partial<WorkflowRuntimeNode | WorkflowNode> | null;
  nextNode?: Partial<WorkflowRuntimeNode | WorkflowNode> | null;
  returnTargetNode?: Partial<WorkflowRuntimeNode | WorkflowNode> | null;
  pendingAssigneeUserIds: string[];
  isPendingAssignee: boolean;
  isWorkflowAdmin: boolean;
  isWatcher: boolean;
  isCreator: boolean;
  canApprove: boolean;
  canReturn: boolean;
  canReject: boolean;
  canResubmit: boolean;
  canReassign: boolean;
  canRollback: boolean;
  rollbackDependencies?: ProjectWorkflowRollbackDependencyResult | null;
}

export interface InventoryLedgerStockReportRow {
  id: string;
  sku: string;
  name: string;
  unit?: string | null;
  opening: number;
  inImport: number;
  inTransfer: number;
  inAdjustment: number;
  totalIn: number;
  outExport: number;
  outTransfer: number;
  outLiquidation: number;
  totalOut: number;
  closing: number;
  value: number;
}

export interface InventoryLedgerWarehouseReportRow {
  key?: string;
  warehouseId: string;
  materialId: string;
  warehouseName?: string | null;
  materialName?: string | null;
  sku?: string | null;
  unit?: string | null;
  inQty: number;
  outQty: number;
  balanceQty: number;
  lastDate?: string | null;
}

export interface InventoryLedgerReportResult {
  summary: {
    opening: number;
    totalIn: number;
    totalOut: number;
    closing: number;
    totalValue: number;
  };
  stockRows: InventoryLedgerStockReportRow[];
  warehouseRows: InventoryLedgerWarehouseReportRow[];
  entriesPage: InventoryLedgerEntry[];
  nextCursor?: string | null;
  available: boolean;
}

export interface WorkflowDelegationRule {
  id: string;
  delegatorUserId: string;
  delegateUserId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowAnalyticsSummary {
  totalRunning: number;
  overdueCount: number;
  returnedCount: number;
  watcherCount: number;
  byStep: Array<{ stepId: string; label: string; count: number; overdueCount: number }>;
  workloadByUser: Array<{ userId: string; name?: string; pendingCount: number; overdueCount: number }>;
}

export interface WorkflowEdge {
  id: string;
  templateId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
}

export interface WorkflowInstance {
  id: string;
  templateId: string;
  templateVersionId?: string | null;
  code: string;
  title: string;
  createdBy: string; // user id
  currentNodeId: string | null;
  currentInstanceNodeId?: string | null;
  status: WorkflowInstanceStatus;
  formData: Record<string, any>;
  watchers: string[];  // user IDs — view + comment only
  stepAssignees?: Record<string, string | string[]>; // node id -> assigned user id(s)
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstanceLog {
  id: string;
  instanceId: string;
  nodeId: string;
  action: WorkflowInstanceAction;
  actedBy: string; // user id
  comment: string;
  createdAt: string;
}

export interface WorkflowPrintTemplate {
  id: string;
  templateId: string;
  name: string;
  fileName: string;
  storagePath: string;
  createdAt: string;
}

// ==================== REQUEST MODULE ====================

export enum RQStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export type RQPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface RequestCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  customFields: WorkflowCustomField[]; // reuse from Workflow
  approverRole?: Role;
  approverUserId?: string;
  slaHours?: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestApprover {
  userId: string;
  order: number;
  status: 'waiting' | 'approved' | 'rejected';
  comment?: string;
  actedAt?: string;
}

export interface RequestInstance {
  id: string;
  categoryId: string;
  code: string;
  title: string;
  description: string;
  priority: RQPriority;
  formData: Record<string, any>;
  createdBy: string;
  approverId?: string;
  approvers: RequestApprover[];
  assignedTo?: string;
  status: RQStatus;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestLog {
  id: string;
  requestId: string;
  action: string;
  actedBy: string;
  comment: string;
  createdAt: string;
}

export interface RequestPrintTemplate {
  id: string;
  categoryId: string;
  name: string;
  fileName: string;
  storagePath: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== CHAT ====================
export type ChatConversationType = 'direct' | 'group' | 'channel_text' | 'channel_voice';
export type ChatChannelKind = 'text' | 'voice';
export type ChatWorkspaceRole = 'owner' | 'admin' | 'member';
export type ChatUserStatus = 'online' | 'busy' | 'away' | 'offline';

export interface ChatWorkspace {
  id: string;
  name: string;
  iconText?: string | null;
  color?: string | null;
  description?: string | null;
  isPublic?: boolean;
  sortOrder?: number;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  members?: ChatWorkspaceMember[];
}

export interface ChatWorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: ChatWorkspaceRole;
  joinedAt: string;
  leftAt?: string | null;
}

export interface ChatConversation {
  id: string;
  type: ChatConversationType;
  name?: string;
  workspaceId?: string | null;
  channelKind?: ChatChannelKind | null;
  description?: string | null;
  sortOrder?: number;
  avatarUrl?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  // Computed (local only)
  members?: ChatMember[];
  lastMessage?: ChatMessage;
  unreadCount?: number;
}

export interface ChatMember {
  id: string;
  conversationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  lastReadAt: string;
  joinedAt: string;
  leftAt?: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  content?: string;
  type: 'text' | 'image' | 'file' | 'system';
  attachments?: { url: string; name: string; type: string; size?: number }[];
  reactions?: Record<string, string[]>; // emoji -> userIds
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  recalledAt?: string | null;
  recalledBy?: string | null;
  replyToId?: string;
  replyToPreview?: { senderId: string; senderName: string; content: string } | null;
  fileUrls?: string[];
}

export type ChatThemeName = 'discord' | 'light' | 'rose' | 'cyberpunk';

export interface ChatUserSettings {
  userId: string;
  theme: ChatThemeName;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  defaultMuted: boolean;
  defaultDeafened: boolean;
  status: ChatUserStatus;
  lastWorkspaceId?: string | null;
}

export interface ChatCallSession {
  id: string;
  conversationId: string;
  startedBy: string;
  mode: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'cancelled';
  startedAt: string;
  endedAt?: string | null;
  endedBy?: string | null;
  durationSeconds?: number | null;
}

// ==================== ATTACHMENT CHUẨN ====================
// Interface dùng chung cho tất cả các module cần đính kèm file.
// AssetAttachment, MaintenanceAttachment, ContractAttachment kế thừa từ đây.
export interface Attachment {
  id?: string;
  name: string;          // Tên hiển thị
  fileName?: string;     // Tên file gốc
  url: string;           // Public URL hoặc storagePath
  fileType?: string;     // pdf, docx, jpg...
  fileSize?: number;     // bytes
  category?: string;     // invoice | contract | manual | other
  uploadedAt?: string;
  uploadedBy?: string;
}

// ==================== QUẢN LÝ CHẤT LƯỢNG (Quality Management) ====================

export type QualityCheckResult = 'pass' | 'fail' | 'conditional';
export type QualityConclusionResult = 'accepted' | 'conditional' | 'rejected';
export type QualityChecklistStatus = 'draft' | 'submitted' | 'approved' | 'returned' | 'cancelled';
export type InspectionResult = 'PASSED' | 'FAILED';

// ---- Inspection Template (metadata-driven V2) ----

export interface InspectionCategory {
  id: string;
  code: string;
  name: string;
}

export interface InspectionWorkType {
  id: string;
  categoryId: string;
  code: string;
  name: string;
}

export interface InspectionTemplate {
  id: string;
  workTypeId: string;
  code: string;
  name: string;
  version: number;
  standardReference?: string;
  description?: string;
  isActive: boolean;
  inspectionPurpose?: string;
  riskLevel: 'low' | 'medium' | 'high';
  discipline: 'civil' | 'steel' | 'mep' | 'finishing' | string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  sections?: InspectionTemplateSection[];
}

export interface InspectionTemplateSection {
  id: string;
  templateId: string;
  name: string;
  sortOrder: number;
  items?: InspectionTemplateItem[];
}

export type InspectionItemType = 'checkbox' | 'number' | 'text' | 'photo';

export interface InspectionTemplateItem {
  id: string;
  sectionId: string;
  itemName: string;
  acceptanceCriteria?: string;
  inspectionMethod?: string;
  required: boolean;
  dataType: InspectionItemType;
  minValue?: number;
  maxValue?: number;
  unit?: string;
  sortOrder: number;
}

// ---- Cloned checklist items (stored in JSONB, dynamically structured) ----

export interface QualityChecklistClonedItem {
  id: string;
  itemName: string;
  acceptanceCriteria?: string;
  inspectionMethod?: string;
  required: boolean;
  dataType: InspectionItemType;
  minValue?: number;
  maxValue?: number;
  unit?: string;
  sortOrder: number;
  actualValue?: string; // giá trị thực tế nhập
  result?: 'pass' | 'fail'; // kết quả tự động / bằng tay
  note?: string;
  photoUrl?: string; // URL ảnh bằng chứng cho tiêu chí này
  isCustom?: boolean; // tiêu chí phát sinh tại hiện trường
}

export interface QualityChecklistClonedSection {
  sectionId: string;
  sectionName: string;
  sortOrder: number;
  items: QualityChecklistClonedItem[];
}

export interface QualitySitePhoto {
  url: string;
  caption?: string;
  category?: 'before' | 'during' | 'after' | 'defect';
  takenAt?: string;
}

export interface QualityInspectionAttempt {
  id: string;
  checklistId: string;
  attemptNumber: number;
  inspectionDate: string;
  inspectorName?: string;
  itemsData: QualityChecklistClonedSection[]; // snapshot tại lần kiểm tra này
  result: 'PASSED' | 'FAILED';
  conclusion?: string;
  signatureUrl?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface DrawingMarker {
  id: string;
  x: number; // percentage width (0 to 100)
  y: number; // percentage height (0 to 100)
  label: string;
  status: 'pass' | 'fail' | 'pending';
  note?: string;
}

export interface SignerData {
  roleCode: 'inspector' | 'contractor' | 'supervisor' | 'completion';
  roleName: string;
  userName?: string;
  signatureUrl?: string;
  signedAt?: string;
}

// ---- Main Quality Checklist (hồ sơ chất lượng) ----

export interface QualityChecklist extends ProjectSubmissionFields {
  id: string;
  projectId?: string | null;
  constructionSiteId: string;
  taskId?: string | null;
  contractItemId?: string | null;
  dailyLogId?: string | null;
  templateId?: string | null;
  workTypeId?: string | null;
  code: string;
  title: string;
  
  // Template clone info (snapshot)
  templateCode?: string;
  templateName?: string;
  templateVersion?: number;
  
  // 1. Thông tin công việc
  workDescription?: string;
  workLocation?: string;
  workDate?: string;
  workSupervisor?: string;
  
  // 2 - 5. Dữ liệu động gom hết vào checklistData
  checklistData: QualityChecklistClonedSection[];
  
  // 4. Hình ảnh hiện trường (cấu trúc cũ giữ lại để tương thích upload chung)
  sitePhotos: QualitySitePhoto[];
  
  // 5. Tài liệu đính kèm
  attachments: Attachment[];
  
  // 6. Kết luận nghiệm thu
  conclusion?: string;
  conclusionResult?: QualityConclusionResult;
  conditions?: string;
  inspectorName?: string;
  inspectorSignUrl?: string;
  approverName?: string;
  approverSignUrl?: string;
  
  // Auto-calculated & Attempts
  inspectionResult?: InspectionResult;
  totalCriteria?: number;
  passedCriteria?: number;
  failedCriteria?: number;
  currentAttempt: number;
  
  // Workflow
  status: QualityChecklistStatus;
  submittedBy?: string | null;
  submittedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  returnedBy?: string | null;
  returnedAt?: string | null;
  returnReason?: string | null;
  
  // Cross-references
  linkedAcceptanceId?: string | null;
  linkedPaymentCertId?: string | null;
  linkedMaterialRequestIds?: string[];
  linkedPoIds?: string[];
  
  note?: string;
  createdBy?: string;
  createdAt: string;

  // PDF layout enhancements
  drawingUrl?: string;
  drawingMarkers?: DrawingMarker[];
  targetCompletionDate?: string;
  signersData?: SignerData[];
  standardReference?: string;
}

// ==================== TÀI SẢN CỐ ĐỊNH (ASSETS) ====================

export enum AssetStatus {
  AVAILABLE = 'AVAILABLE',       // Chờ cấp phát
  PARTIAL = 'PARTIAL',           // Phân bổ một phần (cho lô)
  IN_USE = 'IN_USE',             // Đang sử dụng
  MAINTENANCE = 'MAINTENANCE',   // Đang bảo trì
  BROKEN = 'BROKEN',             // Hỏng
  DISPOSED = 'DISPOSED',         // Đã thanh lý
}

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  [AssetStatus.AVAILABLE]: 'Chờ cấp phát',
  [AssetStatus.PARTIAL]: 'Phân bổ 1 phần',
  [AssetStatus.IN_USE]: 'Đang sử dụng',
  [AssetStatus.MAINTENANCE]: 'Đang bảo trì',
  [AssetStatus.BROKEN]: 'Hỏng',
  [AssetStatus.DISPOSED]: 'Đã thanh lý',
};

export type AssetOrigin = 'purchase' | 'transfer_in' | 'donation' | 'leased' | 'other';

export const ASSET_ORIGIN_LABELS: Record<AssetOrigin, string> = {
  purchase: 'Mua mới',
  transfer_in: 'Điều chuyển',
  donation: 'Viện trợ / Tặng',
  leased: 'Thuê',
  other: 'Khác',
};

export type AssetCategoryType = 'machinery' | 'equipment' | 'vehicle' | 'it' | 'furniture' | 'other';

export const ASSET_CATEGORY_LABELS: Record<AssetCategoryType, string> = {
  machinery: 'Máy móc',
  equipment: 'Thiết bị',
  vehicle: 'Phương tiện',
  it: 'CNTT',
  furniture: 'Nội thất',
  other: 'Khác',
};

export interface AssetCategory {
  id: string;
  name: string;
  type: AssetCategoryType;
  depreciationYears: number; // Số năm khấu hao mặc định
}

export interface AssetAttachment {
  id: string;
  assetId: string;
  name: string;
  url: string;
  type?: string;
  size?: number;
  category?: 'invoice' | 'contract' | 'manual' | 'other';
  uploadedAt: string;
  uploadedBy?: string;
}

export interface AssetLocationStock {
  id: string;
  assetId: string;
  warehouseId?: string;
  constructionSiteId?: string;
  deptId?: string;
  qty: number;
  assignedToUserId?: string;
  assignedToName?: string;
  note?: string;
  updatedAt: string;
}

export interface AssetTransfer {
  id: string;
  code: string;
  assetId: string;
  assetCode?: string;
  assetName?: string;
  qty: number;
  fromWarehouseId?: string;
  fromSiteId?: string;
  fromDeptId?: string;
  fromLocationLabel?: string;
  toWarehouseId?: string;
  toSiteId?: string;
  toDeptId?: string;
  toLocationLabel?: string;
  receivedByUserId?: string;
  receivedByName?: string;
  date: string;
  reason?: string;
  status: 'pending' | 'completed' | 'cancelled';
  performedBy?: string;
  performedByName?: string;
  note?: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  code: string;              // Mã tài sản: TS-001
  assetCode?: string;
  name: string;
  categoryId: string;
  brand?: string;            // Nhãn hiệu
  model?: string;            // Model
  serialNumber?: string;     // Số serial
  status: AssetStatus;

  // Phân loại
  assetType?: 'single' | 'batch' | 'bundle';
  quantity?: number;         // Tổng SL (batch), default 1
  unit?: string;

  // Phân cấp cha/con
  parentId?: string;         // FK → Asset.id
  childIndex?: number;
  isBundle?: boolean;        // Là tài sản bộ/set

  // Quản lý & phân bổ
  managedByUserId?: string;
  managedByName?: string;
  managingDeptId?: string;
  managingDeptName?: string;
  constructionSiteId?: string;

  // Nguồn gốc & Loại
  assetOrigin?: AssetOrigin;
  isFixedAsset?: boolean;
  isLeased?: boolean;
  leasedFrom?: string;
  leaseEndDate?: string;

  // Mua sắm & Bảo hành
  supplierId?: string;
  supplierName?: string;
  contractNumber?: string;
  invoiceNumber?: string;
  warrantyCondition?: string;
  warrantyProvider?: string;
  warrantyContact?: string;

  // Tài chính
  originalValue: number;     // Nguyên giá
  purchaseDate: string;      // Ngày mua
  depreciationYears: number; // Thời gian khấu hao (năm)
  warrantyMonths?: number;   // Thời gian bảo hành (tháng)
  residualValue: number;     // Giá trị thanh lý dự kiến

  // Vị trí (cho single asset)
  warehouseId?: string;      // Kho lưu trữ hiện tại
  locationNote?: string;     // Ghi chú vị trí

  // Cấp phát hiện tại (chủ yếu cho single)
  assignedToUserId?: string;
  assignedToName?: string;
  assignedDate?: string;

  // Thanh lý
  disposalDate?: string;
  disposalValue?: number;
  disposalNote?: string;

  imageUrl?: string;
  note?: string;
  attachments?: AssetAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetAssignment {
  id: string;
  assetId: string;
  assetCode?: string;
  employeeId?: string;
  type: 'assign' | 'return' | 'transfer';  // Cấp phát / Thu hồi / Luân chuyển
  userId: string;              // Người nhận (hoặc người nhận mới khi transfer)
  userName: string;
  fromUserId?: string;         // Người giao (khi luân chuyển)
  fromUserName?: string;       // Tên người giao (khi luân chuyển)
  deptId?: string;             // Phòng ban cấp phát/luân chuyển
  deptName?: string;
  siteId?: string;             // Công trường
  siteName?: string;
  qty?: number;                // Số lượng (nếu là batch)
  date: string;
  assignedDate?: string;
  returnedDate?: string;
  note?: string;
  performedBy: string;         // Admin/Keeper thực hiện
  performedByName: string;
}

export interface MaintenanceAttachment {
  id: string;
  name: string;       // Tên file (hoá đơn, chứng từ)
  url: string;         // Data URL or blob URL
  type: string;        // MIME type
  size: number;        // File size in bytes
  uploadedAt: string;
}

export interface AssetMaintenance {
  id: string;
  assetId: string;
  type: 'scheduled' | 'repair' | 'inspection' | 'warranty'; // Bảo trì định kỳ / Sửa chữa / Kiểm tra / Bảo hành
  description: string;
  cost: number;                  // Legacy — tổng chi phí (dùng actualCost nếu có, fallback estimatedCost)
  estimatedCost?: number;        // Chi phí dự kiến (theo báo giá)
  actualCost?: number;           // Chi phí thực tế
  vendor?: string;               // Đơn vị sửa chữa
  invoiceNumber?: string;        // Số hoá đơn
  startDate: string;
  endDate?: string;
  status: 'planned' | 'in_progress' | 'completed';
  performedBy: string;
  performedByName?: string;
  note?: string;
  attachments?: MaintenanceAttachment[];  // Hoá đơn, chứng từ đính kèm
}

// ==================== HRM CHẤM CÔNG & LƯƠNG (PHASE 5A) ====================

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'half_day' | 'leave' | 'holiday' | 'business_trip';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Đi làm',
  late: 'Đi muộn',
  absent: 'Vắng',
  half_day: 'Nửa ngày',
  leave: 'Nghỉ phép',
  holiday: 'Lễ/Tết',
  business_trip: 'Công tác',
};

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500 text-white',
  late: 'bg-orange-500 text-white',
  absent: 'bg-red-500 text-white',
  half_day: 'bg-amber-500 text-white',
  leave: 'bg-blue-500 text-white',
  holiday: 'bg-purple-500 text-white',
  business_trip: 'bg-cyan-500 text-white',
};

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;             // YYYY-MM-DD
  status: AttendanceStatus;
  checkIn?: string;         // HH:mm
  checkOut?: string;        // HH:mm
  overtimeHours?: number;
  constructionSiteId?: string;
  note?: string;
  // Selfie + GPS check-in
  checkInPhoto?: string;    // base64 hoặc URL ảnh selfie
  checkOutPhoto?: string;
  checkInLat?: number;
  checkInLng?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  locationName?: string;    // Tên CT/VP (cache)
  locationType?: 'construction_site' | 'office';
  isOutOfRange?: boolean;   // NV ngoài phạm vi khi check-in
  createdAt?: string;
}

// ===== ĐỀ XUẤT CHẤM CÔNG =====

export type AttendanceProposalStatus = 'pending' | 'approved' | 'rejected';

export const PROPOSAL_STATUS_LABELS: Record<AttendanceProposalStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
};

export const PROPOSAL_STATUS_COLORS: Record<AttendanceProposalStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export interface AttendanceProposal {
  id: string;
  proposerEmployeeId: string;   // Người đề xuất
  targetEmployeeId: string;     // Người cần bù công (có thể = proposer)
  date: string;                 // YYYY-MM-DD
  checkIn?: string;             // HH:mm
  checkOut?: string;            // HH:mm
  status: AttendanceStatus;     // present / half_day / business_trip
  reason: string;               // Lý do đề xuất
  locationId?: string;          // ID Công trường / Văn phòng
  locationType?: 'construction_site' | 'office';
  proposalStatus: AttendanceProposalStatus;
  approvedBy?: string;          // User ID người duyệt
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

// ===== NGHỈ PHÉP =====

export type LeaveType = 'annual' | 'sick' | 'personal' | 'maternity' | 'unpaid' | 'other';

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Phép năm',
  sick: 'Ốm đau',
  personal: 'Việc riêng',
  maternity: 'Thai sản',
  unpaid: 'Không lương',
  other: 'Khác',
};

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveApprover {
  userId: string;
  order: number;
  status: 'waiting' | 'approved' | 'rejected';
  comment?: string;
}

export interface LeaveLog {
  id: string;
  leaveRequestId: string;
  action: string;
  actedBy: string;
  comment: string;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  code: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: LeaveRequestStatus;
  approvers: LeaveApprover[];
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  dueDate?: string;
  createdAt: string;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  year: number;
  initialDays: number;       // Tổng phép năm ban đầu (default 12)
  monthlyAccrual: number;    // Số ngày cộng thêm mỗi tháng (default 1)
  accruedDays: number;       // Tổng ngày đã tích lũy (cộng dồn hàng tháng)
  usedPaidDays: number;      // Ngày phép đã sử dụng (có lương)
  usedUnpaidDays: number;    // Ngày phép không lương
  lastAccrualMonth: number;  // Tháng cuối cùng đã tích lũy (1-12)
  createdAt?: string;
}

// ===== NGÀY LỄ =====

export interface HrmHoliday {
  id: string;
  name: string;
  date: string;  // YYYY-MM-DD
  year: number;
  createdAt?: string;
}

// ===== BẢNG LƯƠNG MẪU =====

export type PayrollFieldType = 'income' | 'deduction' | 'info' | 'formula';
export type PayrollFieldSource = 'manual' | 'attendance_days' | 'attendance_ot_normal' | 'attendance_ot_weekend' | 'attendance_ot_holiday' | 'contract_salary' | 'contract_allowance' | 'contract_daily_rate';

export const PAYROLL_FIELD_SOURCE_LABELS: Record<PayrollFieldSource, string> = {
  manual: 'Nhập tay',
  attendance_days: 'Ngày công (từ chấm công)',
  attendance_ot_normal: 'OT ngày thường (giờ)',
  attendance_ot_weekend: 'OT cuối tuần (giờ)',
  attendance_ot_holiday: 'OT ngày lễ (giờ)',
  contract_salary: 'Lương cơ bản (từ HĐLĐ)',
  contract_allowance: 'Phụ cấp chức vụ (từ HĐLĐ)',
  contract_daily_rate: 'Đơn giá ngày (lương CB / ngày chuẩn)',
};

export const PAYROLL_FIELD_TYPE_LABELS: Record<PayrollFieldType, string> = {
  income: 'Thu nhập',
  deduction: 'Khấu trừ',
  info: 'Thông tin',
  formula: 'Công thức',
};

export interface PayrollTemplateField {
  id: string;
  name: string;
  type: PayrollFieldType;
  source?: PayrollFieldSource;  // for non-formula fields
  formula?: string;             // for formula fields, e.g. "{Lương HĐ} * 10.5%"
  order: number;
}

export interface PayrollTemplate {
  id: string;
  name: string;
  salaryPolicyId?: string;
  fields: PayrollTemplateField[];
  createdAt?: string;
}

// ===== BẢNG LƯƠNG =====

export interface PayrollRecord {
  id: string;
  employeeId: string;
  month: number;             // 1-12
  year: number;
  // Ngày công
  workingDays: number;       // Ngày công thực tế (từ chấm công)
  standardDays: number;      // Ngày công chuẩn tháng (VD: 26)
  overtimeHours: number;
  // Lương
  baseSalary: number;        // Lương cơ bản / tháng
  dailyRate?: number;        // Đơn giá / ngày (auto: baseSalary / standardDays)
  overtimeRate?: number;     // Đơn giá OT / giờ
  // Phụ cấp
  allowancePosition: number; // Phụ cấp chức vụ
  allowanceMeal: number;     // Phụ cấp ăn trưa
  allowanceTransport: number; // Phụ cấp đi lại
  allowancePhone: number;    // Phụ cấp điện thoại
  allowanceOther: number;    // Phụ cấp khác
  allowance?: number;
  bonus?: number;
  // Khấu trừ
  deductionInsurance: number; // BHXH/BHYT/BHTN
  deductionTax: number;      // Thuế TNCN
  deductionAdvance: number;  // Tạm ứng
  deductionOther: number;    // Khấu trừ khác
  deduction?: number;
  insurance?: number;
  // Tổng
  grossSalary: number;       // Tổng thu nhập
  netSalary: number;         // Thực lĩnh
  note?: string;
  status: 'draft' | 'confirmed' | 'paid';
  paidDate?: string;
  templateValues?: Record<string, any>;
  templateId?: string;
  createdAt: string;
}

// ===== HỢP ĐỒNG LAO ĐỘNG =====

export type LaborContractType = 'probation' | 'fixed_term' | 'definite' | 'indefinite' | 'seasonal';

export const LABOR_CONTRACT_LABELS: Record<LaborContractType, string> = {
  probation: 'Thử việc',
  fixed_term: 'Có thời hạn',
  definite: 'Có thời hạn',
  indefinite: 'Không thời hạn',
  seasonal: 'Thời vụ',
};

export type LaborContractStatus = 'active' | 'expired' | 'terminated' | 'renewed';

export interface LaborContract {
  id: string;
  employeeId: string;
  contractNumber: string;    // HĐ-001
  type: LaborContractType;
  contractType?: LaborContractType;
  status: LaborContractStatus;
  startDate: string;
  endDate?: string;          // null = vô thời hạn
  baseSalary: number;        // Mức lương cơ bản
  allowancePosition?: number;
  allowanceOther?: number;
  signedBy?: string;         // Người ký (đại diện công ty)
  note?: string;
  createdAt: string;
}

// ===== LỊCH SỬ LƯƠNG =====

export interface HrmSalaryHistory {
  id: string;
  employeeId: string;
  contractId?: string;
  changeDate: string;
  previousSalary: number;
  newSalary: number;
  previousAllowance: number;
  newAllowance: number;
  reason?: string;
  changedBy?: string;
  createdAt?: string;
}

// ===== KẾ HOẠCH CHI PHÍ =====

export type BudgetSource = 'manual' | 'payroll_salary' | 'payroll_allowance' | 'payroll_insurance' | 'payroll_total' | 'inventory_import' | 'asset_maintenance';

export interface BudgetCategory {
  id: string;
  name: string;
  code: string;        // I, I.1, II, II.3...
  parentId?: string | null;
  year: number;
  order: number;
  source: BudgetSource; // Nguồn dữ liệu thực tế
  createdAt?: string;
}

export interface BudgetEntry {
  id: string;
  categoryId: string;
  month: number;       // 1-12
  year: number;
  planned: number;     // Dự kiến (VNĐ)
  actual: number;      // Thực tế (VNĐ)
  createdAt?: string;
}


export interface ExpenseRecord {
  id: string;
  categoryId: string;
  amount: number;
  date: string;
  description?: string;
  receiptUrl?: string;
  createdBy?: string;
  createdAt?: string;
}

// ==================== HD: HỢP ĐỒNG ====================

export type PartnerClassification = 'owner' | 'contractor' | 'supplier';

export interface BusinessPartner {
  id: string;
  code: string;
  name: string;
  ownerUserId?: string;
  ownerName?: string;
  createdDate?: string;
  taxCode?: string;
  address?: string;
  classifications: PartnerClassification[];
  phone?: string;
  country?: string;
  province?: string;
  ward?: string;
  email?: string;
  website?: string;
  bankName?: string;
  bankAccount?: string;
  contactName?: string;
  contactTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
  isActive: boolean;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ContractTemplateFieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'textarea'
  | 'select'
  | 'email'
  | 'phone'
  | 'url';

export interface ContractTypeMetadata {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractTemplateField {
  id: string;
  templateId: string;
  sectionId: string;
  key: string;
  label: string;
  fieldType: ContractTemplateFieldType;
  required: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractTemplateSection {
  id: string;
  templateId: string;
  title: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  fields?: ContractTemplateField[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractFormTemplate {
  id: string;
  contractTypeId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isActive: boolean;
  sections?: ContractTemplateSection[];
  createdAt?: string;
  updatedAt?: string;
}

export type ContractCatalogStatus = 'active' | 'inactive';

export interface ContractServiceCatalogItem {
  id: string;
  code: string;
  name: string;
  groupName?: string;
  unit?: string;
  unitPrice: number;
  status: ContractCatalogStatus;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractLaborCatalogItem {
  id: string;
  code: string;
  name: string;
  groupName?: string;
  partnerId?: string;
  partnerName?: string;
  unit?: string;
  status: ContractCatalogStatus;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractMachineCatalogItem {
  id: string;
  code: string;
  name: string;
  groupName?: string;
  unit?: string;
  status: ContractCatalogStatus;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractMaterialNormItem {
  id: string;
  workCode: string;
  materialItemId?: string;
  materialSku?: string;
  materialName: string;
  unit?: string;
  wastePercent: number;
  norm: number;
  note?: string;
  status: ContractCatalogStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractCostItem {
  id: string;
  parentId?: string | null;
  symbol: string;
  name: string;
  costType?: string;
  description?: string;
  status: ContractCatalogStatus;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

// ==================== AI DỰ TOÁN NHANH & ĐƠN GIÁ NỘI BỘ ====================

export type CostTemplateStatus = 'draft' | 'active' | 'archived';
export type CostTemplateItemType = 'work' | 'material' | 'labor' | 'machine' | 'subcontract' | 'overhead' | 'other';
export type CostTemplateParameterType = 'number' | 'text' | 'select' | 'boolean' | 'date';
export type InternalPriceBookStatus = 'draft' | 'active' | 'archived';
export type InternalPriceBookItemType = 'material' | 'labor' | 'machine' | 'subcontract' | 'overhead' | 'other';
export type InternalCostSensitivityLevel = 'internal' | 'restricted';
export type EstimateScenarioStatus = 'draft' | 'reviewed' | 'finalized' | 'converted' | 'cancelled';
export type EstimateAdjustmentType = 'discount' | 'markup' | 'risk_contingency' | 'transport' | 'tax' | 'other';
export type EstimateParameterCode =
  | 'floor_area'
  | 'height'
  | 'span'
  | 'foundation_type'
  | 'roof_type'
  | 'wall_type'
  | 'crane_capacity'
  | 'finish_level'
  | 'region';

export interface CostTemplate {
  id: string;
  code: string;
  name: string;
  projectType?: string | null;
  description?: string | null;
  status: CostTemplateStatus;
  versionNo: number;
  parentTemplateId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  parametersSchema?: Record<string, unknown>;
  assumptions?: unknown[];
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CostTemplateSection {
  id: string;
  templateId: string;
  parentId?: string | null;
  code: string;
  name: string;
  description?: string | null;
  unit?: string | null;
  calculationMethod?: string | null;
  sortOrder: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CostTemplateItem {
  id: string;
  templateId: string;
  sectionId?: string | null;
  code: string;
  name: string;
  itemType: CostTemplateItemType;
  unit?: string | null;
  quantityFormula?: string | null;
  baseQuantity?: number | null;
  defaultWastePercent: number;
  laborRate: number;
  machineRate: number;
  overheadPercent: number;
  profitPercent: number;
  riskBufferPercent: number;
  costCategory?: string | null;
  workCode?: string | null;
  materialSku?: string | null;
  normGroupCode?: string | null;
  sortOrder: number;
  assumptions?: unknown[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CostTemplateParameter {
  id: string;
  templateId: string;
  code: EstimateParameterCode | string;
  label: string;
  dataType: CostTemplateParameterType;
  unit?: string | null;
  isRequired: boolean;
  defaultValue?: unknown;
  options?: unknown[];
  validationRules?: Record<string, unknown>;
  sortOrder: number;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface InternalPriceBookItem {
  id: string;
  itemCode: string;
  itemName: string;
  itemType: InternalPriceBookItemType;
  category?: string | null;
  spec?: string | null;
  unit: string;
  region: string;
  brand?: string | null;
  supplierName?: string | null;
  currency: string;
  unitPrice: number;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: InternalPriceBookStatus;
  sensitivityLevel: InternalCostSensitivityLevel;
  source?: string | null;
  note?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface InternalNorm {
  id: string;
  normCode: string;
  templateItemId?: string | null;
  workCode?: string | null;
  resourceCode?: string | null;
  resourceName: string;
  resourceType: InternalPriceBookItemType;
  unit: string;
  normQuantity: number;
  wastePercent: number;
  formula?: string | null;
  applicableParameters?: Record<string, unknown>;
  region: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: InternalPriceBookStatus;
  sourceProjectId?: string | null;
  sourceNote?: string | null;
  confidenceScore?: number | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EstimateScenario {
  id: string;
  code?: string | null;
  name: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  customerName?: string | null;
  projectType?: string | null;
  status: EstimateScenarioStatus;
  templateId?: string | null;
  templateVersionNo?: number | null;
  inputParameters: Partial<Record<EstimateParameterCode | string, unknown>>;
  missingParameters: string[];
  assumptions: unknown[];
  riskWarnings: unknown[];
  confidenceScore?: number | null;
  totalMaterialAmount: number;
  totalLaborAmount: number;
  totalMachineAmount: number;
  totalSubcontractAmount: number;
  totalOverheadAmount: number;
  manualAdjustmentAmount: number;
  totalAmount: number;
  quoteAmount: number;
  currency: string;
  marginPercent?: number | null;
  profitAmount?: number | null;
  templateSnapshot?: Record<string, unknown>;
  priceBookSnapshot?: unknown[];
  normsSnapshot?: unknown[];
  calculationSnapshot?: Record<string, unknown>;
  quoteSnapshot?: Record<string, unknown>;
  createdBy?: string | null;
  reviewedBy?: string | null;
  finalizedBy?: string | null;
  convertedProjectId?: string | null;
  convertedContractId?: string | null;
  convertedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EstimateItem {
  id: string;
  estimateId: string;
  sectionId?: string | null;
  templateItemId?: string | null;
  code?: string | null;
  name: string;
  itemType: CostTemplateItemType;
  unit?: string | null;
  quantityFormula?: string | null;
  originalQuantity?: number | null;
  originalUnitPrice?: number | null;
  originalAmount?: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  quoteUnitPrice?: number | null;
  quoteAmount?: number | null;
  priceBookItemId?: string | null;
  normId?: string | null;
  sourceSnapshot?: Record<string, unknown>;
  assumptions?: unknown[];
  confidenceScore?: number | null;
  manualOverride: boolean;
  overrideReason?: string | null;
  overrideBy?: string | null;
  overrideByName?: string | null;
  overrideAt?: string | null;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EstimateAdjustment {
  id: string;
  estimateId: string;
  adjustmentType: EstimateAdjustmentType;
  description: string;
  amount?: number | null;
  percent?: number | null;
  reason?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export interface EstimateVersion {
  id: string;
  estimateId: string;
  versionNo: number;
  status?: EstimateScenarioStatus | string | null;
  snapshot: Record<string, unknown>;
  changeNote?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export type EstimateConversionStatus = 'previewed' | 'completed' | 'cancelled';
export type EstimateConversionTargetTable = 'contract_items' | 'project_work_boq_items' | 'material_budget_items';

export interface EstimateConversionBatch {
  id: string;
  estimateId: string;
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  status: EstimateConversionStatus;
  summary: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
}

export interface EstimateConversionItem {
  id: string;
  batchId: string;
  estimateId: string;
  estimateItemId?: string | null;
  targetTable: EstimateConversionTargetTable;
  targetId: string;
  targetCode?: string | null;
  targetName?: string | null;
  targetSnapshot: Record<string, unknown>;
  createdAt?: string;
}

export type ContractGuaranteeType = 'performance' | 'advance' | 'warranty' | 'other';
export type ContractGuaranteeStatus = 'draft' | 'active' | 'released' | 'expired' | 'cancelled';

export interface ContractGuarantee {
  id: string;
  contractId: string;
  guaranteeType: ContractGuaranteeType;
  name: string;
  amount: number;
  percent?: number;
  bankName?: string;
  guaranteeNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  status: ContractGuaranteeStatus;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type HdContractStatus =
  | 'draft'         // Nháp
  | 'negotiating'   // Đang đàm phán
  | 'signed'        // Đã ký
  | 'active'        // Đang thực hiện
  | 'completed'     // Hoàn thành
  | 'expired'       // Hết hạn
  | 'cancelled';    // Hủy


export interface ContractAttachment {
  id: string;
  name: string;           // Tên hiển thị
  fileName: string;       // Tên file gốc
  storagePath: string;    // Đường dẫn trong Supabase Storage
  fileType: string;       // pdf, docx, jpg...
  fileSize: number;
  category?: 'contract' | 'other';
  uploadedAt: string;
  uploadedBy: string;
}

export interface SupplierContract {
  id: string;
  code: string;                   // HD-NCC-2025-001
  name: string;
  type: 'purchase' | 'supply' | 'service' | 'technical';
  supplierId?: string;
  supplierName?: string;
  supplierRepresentative?: string;
  projectId?: string;
  constructionSiteId?: string;
  value: number;
  currency: 'VND' | 'USD';
  paymentMethod?: 'bank_transfer' | 'cash' | 'credit';
  paymentTerms?: string;
  guaranteeInfo?: string;
  purchaseOrderNumber?: string;
  signedDate?: string;
  effectiveDate?: string;
  expiryDate?: string;
  managedByUserId?: string;
  managedByName?: string;
  status: HdContractStatus;
  note?: string;
  attachments: ContractAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContract {
  id: string;
  code: string;                   // HD-KH-2025-001
  name: string;
  type: 'construction' | 'supply' | 'design' | 'consulting' | 'implementation' | string;
  contractTypeId?: string;
  ownerPartnerId?: string;
  templateId?: string;
  templateSnapshot?: ContractFormTemplate | null;
  customData?: Record<string, any>;
  counterpartySnapshot?: Partial<BusinessPartner> | null;
  customerName: string;
  customerTaxCode?: string;
  customerAddress?: string;
  customerRepresentative?: string;
  customerRepresentativeTitle?: string;
  projectId?: string;
  constructionSiteId?: string; // FK → hrm_construction_sites.id (để ContractTab DA lọc)
  value: number;
  vatPercent?: number;
  currency: 'VND' | 'USD';
  paymentMethod?: 'bank_transfer' | 'cash' | 'credit';
  paymentSchedule?: string;
  warrantyMonths?: number;
  signedDate?: string;
  effectiveDate?: string;
  endDate?: string;
  managedByUserId?: string;
  managedByName?: string;
  status: HdContractStatus;
  note?: string;
  attachments: ContractAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractorContract {
  id: string;
  code: string;                   // HD-TP-2025-001
  name: string;
  subcontractorName: string;
  subcontractorTaxCode?: string;
  scopeOfWork?: string;
  projectId?: string;
  constructionSiteId?: string; // FK → hrm_construction_sites.id (để SubcontractTab DA lọc)
  parentContractId?: string;
  value: number;
  currency: 'VND' | 'USD';
  paymentMethod?: 'bank_transfer' | 'cash' | 'credit';
  paymentSchedule?: string;
  retentionPercent?: number;
  workLocation?: string;
  guaranteeInfo?: string;
  signedDate?: string;
  effectiveDate?: string;
  completionDate?: string;
  managedByUserId?: string;
  managedByName?: string;
  status: HdContractStatus;
  note?: string;
  attachments: ContractAttachment[];
  createdAt: string;
  updatedAt: string;
}
