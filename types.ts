
export enum Role {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE', // Nhân viên
}

export enum TransactionType {
  IMPORT = 'IMPORT', // Nhập kho
  EXPORT = 'EXPORT', // Xuất kho
  TRANSFER = 'TRANSFER', // Chuyển kho
  ADJUSTMENT = 'ADJUSTMENT', // Kiểm kê/Điều chỉnh
  LIQUIDATION = 'LIQUIDATION', // Xuất hủy
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum RequestStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',       // Chờ duyệt
  APPROVED = 'APPROVED',     // Đã duyệt (Chờ xuất)
  REJECTED = 'REJECTED',     // Từ chối
  IN_TRANSIT = 'IN_TRANSIT', // Đã xuất kho (Đang vận chuyển)
  COMPLETED = 'COMPLETED',   // Đã nhận hàng
}

export type WarehouseType = 'GENERAL' | 'SITE' | 'OFFICE'; // Tổng | Công trường | Văn phòng

export interface User {
  id: string;
  name: string;
  email: string;
  username?: string; // Tên đăng nhập
  password?: string; // Mật khẩu
  phone?: string; // SĐT nhân viên
  role: Role;
  avatar?: string;
  assignedWarehouseId?: string; // ID kho được giao quản lý (null = Toàn quyền)
  allowedModules?: string[]; // Danh sách module được phép sử dụng (VD: ['WMS', 'TS'])
  adminModules?: string[]; // Danh sách module mà user là Quản trị viên ứng dụng
  allowedSubModules?: Record<string, string[]>; // Module key -> danh sách route sub-app được phép (VD: { "HRM": ["/hrm/attendance", "/hrm/leave"] })
  adminSubModules?: Record<string, string[]>; // Module key -> danh sách route sub-app có quyền CRUD (VD: { "HRM": ["/hrm/employees"] })
  signatureUrl?: string; // URL ảnh chữ ký số
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
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed';

export interface ProjectFinance {
  id: string;
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
export interface PaymentSchedule {
  id: string;
  constructionSiteId: string;
  description: string;         // "Đợt 1 - Tạm ứng 30%"
  amount: number;
  dueDate: string;
  paidDate?: string;
  paidAmount?: number;
  status: PaymentScheduleStatus;
  type: 'receivable' | 'payable'; // Phải thu (CĐT) / Phải trả (NTP)
  contactName?: string;           // Tên CĐT hoặc NTP
  note?: string;
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

export type DelayCategory = 'material' | 'weather' | 'drawing' | 'labor' | 'other';
export type ResourceType = 'worker' | 'machine' | 'specialist';
export type GateStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface ProjectTask {
  id: string;
  constructionSiteId: string;
  parentId?: string;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;         // ngày
  progress: number;         // 0-100
  assignee?: string;
  dependencies?: { taskId: string; type: TaskDependencyType }[];
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
}

export interface ProjectBaseline {
  id: string;
  constructionSiteId: string;
  name: string;
  lockedAt: string;
  lockedBy?: string;
  tasksSnapshot: ProjectTask[];
  createdAt?: string;
}

// ==================== NHẬT KÝ CÔNG TRƯỜNG ====================
export type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'storm';

export interface DelayTaskEntry {
  taskId: string;
  taskName: string;        // cache tên để hiển thị
  delayDays: number;
  reason: string;          // ghi chú tự do
  category: DelayCategory; // 'material' | 'weather' | 'drawing' | 'labor' | 'other'
}

export interface DailyLog {
  id: string;
  constructionSiteId: string;
  date: string;
  weather: WeatherType;
  workerCount: number;
  description: string;
  issues?: string;
  photos?: { name: string; url: string }[];
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  delayTasks?: DelayTaskEntry[];
  photoRequired?: boolean;
  verified?: boolean;
  verifiedBy?: string;
  createdBy: string;
  createdAt: string;
}

// ==================== NGHIỆM THU NHÀ THẦU ====================
export type AcceptanceStatus = 'draft' | 'submitted' | 'approved' | 'paid';

export interface AcceptanceRecord {
  id: string;
  contractId: string;           // Liên kết HĐ thầu phụ
  constructionSiteId: string;
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

// ==================== VẬT TƯ & HAO HỤT ====================
export type MaterialRequestStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled';

export interface MaterialBudgetItem {
  id: string;
  constructionSiteId: string;
  inventoryItemId?: string;       // Link tới InventoryItem.id trong module Kho
  materialCode?: string;        // Mã vật tư chuẩn: VT_CT_1-Thep_phi22
  category: string;             // Nhóm: Xi măng, Thép, Cát...
  itemName: string;             // Tên vật tư cụ thể
  unit: string;                 // Đơn vị: kg, m3, tấn, bao...
  budgetQty: number;            // Khối lượng dự toán (BOQ)
  budgetUnitPrice: number;      // Đơn giá dự toán
  budgetTotal?: number;         // Auto: budgetQty * budgetUnitPrice
  actualQty: number;            // Khối lượng thực xuất (auto cộng dồn)
  actualTotal?: number;         // Auto: actualQty * budgetUnitPrice
  wasteQty?: number;            // Auto: actualQty - budgetQty
  wastePercent?: number;        // Auto: (actualQty - budgetQty)/budgetQty * 100
  wasteValue?: number;          // Giá trị hao hụt (VNĐ) = wasteQty * unitPrice
  wasteThreshold: number;       // Ngưỡng cảnh báo hao hụt (%) — mặc định 5
  cumulativeRequested?: number; // LK yêu cầu cấp
  cumulativeImported?: number;  // LK nhập kho (từ PO)
  cumulativeExported?: number;  // LK xuất kho (= actualQty)
  stockBalance?: number;        // Tồn kho = Nhập - Xuất
  budgetOverPercent?: number;   // % vượt ngân sách = (LK_YC - NS) / NS * 100
  autoAlert?: string;           // Cảnh báo tự động
  notes?: string;
}

export interface ProjectMaterialRequest {
  id: string;
  constructionSiteId: string;
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
export type POStatus = 'draft' | 'sent' | 'partial' | 'delivered' | 'cancelled';

export interface ProjectVendor {
  id: string;
  constructionSiteId: string;
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

export interface PurchaseOrder {
  id: string;
  constructionSiteId: string;
  vendorId: string;
  vendorName?: string;       // cache tên NCC
  poNumber: string;          // PO-001
  items: { name: string; unit: string; qty: number; unitPrice: number; receivedQty?: number }[];
  totalAmount: number;
  orderDate: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  status: POStatus;
  materialRequestId?: string;
  deliveryNote?: string;     // Ghi chú giao hàng
  note?: string;
  createdAt: string;
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
  priceIn: number;
  priceOut: number;
  minStock: number;
  supplierId?: string; // Link to Supplier
  imageUrl?: string;
  location?: string; // Vị trí trong kho, ví dụ: Kệ A-3, Ô 2
  stockByWarehouse: Record<string, number>; // warehouseId -> quantity (in base unit)
}

export interface TransactionItem {
  itemId: string;
  quantity: number;            // Số lượng theo đơn vị tồn kho (Cây, Cái...)
  price?: number;              // Snapshot giá tại thời điểm giao dịch
  // --- Thông tin kế toán (chỉ áp dụng khi NHẬP KHO với đơn vị mua khác) ---
  accountingQty?: number;      // Số lượng theo đơn vị mua (VD: 10.05 KG)
  accountingUnit?: string;     // Đơn vị mua (VD: 'KG') - snapshot tại thời điểm nhập
  accountingPrice?: number;    // Đơn giá theo đơn vị mua (VD: 15000 VNĐ/KG)
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  items: TransactionItem[];
  sourceWarehouseId?: string; // For Export/Transfer
  targetWarehouseId?: string; // For Import/Transfer
  supplierId?: string; // For Import
  requesterId: string; // User requesting
  approverId?: string; // User approving
  status: TransactionStatus;
  note?: string;
  relatedRequestId?: string; // Link to MaterialRequest
  pendingItems?: InventoryItem[]; // Full metadata for new items created during bulk import
}

export interface AuditLog {
  action: string;
  userId: string;
  timestamp: string;
  note?: string;
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
  itemId: string;
  requestQty: number;
  approvedQty: number; // Thực xuất (Bộ phận tiếp nhận quyết định)
}

export interface MaterialRequest {
  id: string;
  code: string; // e.g., MR-2023-001
  siteWarehouseId: string; // Kho công trường yêu cầu
  sourceWarehouseId?: string; // Kho cung cấp (thường là kho tổng)
  requesterId: string;
  status: RequestStatus;
  items: RequestItem[];
  createdDate: string;
  expectedDate: string;
  note?: string;
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
  config: {
    assigneeRole?: Role;       // Vai trò phụ trách duyệt bước này
    assigneeUserId?: string;   // Cụ thể user nào duyệt (ưu tiên hơn role)
    formFields?: { name: string; label: string; type: 'text' | 'number' | 'textarea'; required?: boolean }[];
    slaHours?: number;         // Thời gian tối đa xử lý (giờ)
  };
  positionX: number;
  positionY: number;
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
  code: string;
  title: string;
  createdBy: string; // user id
  currentNodeId: string | null;
  status: WorkflowInstanceStatus;
  formData: Record<string, any>;
  watchers: string[];  // user IDs — view + comment only
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
export interface ChatConversation {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatarUrl?: string;
  createdBy?: string;
  createdAt: string;
  // Computed (local only)
  members?: ChatMember[];
  lastMessage?: ChatMessage;
  unreadCount?: number;
}

export interface ChatMember {
  id: string;
  conversationId: string;
  userId: string;
  role: 'admin' | 'member';
  lastReadAt: string;
  joinedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content?: string;
  type: 'text' | 'image' | 'file' | 'system';
  attachments?: { url: string; name: string; type: string; size?: number }[];
  reactions?: Record<string, string[]>; // emoji -> userIds
  createdAt: string;
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

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'holiday' | 'business_trip';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Đi làm',
  absent: 'Vắng',
  half_day: 'Nửa ngày',
  leave: 'Nghỉ phép',
  holiday: 'Lễ/Tết',
  business_trip: 'Công tác',
};

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500 text-white',
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
  // Khấu trừ
  deductionInsurance: number; // BHXH/BHYT/BHTN
  deductionTax: number;      // Thuế TNCN
  deductionAdvance: number;  // Tạm ứng
  deductionOther: number;    // Khấu trừ khác
  // Tổng
  grossSalary: number;       // Tổng thu nhập
  netSalary: number;         // Thực lĩnh
  note?: string;
  status: 'draft' | 'confirmed' | 'paid';
  paidDate?: string;
  createdAt: string;
}

// ===== HỢP ĐỒNG LAO ĐỘNG =====

export type LaborContractType = 'probation' | 'fixed_term' | 'indefinite' | 'seasonal';

export const LABOR_CONTRACT_LABELS: Record<LaborContractType, string> = {
  probation: 'Thử việc',
  fixed_term: 'Có thời hạn',
  indefinite: 'Không thời hạn',
  seasonal: 'Thời vụ',
};

export type LaborContractStatus = 'active' | 'expired' | 'terminated' | 'renewed';

export interface LaborContract {
  id: string;
  employeeId: string;
  contractNumber: string;    // HĐ-001
  type: LaborContractType;
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
  type: 'construction' | 'supply' | 'design' | 'consulting' | 'implementation';
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

