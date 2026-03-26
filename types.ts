
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
  signatureUrl?: string; // URL ảnh chữ ký số
}

export interface Warehouse {
  id: string;
  name: string;
  address: string;
  type: WarehouseType;
  isArchived?: boolean; // Soft delete flag
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  debt: number; // Công nợ
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
  attachments?: { name: string; url: string; type: string }[];
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
  attachments?: { name: string; url: string; type: string }[];
  status: ContractStatus;
  note?: string;
  createdAt: string;
}

// ==================== TIẾN ĐỘ (Gantt) ====================
export type TaskDependencyType = 'FS' | 'SS' | 'FF' | 'SF';

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
}

// ==================== NHẬT KÝ CÔNG TRƯỜNG ====================
export type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'storm';

export interface DailyLog {
  id: string;
  constructionSiteId: string;
  date: string;
  weather: WeatherType;
  workerCount: number;
  description: string;
  issues?: string;
  photos?: { name: string; url: string }[];
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
  attachments?: { name: string; url: string; type: string }[];
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
  wasteThreshold: number;       // Ngưỡng cảnh báo hao hụt (%) — mặc định 5
  notes?: string;
}

export interface ProjectMaterialRequest {
  id: string;
  constructionSiteId: string;
  requestNumber: string;        // Số phiếu: YC-001
  requestedBy: string;
  requestDate: string;
  items: { itemName: string; unit: string; qty: number; note?: string }[];
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

// ==================== TÀI SẢN CỐ ĐỊNH (ASSETS) ====================

export enum AssetStatus {
  AVAILABLE = 'AVAILABLE',       // Chờ cấp phát
  IN_USE = 'IN_USE',             // Đang sử dụng
  MAINTENANCE = 'MAINTENANCE',   // Đang bảo trì
  BROKEN = 'BROKEN',             // Hỏng
  DISPOSED = 'DISPOSED',         // Đã thanh lý
}

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  [AssetStatus.AVAILABLE]: 'Chờ cấp phát',
  [AssetStatus.IN_USE]: 'Đang sử dụng',
  [AssetStatus.MAINTENANCE]: 'Đang bảo trì',
  [AssetStatus.BROKEN]: 'Hỏng',
  [AssetStatus.DISPOSED]: 'Đã thanh lý',
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

export interface Asset {
  id: string;
  code: string;              // Mã tài sản: TS-001
  name: string;
  categoryId: string;
  brand?: string;            // Nhãn hiệu
  model?: string;            // Model
  serialNumber?: string;     // Số serial
  status: AssetStatus;

  // Tài chính
  originalValue: number;     // Nguyên giá
  purchaseDate: string;      // Ngày mua
  depreciationYears: number; // Thời gian khấu hao (năm)
  warrantyMonths?: number;   // Thời gian bảo hành (tháng)
  residualValue: number;     // Giá trị thanh lý dự kiến

  // Vị trí
  warehouseId?: string;      // Kho lưu trữ hiện tại
  locationNote?: string;     // Ghi chú vị trí

  // Cấp phát hiện tại
  assignedToUserId?: string;
  assignedToName?: string;
  assignedDate?: string;

  // Thanh lý
  disposalDate?: string;
  disposalValue?: number;
  disposalNote?: string;

  imageUrl?: string;
  note?: string;
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
